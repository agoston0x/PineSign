/**
 * Lander.
 *
 * Generates nothing. If the extension is installed it shows the visitor the
 * name they are reachable at; otherwise it tells them what to install.
 */

import { Gateway } from '../../shared/client.js'
import { extensionPresent, getIdentity } from '../../shared/bridge.js'

const el = (id) => document.getElementById(id)
const gateway = new Gateway(location.origin)

async function show() {
  if (!(await extensionPresent())) {
    el('no-extension').hidden = false
    return
  }

  const identity = await getIdentity()
  const named = await gateway.reverseName(identity.publicKey)

  if (named) {
    el('your-name').textContent = named.name
    el('named').hidden = false
  } else {
    el('unnamed').hidden = false
  }

  el('copy-name').addEventListener('click', () => {
    navigator.clipboard.writeText(el('your-name').textContent)
    el('copy-name').textContent = 'Copied'
    setTimeout(() => (el('copy-name').textContent = 'Copy name'), 1200)
  })
}

show()
