/** Lander: shows the visitor their own key, so they can be sent a file. */

import { getOrCreateIdentity, createIdentity } from '../../shared/identity.js'

const pubkey = document.getElementById('pubkey')
const copyKey = document.getElementById('copy-key')
const newKey = document.getElementById('new-key')

let identity = await getOrCreateIdentity()
pubkey.textContent = identity.publicKeyHex

copyKey.addEventListener('click', () => {
  navigator.clipboard.writeText(identity.publicKeyHex)
  copyKey.textContent = 'Copied'
  setTimeout(() => (copyKey.textContent = 'Copy key'), 1200)
})

newKey.addEventListener('click', async () => {
  if (!confirm('Replace your key? Anything already sent to the old one becomes unreadable.')) return
  identity = await createIdentity()
  pubkey.textContent = identity.publicKeyHex
})
