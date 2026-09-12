/**
 * Circle sign-in.
 *
 * Google identifies the person; Circle gives them a wallet whose key they hold
 * and we never see. The wallet is their on-chain identity — it will own their
 * name and call the receipt contract — but it does no encryption: that is the
 * extension's key, published in the name's records.
 *
 * The Google step is a full-page redirect, so every piece of state the SDK needs
 * on the way back is written to localStorage before we leave.
 */

/**
 * Loaded from a CDN rather than bundled. The package is published for Node — it
 * pulls in jsonwebtoken and firebase — and shimming those builtins produced a
 * bundle that threw on evaluation. The CDN's browser build resolves its own
 * dependencies, and keeps this bundle at kilobytes instead of megabytes.
 */
import { W3SSdk } from 'https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.1.11/+esm'

const STORE = 'pinesign.circle'
const GOOGLE = 'Google' // SocialLoginProvider.GOOGLE

/**
 * Where Google sends the user back to. It must be the page that loads this
 * module, not the site root — the login result arrives in a callback, and only
 * a page running the SDK can receive it.
 */
const REDIRECT_URI = `${window.location.origin}/app.html`

let sdk = null
let config = null
let session = load()

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null')
  } catch {
    return null
  }
}

function save(patch) {
  session = { ...(session ?? {}), ...patch }
  localStorage.setItem(STORE, JSON.stringify(session))
  return session
}

export function clearSession() {
  session = null
  localStorage.removeItem(STORE)
}

export function currentWallet() {
  return session?.wallet ?? null
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? res.statusText)
  return json
}

/**
 * Provision the wallet and read back its address. Called both after a fresh
 * sign-in and on a return visit, since a user who already has a wallet simply
 * skips the challenge.
 */
async function finishSignIn({ userToken, encryptionKey }, onStep) {
  save({ userToken, encryptionKey })

  onStep?.('Creating your wallet…')
  const init = await api('/api/circle/initialize', { userToken })

  if (init.challengeId) {
    onStep?.('Confirm in the Circle window…')
    sdk.setAuthentication({ userToken, encryptionKey })
    await new Promise((resolve, reject) => {
      sdk.execute(init.challengeId, (error) => (error ? reject(new Error(error.message)) : resolve()))
    })
  }

  onStep?.('Reading your wallet…')
  const { wallets } = await api('/api/circle/wallets', { userToken })
  const wallet = wallets?.[0]
  if (!wallet) throw new Error('Circle created no wallet for this account')

  save({ wallet: { id: wallet.id, address: wallet.address, blockchain: wallet.blockchain } })
  return wallet
}

/**
 * Build the SDK and re-attach the login callback. Must run on every page load,
 * not just when the user clicks: the Google redirect lands back here and the
 * callback is the only way to receive the result.
 */
export async function initSignIn({ onStep, onWallet, onError }) {
  config = await (await fetch('/api/circle/config')).json()
  if (!config.configured) return { configured: false }

  sdk = new W3SSdk({ appSettings: { appId: config.appId } }, async (error, result) => {
    if (error) return onError?.(new Error(error.message))
    if (!result) return
    try {
      onWallet?.(await finishSignIn(result, onStep))
    } catch (err) {
      onError?.(err)
    }
  })

  // Restore what the redirect needs, so the callback above can fire.
  if (session?.deviceToken) {
    sdk.updateConfigs({
      appSettings: { appId: config.appId },
      loginConfigs: {
        deviceToken: session.deviceToken,
        deviceEncryptionKey: session.deviceEncryptionKey,
        google: { clientId: config.googleClientId, redirectUri: REDIRECT_URI },
      },
    })
  }

  return { configured: true, wallet: currentWallet() }
}

/** Start the Google redirect. Nothing after this call runs — the page leaves. */
export async function signInWithGoogle(onStep) {
  if (!sdk) throw new Error('the Circle SDK never initialised — check the console for why')
  onStep?.('Preparing…')
  const deviceId = await sdk.getDeviceId()
  const { deviceToken, deviceEncryptionKey } = await api('/api/circle/device-token', { deviceId })
  save({ deviceToken, deviceEncryptionKey })

  sdk.updateConfigs({
    appSettings: { appId: config.appId },
    loginConfigs: {
      deviceToken,
      deviceEncryptionKey,
      google: {
        clientId: config.googleClientId,
        redirectUri: REDIRECT_URI,
        selectAccountPrompt: true,
      },
    },
  })

  onStep?.('Redirecting to Google…')
  await sdk.performLogin(GOOGLE)
}
