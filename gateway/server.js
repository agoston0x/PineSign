/**
 * PineSign gateway.
 *
 * Holds the Swarm credentials, pays the postage, and sees nothing but
 * ciphertext. Every byte it stores was encrypted on the sender's machine with a
 * key it does not have and cannot derive.
 */

import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as swarm from './swarm.js'
import * as store from './store.js'
import * as names from './names.js'
import * as setup from './setup.js'
import * as chain from './chain.js'
import { issueNonce, requireSignature } from './auth.js'
import { transferDigest, verify, fromHex, toHex } from '../shared/crypto.js'
import { randomBytes } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 8788

const app = express()
app.use(express.json({ limit: '64mb' }))
app.use((req, res, next) => {
  // The extension is a distinct origin, so it needs CORS to reach the gateway.
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ---- setup ----

app.get('/api/setup/status', setup.requireSetupToken, async (_req, res) => {
  try {
    res.json(await setup.status())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** Is this name free? Asked while the admin types, so it stays a plain lookup. */
app.get('/api/setup/name/:name', setup.requireSetupToken, async (req, res) => {
  try {
    res.json(await chain.nameStatus(req.params.name.toLowerCase()))
  } catch (err) {
    res.status(502).json({ error: `could not reach the chain: ${err.message}` })
  }
})

app.post('/api/setup/name', setup.requireSetupToken, async (req, res) => {
  try {
    const state = await setup.chooseName(req.body?.name)
    names.setParent(state.parentName)
    res.json(state)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/setup/keys', setup.requireSetupToken, async (_req, res) => {
  try {
    res.json(await setup.generateDeployer())
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/setup/deploy', setup.requireSetupToken, async (_req, res) => {
  try {
    res.json(await setup.deploy())
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/health', async (_req, res) => {
  const state = await setup.status()
  res.json({
    ok: true,
    configured: state.step === 'ready',
    parentName: state.parentName,
    receiptsAddress: state.receiptsAddress,
    swarm: await swarm.stampInfo().catch((e) => ({ error: e.message })),
  })
})

app.post('/api/nonce', (req, res) => {
  const { pubKey } = req.body ?? {}
  if (!pubKey) return res.status(400).json({ error: 'pubKey required' })
  res.json({ nonce: issueNonce(pubKey) })
})

// ---- names ----

/** Claim a name and publish an encryption key under it. */
app.post('/api/name/register', requireSignature, async (req, res) => {
  try {
    const { label, address } = req.body
    const record = await names.register(String(label ?? '').toLowerCase(), {
      pubKey: req.pubKey,
      address,
    })
    res.json(record)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/name/resolve/:name', async (req, res) => {
  const record = await names.resolve(req.params.name.toLowerCase())
  if (!record) return res.status(404).json({ error: 'no such name' })
  res.json(record)
})

app.get('/api/name/reverse/:pubKey', async (req, res) => {
  const record = await names.reverse(req.params.pubKey.toLowerCase())
  if (!record) return res.status(404).json({ error: 'this key has no name' })
  res.json(record)
})

app.get('/api/names', async (_req, res) => res.json(await names.list()))

/**
 * Alice sends. She supplies ciphertext, the hash of the plaintext, and her
 * signature over the transfer digest — the sender half of the proof, committed
 * before Bob ever sees the file.
 */
app.post('/api/send', requireSignature, async (req, res) => {
  try {
    const { recipientPubKey, plaintextHash, senderSignature, filename, ciphertext } = req.body
    if (!recipientPubKey || !plaintextHash || !senderSignature || !ciphertext) {
      return res.status(400).json({ error: 'recipientPubKey, plaintextHash, senderSignature and ciphertext required' })
    }

    // The gate: only a named sender may spend the gateway's postage. The name
    // is also what published the sender's key, so this is the same check as
    // "is this someone the system can vouch for".
    const senderName = await names.reverse(req.pubKey)
    if (!senderName) {
      return res.status(403).json({ error: 'claim a name before sending' })
    }

    const digest = transferDigest({
      senderPubKey: req.pubKey,
      recipientPubKey,
      plaintextHash,
    })
    if (!verify(fromHex(senderSignature), digest, fromHex(req.pubKey))) {
      return res.status(400).json({ error: 'sender signature does not match the transfer' })
    }

    const recipientName = await names.reverse(recipientPubKey)

    const blob = Buffer.from(ciphertext, 'base64')
    const reference = await swarm.upload(new Uint8Array(blob))

    const id = randomBytes(16).toString('hex')
    const transfer = await store.create({
      id,
      reference,
      senderPubKey: req.pubKey,
      senderName: senderName.name,
      recipientPubKey,
      recipientName: recipientName?.name ?? null,
      plaintextHash,
      senderSignature,
      filename: filename ?? 'file',
      size: blob.length,
      digest: toHex(digest),
    })

    res.json({
      id,
      reference,
      expiresAt: transfer.expiresAt,
      claimUrl: `${req.protocol}://${req.get('host')}/claim.html?id=${id}`,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** Public record. Enough to verify the transfer; not enough to read the file. */
app.get('/api/transfer/:id', async (req, res) => {
  const t = await store.get(req.params.id)
  if (!t) return res.status(404).json({ error: 'no such transfer' })
  res.json({
    id: t.id,
    senderPubKey: t.senderPubKey,
    senderName: t.senderName ?? null,
    recipientPubKey: t.recipientPubKey,
    recipientName: t.recipientName ?? null,
    plaintextHash: t.plaintextHash,
    senderSignature: t.senderSignature,
    digest: t.digest,
    filename: t.filename,
    size: t.size,
    reference: t.reference,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    expired: Boolean(t.expired),
    claim: t.claim,
  })
})

/** The ciphertext itself. Useless without Bob's private key. */
app.get('/api/blob/:id', async (req, res) => {
  const t = await store.get(req.params.id)
  if (!t) return res.status(404).json({ error: 'no such transfer' })
  if (t.expired) return res.status(410).json({ error: 'transfer expired' })
  try {
    const bytes = await swarm.download(t.reference)
    res.set('Content-Type', 'application/octet-stream').send(Buffer.from(bytes))
  } catch (err) {
    res.status(502).json({ error: `swarm fetch failed: ${err.message}` })
  }
})

/**
 * Bob claims. His signature is over the same digest Alice signed, which he can
 * only produce after decrypting — so the pair of signatures is the receipt.
 */
app.post('/api/claim', requireSignature, async (req, res) => {
  try {
    const { id, claimSignature } = req.body
    const t = await store.get(id)
    if (!t) return res.status(404).json({ error: 'no such transfer' })
    if (req.pubKey !== t.recipientPubKey) {
      return res.status(403).json({ error: 'only the named recipient can claim' })
    }
    if (!verify(fromHex(claimSignature), fromHex(t.digest), fromHex(req.pubKey))) {
      return res.status(400).json({ error: 'claim signature does not match the transfer' })
    }
    const updated = await store.recordClaim(id, { recipientSignature: claimSignature })
    res.json({ ok: true, claim: updated.claim })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/transfers', async (_req, res) => res.json(await store.list()))

app.use(express.static(path.join(__dirname, '..', 'web')))

app.listen(PORT, async () => {
  const state = await setup.status()
  names.setParent(state.parentName)
  console.log(`pinesign gateway on http://localhost:${PORT}  [swarm: ${swarm.mode}]`)
  if (state.step === 'ready') {
    console.log(`  ${state.parentName} · receipts at ${state.receiptsAddress}`)
  } else {
    console.log(`  not configured yet — finish setup at:`)
    console.log(`  http://localhost:${PORT}/setup.html?token=${setup.SETUP_TOKEN}`)
  }
})
