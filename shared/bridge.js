/**
 * Page-side half of the extension bridge.
 *
 * A web page can ask the extension to act on its behalf but can never read the
 * key doing the acting. Every function here returns a result, never a secret.
 */

import { fromHex, toHex } from './crypto.js'

const TAG = 'pinesign'
const TIMEOUT_MS = 20_000

let ready = false
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.tag === TAG && event.data.type === 'ready') {
    ready = true
  }
})

function request(type, payload, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('the extension did not respond'))
    }, timeoutMs)

    function onMessage(event) {
      if (event.source !== window) return
      const msg = event.data
      if (msg?.tag !== TAG || msg.requestId !== requestId) return
      // The page hears its own outgoing request too — same id, no response
      // yet. Only a message carrying a response is the extension's answer.
      if (!('response' in msg)) return

      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      if (!msg.response?.ok) return reject(new Error(msg.response?.error ?? 'extension error'))
      resolve(msg.response.result)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ tag: TAG, requestId, type, payload }, window.location.origin)
  })
}

/**
 * Is the extension installed on this page?
 *
 * Kept deliberately brief. A missing extension is the common case, and nothing
 * else on the page should wait on discovering that — this used to fall through
 * to the full request timeout and stall startup for twenty seconds.
 */
export async function extensionPresent() {
  if (ready) return true
  await new Promise((r) => setTimeout(r, 300))
  if (ready) return true
  // The content script may have loaded before this listener did, so ask directly.
  try {
    await request('identity', {}, 1500)
    return true
  } catch {
    return false
  }
}

export function getIdentity() {
  return request('identity', {})
}

export function openTransfer(payload) {
  return request('openTransfer', payload)
}

export function sealTransfer(payload) {
  return request('sealTransfer', payload)
}

/** A signer the Gateway client can use, backed entirely by the extension. */
export async function bridgeSigner() {
  const identity = await getIdentity()
  return {
    publicKeyHex: identity.publicKey,
    address: identity.address,
    async signDigest(digest) {
      const { signature } = await request('signDigest', { digest: toHex(digest) })
      return signature
    },
  }
}

export { fromHex, toHex }
