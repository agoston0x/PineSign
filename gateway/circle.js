/**
 * Circle user-controlled wallets.
 *
 * Circle's rule is that the user's key share never reaches your server, so this
 * module deliberately cannot touch a wallet: it exchanges tokens and reads
 * addresses. Signing happens in the user's browser, in Circle's hosted UI.
 *
 * The API key lives here and only here — the browser gets short-lived tokens
 * minted against it, never the key itself.
 */

import { randomUUID } from 'node:crypto'

const API = 'https://api.circle.com/v1/w3s'

export const APP_ID = process.env.CIRCLE_APP_ID ?? null
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? null
const API_KEY = process.env.CIRCLE_API_KEY ?? null

/** Which chain the wallet is provisioned on — the same one the receipts are on. */
export const BLOCKCHAIN = process.env.CIRCLE_BLOCKCHAIN ?? 'ETH-SEPOLIA'

export const configured = Boolean(API_KEY && APP_ID && GOOGLE_CLIENT_ID)

/** What the browser is allowed to know: public ids, never the API key. */
export function publicConfig() {
  return { configured, appId: APP_ID, googleClientId: GOOGLE_CLIENT_ID, blockchain: BLOCKCHAIN }
}

async function call(path, { method = 'POST', userToken, body } = {}) {
  if (!API_KEY) throw new Error('CIRCLE_API_KEY is not set')

  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(userToken ? { 'X-User-Token': userToken } : {}),
    },
    ...(body ? { body: JSON.stringify({ idempotencyKey: randomUUID(), ...body }) } : {}),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = json?.message ?? `${res.status} ${res.statusText}`
    throw Object.assign(new Error(`circle: ${message}`), { code: json?.code, status: res.status })
  }
  return json.data ?? json
}

/**
 * Step one of a social login: trade the browser's device id for short-lived
 * tokens the SDK can run a Google sign-in with.
 */
export function createDeviceToken(deviceId) {
  return call('/users/social/token', { body: { deviceId } })
}

/**
 * Step two, after Google returns: provision the wallet. Circle answers with a
 * challenge the user completes in their own browser — this server never sees
 * the material that unlocks it.
 */
export async function initializeUser(userToken) {
  try {
    return await call('/user/initialize', {
      userToken,
      body: { accountType: 'SCA', blockchains: [BLOCKCHAIN] },
    })
  } catch (err) {
    // 155106: this user already has a wallet, which is a success for our
    // purposes — they signed in again rather than signed up.
    if (err.code === 155106) return { challengeId: null, alreadyInitialized: true }
    throw err
  }
}

export function listWallets(userToken) {
  return call('/wallets', { method: 'GET', userToken })
}
