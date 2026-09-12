/**
 * Admin authentication.
 *
 * The admin is an address, not a secret. Whoever claims the server first — with
 * the console token, so a passer-by cannot take it — becomes the admin, and
 * afterwards proves themselves by signing a nonce with that wallet. Nothing to
 * write down, nothing to leak, and it works from any device.
 *
 * The console token stays valid as recovery, for an admin who loses the wallet.
 */

import { randomBytes } from 'node:crypto'
import { verifyMessage } from 'viem'

const NONCE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

const nonces = new Map()
const sessions = new Map()

export function issueNonce(address) {
  const nonce = randomBytes(16).toString('hex')
  nonces.set(nonce, { address: address.toLowerCase(), expiresAt: Date.now() + NONCE_TTL_MS })
  return nonce
}

/** What the wallet is asked to sign — legible, so nobody signs a mystery. */
export function challengeText(nonce, host) {
  return [
    `Sign in as administrator of the PineSign server at ${host}.`,
    '',
    'This proves you control this wallet. It authorises no transaction and moves no funds.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n')
}

/**
 * Check a signature and open a session.
 *
 * The nonce is burned on use, so a captured signature cannot be replayed.
 */
export async function verify({ address, nonce, signature, host }) {
  const entry = nonces.get(nonce)
  if (!entry) return { ok: false, error: 'unknown or already-used nonce' }
  nonces.delete(nonce)

  if (Date.now() > entry.expiresAt) return { ok: false, error: 'nonce expired' }
  if (entry.address !== address.toLowerCase()) {
    return { ok: false, error: 'nonce was issued to a different address' }
  }

  const valid = await verifyMessage({
    address,
    message: challengeText(nonce, host),
    signature,
  }).catch(() => false)
  if (!valid) return { ok: false, error: 'signature did not match that address' }

  const session = randomBytes(24).toString('hex')
  sessions.set(session, { address: address.toLowerCase(), expiresAt: Date.now() + SESSION_TTL_MS })
  return { ok: true, session, address: address.toLowerCase() }
}

export function sessionAddress(session) {
  const entry = sessions.get(session)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    sessions.delete(session)
    return null
  }
  return entry.address
}

export function endSession(session) {
  sessions.delete(session)
}
