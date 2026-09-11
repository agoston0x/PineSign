/**
 * Claim page.
 *
 * Everything that matters happens on this device: the file is fetched as
 * ciphertext, decrypted with a key derived locally, and checked against the
 * hash the sender committed to before the transfer existed.
 */

import {
  deriveSharedKey,
  decrypt,
  hashPlaintext,
  transferDigest,
  sign,
  toHex,
  fromHex,
} from '../../shared/crypto.js'
import { getOrCreateIdentity } from '../../shared/identity.js'
import { Gateway } from '../../shared/client.js'

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

function short(hex) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`
}

function showReceipt(claim) {
  el('r-time').textContent = new Date(claim.claimedAt).toLocaleString()
  el('r-hash').textContent = short(transfer.plaintextHash)
  el('r-sig').textContent = short(claim.recipientSignature)
  el('receipt').hidden = false
  el('accept').disabled = true
}

async function load() {
  if (!id) return subtitle('No transfer in this link.', '#ff9c7a')

  identity = await getOrCreateIdentity()
  el('pubkey').textContent = identity.publicKeyHex
  el('identity-panel').hidden = false

  try {
    transfer = await gateway.transfer(id)
  } catch (err) {
    return subtitle(err.message, '#ff9c7a')
  }

  el('f-name').textContent = transfer.filename
  el('f-size').textContent = formatSize(transfer.size)
  el('f-sender').textContent = short(transfer.senderPubKey)
  el('f-ref').textContent = short(transfer.reference)
  el('f-expires').textContent = new Date(transfer.expiresAt).toLocaleString()
  el('details').hidden = false

  if (transfer.expired) {
    return subtitle('This transfer expired. The file is gone.', '#ff9c7a')
  }

  // The recipient is named in the transfer itself, so a link alone opens nothing.
  if (transfer.recipientPubKey !== identity.publicKeyHex) {
    el('identity-hint').textContent =
      'This file was sent to a different key. Give the sender the key above and ask them to send it again.'
    return subtitle('Not addressed to this device.', '#ff9c7a')
  }

  el('action-panel').hidden = false

  if (transfer.claim) {
    subtitle('Already delivered.', 'var(--glow)')
    showReceipt(transfer.claim)
    return
  }

  subtitle('Waiting for you to accept.')
}

el('accept').addEventListener('click', async () => {
  el('accept').disabled = true
  try {
    say('Fetching the encrypted file…')
    const blob = await gateway.blob(id)

    // Same ECDH the sender ran, from the other side: our private key and their
    // public one produce the identical secret.
    say('Deriving the key…')
    const sharedKey = deriveSharedKey(identity.privateKey, fromHex(transfer.senderPubKey))

    say('Decrypting…')
    const plaintext = decrypt(blob, sharedKey)

    // What arrived must be what was committed to, or this is not the transfer.
    const hash = toHex(hashPlaintext(plaintext))
    if (hash !== transfer.plaintextHash) {
      throw new Error('the decrypted file does not match what the sender committed to')
    }

    say('Signing the receipt…')
    const digest = transferDigest({
      senderPubKey: transfer.senderPubKey,
      recipientPubKey: identity.publicKeyHex,
      plaintextHash: hash,
    })
    const claimSignature = toHex(sign(digest, identity.privateKey))
    const { claim } = await gateway.claim(identity, id, claimSignature)

    const url = URL.createObjectURL(new Blob([plaintext]))
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
