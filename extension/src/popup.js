/**
 * Extension popup.
 *
 * The file is read, encrypted and hashed here, in the extension's own context.
 * What crosses the wire to the gateway is ciphertext plus a hash — the gateway
 * has no way back to the bytes.
 */

import {
  deriveSharedKey,
  encrypt,
  hashPlaintext,
  transferDigest,
  sign,
  toHex,
  fromHex,
} from '../../shared/crypto.js'
import { getOrCreateIdentity } from '../../shared/identity.js'
import { Gateway, toBase64 } from '../../shared/client.js'

const DEFAULT_GATEWAY = 'http://localhost:8788'
const GATEWAY_KEY = 'pinesign.gateway'

const el = (id) => document.getElementById(id)
const ui = {
  pubkey: el('pubkey'),
  address: el('address'),
  copyKey: el('copy-key'),
  recipient: el('recipient'),
  file: el('file'),
  send: el('send'),
  status: el('status'),
  result: el('result'),
  claimLink: el('claim-link'),
  copyLink: el('copy-link'),
  gateway: el('gateway'),
  mode: el('mode'),
}

let identity = null

function say(message, kind = '') {
  ui.status.textContent = message
  ui.status.className = `status ${kind}`.trim()
}

function readyToSend() {
  const recipient = ui.recipient.value.trim()
  ui.send.disabled = !(/^0[23][0-9a-f]{64}$/i.test(recipient) && ui.file.files.length > 0)
}

async function storedGateway() {
  if (globalThis.chrome?.storage?.local) {
    const out = await chrome.storage.local.get(GATEWAY_KEY)
    return out[GATEWAY_KEY] ?? DEFAULT_GATEWAY
  }
  return localStorage.getItem(GATEWAY_KEY) ?? DEFAULT_GATEWAY
}

async function saveGateway(url) {
  if (globalThis.chrome?.storage?.local) return chrome.storage.local.set({ [GATEWAY_KEY]: url })
  localStorage.setItem(GATEWAY_KEY, url)
}

async function refreshMode() {
  try {
    const health = await new Gateway(ui.gateway.value.trim()).health()
    ui.mode.textContent = health.swarm?.mode === 'swarm' ? 'swarm' : 'local'
    ui.mode.style.color = health.swarm?.mode === 'swarm' ? 'var(--glow)' : 'var(--haze)'
  } catch {
    ui.mode.textContent = 'offline'
    ui.mode.style.color = '#ff9c7a'
  }
}

async function init() {
  identity = await getOrCreateIdentity()
  ui.pubkey.textContent = identity.publicKeyHex
  ui.address.textContent = identity.address.slice(0, 10) + '…'
  ui.gateway.value = await storedGateway()
  refreshMode()
}

ui.copyKey.addEventListener('click', () => {
  navigator.clipboard.writeText(identity.publicKeyHex)
  ui.copyKey.textContent = 'Copied'
  setTimeout(() => (ui.copyKey.textContent = 'Copy key'), 1200)
})

ui.recipient.addEventListener('input', readyToSend)
ui.file.addEventListener('change', readyToSend)

ui.gateway.addEventListener('change', async () => {
  await saveGateway(ui.gateway.value.trim())
  refreshMode()
})

ui.send.addEventListener('click', async () => {
  const recipientPubKey = ui.recipient.value.trim().toLowerCase()
  const file = ui.file.files[0]

  if (recipientPubKey === identity.publicKeyHex) {
    return say('That is your own key — pick the recipient’s.', 'error')
  }

  ui.send.disabled = true
  ui.result.hidden = true

  try {
    say('Reading file…')
    const plaintext = new Uint8Array(await file.arrayBuffer())

    // The key is derived, never transmitted: our private key plus their public
    // key gives the same secret they will compute from the other direction.
    say('Deriving shared key…')
    const sharedKey = deriveSharedKey(identity.privateKey, fromHex(recipientPubKey))

    say('Encrypting…')
    const ciphertext = encrypt(plaintext, sharedKey)
    const plaintextHash = toHex(hashPlaintext(plaintext))

    // Committing to the transfer before the recipient has ever seen it: this
    // signature is what proves the file came from us.
    const digest = transferDigest({
      senderPubKey: identity.publicKeyHex,
      recipientPubKey,
      plaintextHash,
    })
    const senderSignature = toHex(sign(digest, identity.privateKey))

    say('Uploading to the gateway…')
    const result = await new Gateway(ui.gateway.value.trim()).send(identity, {
      recipientPubKey,
      plaintextHash,
      senderSignature,
      filename: file.name,
      ciphertext: toBase64(ciphertext),
    })

    ui.claimLink.textContent = result.claimUrl
    ui.result.hidden = false
    const days = Math.round((result.expiresAt - Date.now()) / 86400000)
    say(`Sent. The file and its link disappear in ${days} day${days === 1 ? '' : 's'}.`, 'done')
  } catch (err) {
    say(err.message, 'error')
  } finally {
    readyToSend()
  }
})

ui.copyLink.addEventListener('click', () => {
  navigator.clipboard.writeText(ui.claimLink.textContent)
  ui.copyLink.textContent = 'Copied'
  setTimeout(() => (ui.copyLink.textContent = 'Copy link'), 1200)
})

init()
