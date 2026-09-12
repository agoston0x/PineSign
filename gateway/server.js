/**
 * PineSign gateway.
 *
 * Holds the Swarm credentials, pays the postage, and sees nothing but
 * ciphertext. Every byte it stores was encrypted on the sender's machine with a
 * key it does not have and cannot derive.
 */

import './env.js' // must be first: fills process.env for every import below
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as swarm from './swarm.js'
import * as store from './store.js'
import * as names from './names.js'
import * as setup from './setup.js'
import * as chain from './chain.js'
import * as circle from './circle.js'
import * as admin from './admin.js'
import { rateLimit, requireHexParam } from './limits.js'
import { issueNonce, requireSignature } from './auth.js'
import { transferDigest, verify, fromHex, toHex } from '../shared/crypto.js'
import { randomBytes } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 8788
// Behind a reverse proxy, bind to loopback so the proxy is the only way in.
const HOST = process.env.HOST ?? '0.0.0.0'

const app = express()

// Behind Caddy or nginx, the client address arrives in a forwarded header;
// without this every visitor looks like the proxy and rate limiting is useless.
app.set('trust proxy', 1)

app.use(express.json({ limit: '64mb' }))

app.use((req, res, next) => {
  // The extension is a distinct origin and must be able to reach the gateway.
  // Chrome sends chrome-extension:// as the origin; everything else is only
  // allowed to read, which is what the claim page needs and no more.
  const origin = req.get('origin')
  if (origin?.startsWith('chrome-extension://') || origin === undefined) {
    res.set('Access-Control-Allow-Origin', origin ?? '*')
  } else {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Vary', 'Origin')
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-setup-token, x-admin-session')
  if (req.method === 'OPTIONS') return res.sendStatus(204)

  // Nothing here should ever be framed or sniffed.
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  next()
})

// Anything that spends Circle quota, postage or gas is limited; reads are not.
const limitAuth = rateLimit({ key: 'auth', windowMs: 60_000, max: 20 })
const limitCircle = rateLimit({ key: 'circle', windowMs: 60_000, max: 20 })
const limitSend = rateLimit({ key: 'send', windowMs: 60_000, max: 10 })
const limitSetup = rateLimit({ key: 'setup', windowMs: 60_000, max: 60 })

// ---- admin sign-in ----

/** Who, if anyone, owns this server — asked before any sign-in is attempted. */
app.get('/api/setup/admin', async (_req, res) => {
  res.json({ adminAddress: await setup.adminAddress() })
})

app.post('/api/setup/admin/nonce', limitAuth, (req, res) => {
  const { address } = req.body ?? {}
  if (!address) return res.status(400).json({ error: 'address required' })
  const nonce = admin.issueNonce(address)
  res.json({ nonce, message: admin.challengeText(nonce, req.get('host')) })
})

/**
 * Verify a signature, and on a first run claim the server for that wallet.
 * Claiming needs the console token as well, so an unclaimed server on a public
 * address cannot simply be taken by whoever finds it.
 */
app.post('/api/setup/admin/verify', limitAuth, async (req, res) => {
  try {
    const { address, nonce, signature, token } = req.body ?? {}
    const result = await admin.verify({ address, nonce, signature, host: req.get('host') })
    if (!result.ok) return res.status(401).json({ error: result.error })

    const existing = await setup.adminAddress()
    if (!existing) {
      if (token !== (await setup.getSetupToken())) {
        return res.status(403).json({ error: 'the console token is required to claim this server' })
      }
      await setup.claimAdmin(result.address)
    } else if (existing !== result.address) {
      return res.status(403).json({ error: 'that wallet is not the administrator of this server' })
    }

    res.json({ session: result.session, address: result.address })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/setup/admin/signout', (req, res) => {
  const session = req.get('x-admin-session')
  if (session) admin.endSession(session)
  res.json({ ok: true })
})

// ---- setup ----

app.get('/api/setup/status', limitSetup, setup.requireSetupToken, async (_req, res) => {
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

/** Buying the name takes two transactions and a mandated wait between them. */
app.post('/api/setup/register-name', setup.requireSetupToken, async (req, res) => {
  // Two transactions plus the registrar's enforced wait; well past any default.
  req.setTimeout(300000)
  res.setTimeout(300000)
  try {
    res.json(await setup.registerName())
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

/** Buying postage can take a while; the node waits on Gnosis. */
app.post('/api/setup/postage', setup.requireSetupToken, async (req, res) => {
  req.setTimeout(180000)
  res.setTimeout(180000)
  try {
    res.json(await setup.buyPostage(req.body ?? {}))
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

app.post('/api/nonce', limitAuth, (req, res) => {
  const { pubKey } = req.body ?? {}
  if (!pubKey) return res.status(400).json({ error: 'pubKey required' })
  res.json({ nonce: issueNonce(pubKey) })
})

// ---- circle wallets ----

/** Public ids the sign-in flow needs. Never the API key. */
app.get('/api/circle/config', (_req, res) => res.json(circle.publicConfig()))

/** Trade the browser's device id for tokens the SDK can sign in with. */
app.post('/api/circle/device-token', limitCircle, async (req, res) => {
  try {
    const { deviceId } = req.body ?? {}
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' })
    res.json(await circle.createDeviceToken(deviceId))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

/** Provision the wallet once Google has returned. */
app.post('/api/circle/initialize', limitCircle, async (req, res) => {
  try {
    const { userToken } = req.body ?? {}
    if (!userToken) return res.status(400).json({ error: 'userToken required' })
    res.json(await circle.initializeUser(userToken))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/circle/wallets', limitCircle, async (req, res) => {
  try {
    const { userToken } = req.body ?? {}
    if (!userToken) return res.status(400).json({ error: 'userToken required' })
    res.json(await circle.listWallets(userToken))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ---- names ----

/** Is this label free? Asked while the user types. */
app.get('/api/name/available/:label', async (req, res) => {
  const label = req.params.label.toLowerCase()
  if (!names.validLabel(label)) {
    return res.json({ label, available: false, reason: 'A name is 3-32 characters: letters, digits and hyphens.' })
  }
  const taken = await names.resolve(label)
  res.json({ label, name: names.fullName(label), available: !taken })
})

/**
 * Claim a name and publish an encryption key under it.
 *
 * Two proofs are required, because the name binds two different things: the
 * extension signs, which proves the encryption key is theirs, and the Circle
 * user token proves the wallet is theirs. The wallet address is read back from
 * Circle rather than accepted from the browser — a page could claim any address.
 */
app.post('/api/name/register', limitSend, requireSignature, async (req, res) => {
  try {
    const { label, userToken } = req.body

    let address = null
    if (userToken) {
      const { wallets } = await circle.listWallets(userToken)
      address = wallets?.[0]?.address ?? null
      if (!address) return res.status(400).json({ error: 'that account has no wallet yet' })
    } else if (circle.configured) {
      return res.status(401).json({ error: 'sign in before claiming a name' })
    }

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

// Resolution is public by necessity; enumeration of every user is not.
app.get('/api/names', setup.requireSetupToken, async (_req, res) => res.json(await names.list()))

/**
 * Alice sends. She supplies ciphertext, the hash of the plaintext, and her
 * signature over the transfer digest — the sender half of the proof, committed
 * before Bob ever sees the file.
 */
app.post('/api/send', limitSend, requireSignature, async (req, res) => {
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
app.get('/api/transfer/:id', requireHexParam('id', { length: 32 }), async (req, res) => {
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
app.get('/api/blob/:id', requireHexParam('id', { length: 32 }), async (req, res) => {
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

// The whole transfer log, admin only — it names every sender and recipient.
app.get('/api/transfers', setup.requireSetupToken, async (_req, res) => res.json(await store.list()))

app.use(express.static(path.join(__dirname, '..', 'web')))

app.listen(PORT, HOST, async () => {
  const state = await setup.status()
  names.setParent(state.parentName)

  console.log(`pinesign gateway on http://localhost:${PORT}  [swarm: ${await swarm.mode()}]`)
  if (state.step === 'ready') {
    console.log(`  ${state.parentName} · receipts at ${state.receiptsAddress}`)
  } else {
    console.log('  not configured yet')
  }

  // Always printed: this link is the only way into the admin panel, and an
  // operator who has lost it has lost access to their own server.
  const token = await setup.getSetupToken()
  console.log(`  admin: http://localhost:${PORT}/setup.html?token=${token}`)
})
