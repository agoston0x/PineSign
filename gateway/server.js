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

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, swarm: await swarm.stampInfo().catch((e) => ({ error: e.message })) })
})

app.post('/api/nonce', (req, res) => {
  const { pubKey } = req.body ?? {}
  if (!pubKey) return res.status(400).json({ error: 'pubKey required' })
  res.json({ nonce: issueNonce(pubKey) })
})

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

    const digest = transferDigest({
      senderPubKey: req.pubKey,
      recipientPubKey,
      plaintextHash,
    })
    if (!verify(fromHex(senderSignature), digest, fromHex(req.pubKey))) {
      return res.status(400).json({ error: 'sender signature does not match the transfer' })
    }

    const blob = Buffer.from(ciphertext, 'base64')
    const reference = await swarm.upload(new Uint8Array(blob))

    const id = randomBytes(16).toString('hex')
    const transfer = await store.create({
      id,
      reference,
      senderPubKey: req.pubKey,
      recipientPubKey,
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
    recipientPubKey: t.recipientPubKey,
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

app.listen(PORT, () => {
  console.log(`pinesign gateway on http://localhost:${PORT}  [swarm: ${swarm.mode}]`)
})
