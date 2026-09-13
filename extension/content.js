/**
 * Page ↔ extension bridge.
 *
 * The claim page cannot talk to the service worker directly, so this relays
 * requests across. It carries no keys and makes no decisions — it forwards a
 * request and returns the answer.
 */

const TAG = 'pinesign'

// Let the page know an extension is present before it renders anything.
window.postMessage({ tag: TAG, type: 'ready' }, window.location.origin)

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const msg = event.data
  if (msg?.tag !== TAG || !msg.requestId) return
  // Replies this script posts back come through here as well. Forwarding them
  // would ask the extension to handle its own answers, forever.
  if ('response' in msg || !msg.type) return

  chrome.runtime.sendMessage({ type: msg.type, payload: msg.payload }, (response) => {
    window.postMessage(
      {
        tag: TAG,
        requestId: msg.requestId,
        response: chrome.runtime.lastError
          ? { ok: false, error: chrome.runtime.lastError.message }
          : response,
      },
      window.location.origin,
    )
  })
})
