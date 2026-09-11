/**
 * Nonce-challenge auth.
 *
 * The gateway pays for every upload, so it has to know who is asking. A client
 * proves control of a keypair by signing a one-time nonce — no password, no
 * session cookie, and nothing replayable: each nonce is issued once and burned
 * on use.
 */

import { randomBytes } from 'node:crypto'
import { sha256 } from '@noble/hashes/sha256'
import { verify, fromHex } from '../shared/crypto.js'

const NONCE_TTL_MS = 2 * 60 * 1000
const nonces = new Map()

export function issueNonce(pubKey) {
  const nonce = randomBytes(24).toString('hex')
  nonces.set(nonce, { pubKey, expiresAt: Date.now() + NONCE_TTL_MS })
  return nonce
}

export function verifyNonce(pubKey, nonce, signatureHex) {
  const entry = nonces.get(nonce)
  if (!entry) return { ok: false, error: 'unknown or already-used nonce' }
  nonces.delete(nonce)
  if (Date.now() > entry.expiresAt) return { ok: false, error: 'nonce expired' }
  if (entry.pubKey !== pubKey) return { ok: false, error: 'nonce issued to a different key' }

  const digest = sha256(new TextEncoder().encode(nonce))
  if (!verify(fromHex(signatureHex), digest, fromHex(pubKey))) {
    return { ok: false, error: 'bad signature' }
  }
  return { ok: true }
}

/** Express middleware: every write path carries pubKey + nonce + signature. */
export function requireSignature(req, res, next) {
  const { pubKey, nonce, signature } = req.body ?? {}
  if (!pubKey || !nonce || !signature) {
    return res.status(401).json({ error: 'pubKey, nonce and signature required' })
  }
  const result = verifyNonce(pubKey, nonce, signature)
  if (!result.ok) return res.status(401).json({ error: result.error })
  req.pubKey = pubKey
  next()
}
