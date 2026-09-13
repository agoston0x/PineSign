/**
 * Claim page.
 *
 * This page holds no key and can read no file. It fetches ciphertext, hands it
 * to the extension, and gets back a plaintext and a signature — the private key
 * never enters the page, so nothing here could leak it.
 */

import { Gateway } from '../../shared/client.js'
import { keyMode, identity as getIdentity, openTransfer, signer } from '../../shared/keysource.js'

const el = (id) => document.getElementById(id)
const gateway = new Gateway(location.origin)
const id = new URLSearchParams(location.search).get('id')

let identity = null
let transfer = null

function say(message, kind = '') {
  el('status').textContent = message
  el('status').className = `status ${kind}`.trim()
}

function subtitle(text, colour) {
  el('subtitle').textContent = text
  if (colour) el('subtitle').style.color = colour
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const short = (hex) => `${hex.slice(0, 10)}…${hex.slice(-6)}`

function showReceipt(claim) {
  el('r-time').textContent = new Date(claim.claimedAt).toLocaleString()
  el('r-hash').textContent = short(transfer.plaintextHash)
  el('r-sig').textContent = short(claim.recipientSignature)
  el('receipt').hidden = false
  el('accept').disabled = true
}

async function load() {
  if (!id) return subtitle('No transfer in this link.', '#ff9c7a')

  const mode = await keyMode()
  identity = await getIdentity()
  const named = await gateway.reverseName(identity.publicKey)
  el('pubkey').textContent = named ? named.name : identity.publicKey
  el('identity-panel').hidden = false

  try {
    transfer = await gateway.transfer(id)
  } catch (err) {
    return subtitle(err.message, '#ff9c7a')
  }

  el('f-name').textContent = transfer.filename
  el('f-size').textContent = formatSize(transfer.size)
  el('f-sender').textContent = transfer.senderName ?? short(transfer.senderPubKey)
  el('f-ref').textContent = short(transfer.reference)
  el('f-expires').textContent = new Date(transfer.expiresAt).toLocaleString()
  el('details').hidden = false

  if (transfer.expired) {
    return subtitle('This transfer expired. The file is gone.', '#ff9c7a')
  }

  // The sender may have insisted on the extension, so that no code served by
  // this site ever handles the key. In that case a page-held key is refused.
  if (transfer.requireExtension && mode !== 'extension') {
    el('install-panel').hidden = false
    el('identity-panel').hidden = true
    return subtitle('The sender requires the extension for this file.', '#ff9c7a')
  }

  el('key-mode').textContent = mode === 'extension'
    ? 'Your key is in the extension. Nothing this page loads can reach it.'
    : 'Your key is held in this browser. Private in use — but you are trusting the code this page served you.'

  // The recipient is named in the transfer itself, so a link alone opens nothing.
  if (transfer.recipientPubKey !== identity.publicKey) {
    el('identity-hint').textContent =
      'This file was sent to a different key. Give the sender the name above and ask them to send it again.'
    return subtitle('Not addressed to this device.', '#ff9c7a')
  }

  el('action-panel').hidden = false

  if (transfer.claim) {
    subtitle('Already delivered.', 'var(--glow)')
    return showReceipt(transfer.claim)
  }

  subtitle('Waiting for you to accept.')
}

el('accept').addEventListener('click', async () => {
  el('accept').disabled = true
  try {
    say('Fetching the encrypted file…')
    const blob = await gateway.blob(id)

    // Decryption and the receipt are one step inside the extension: the page
    // cannot take the file and then decline to sign for it.
    say('Opening it in the extension…')
    const opened = await openTransfer({
      ciphertext: Array.from(blob),
      senderPubKey: transfer.senderPubKey,
      expectedHash: transfer.plaintextHash,
    })

    say('Recording the receipt…')
    const { claim } = await gateway.claim(await signer(), id, opened.signature)

    const bytes = Uint8Array.from(opened.plaintext)
    const url = URL.createObjectURL(new Blob([bytes]))
    const a = document.createElement('a')
    a.href = url
    a.download = transfer.filename
    a.click()
    URL.revokeObjectURL(url)

    say('Decrypted, verified, and receipted.', 'done')
    subtitle('Delivered.', 'var(--glow)')
    showReceipt(claim)
  } catch (err) {
    say(err.message, 'error')
    el('accept').disabled = false
  }
})

load()
