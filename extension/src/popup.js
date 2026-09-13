/**
 * Extension popup.
 *
 * The file is read, encrypted and hashed here. What crosses the wire is
 * ciphertext and a hash — the gateway has no way back to the bytes.
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
import { Gateway, localSigner, toBase64 } from '../../shared/client.js'

// Compiled in by the server that built this extension. Only a dev build
// (localhost) exposes the field for changing it.
const DEFAULT_GATEWAY = typeof __PINESIGN_GATEWAY__ !== 'undefined' ? __PINESIGN_GATEWAY__ : 'http://localhost:8788'
const DEV_BUILD = DEFAULT_GATEWAY.startsWith('http://localhost')
const GATEWAY_KEY = 'pinesign.gateway'

const el = (id) => document.getElementById(id)

let identity = null
let signer = null
let myName = null
let recipient = null

const gateway = () => new Gateway(el('gateway').value.trim())

function setStatus(node, message, kind = '') {
  node.textContent = message
  node.className = `status ${kind}`.trim()
}

const say = (m, k) => setStatus(el('status'), m, k)

function readyToSend() {
  el('send').disabled = !(recipient && el('file').files.length > 0)
}

async function stored(key, fallback) {
  const out = await chrome.storage.local.get(key)
  return out[key] ?? fallback
}

async function refreshMode() {
  try {
    const health = await gateway().health()
    const live = health.swarm?.mode === 'swarm'
    el('mode').textContent = live ? 'swarm' : 'local'
    el('mode').style.color = live ? 'var(--glow)' : 'var(--haze)'
  } catch {
    el('mode').textContent = 'offline'
    el('mode').style.color = '#ff9c7a'
  }
}

function showName(record) {
  myName = record
  el('your-name').textContent = record.name
  el('no-name').hidden = true
  el('have-name').hidden = false
  el('send-card').hidden = false
}

async function init() {
  identity = await getOrCreateIdentity()
  signer = localSigner(identity)
  // A production build always talks to the server it came from; a stored
  // override only applies in a dev build.
  el('gateway').value = DEV_BUILD ? await stored(GATEWAY_KEY, DEFAULT_GATEWAY) : DEFAULT_GATEWAY
  if (!DEV_BUILD) document.querySelector('.foot').hidden = true

  refreshMode()

  // The app is where an identity is claimed; this popup only ever reports the
  // result and holds the key behind it.
  el('open-app').href = el('gateway').value.trim()

  const existing = await gateway().reverseName(identity.publicKeyHex)
  if (existing) {
    showName(existing)
  } else {
    setStatus(el('name-status'), 'No name yet — claim one in the app, then reopen this.')
  }
}

el('copy-name').addEventListener('click', () => {
  navigator.clipboard.writeText(myName.name)
  el('copy-name').textContent = 'Copied'
  setTimeout(() => (el('copy-name').textContent = 'Copy name'), 1200)
})

/**
 * The key is the only thing that can ever decrypt what was sent to it. Losing
 * it loses every file, so it can be written down — once, deliberately.
 */
el('backup').addEventListener('click', () => {
  const backup = {
    name: myName?.name ?? null,
    publicKey: identity.publicKeyHex,
    privateKey: toHex(identity.privateKey),
    warning: 'Anyone holding this private key can read every file ever sent to this name.',
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${myName?.label ?? 'pinesign'}.key.json`
  a.click()
  URL.revokeObjectURL(url)
})

// ---- addressing ----

let resolveTimer = null
el('recipient').addEventListener('input', () => {
  recipient = null
  el('resolved').textContent = ''
  el('resolved').className = 'resolved'
  readyToSend()

  const name = el('recipient').value.trim().toLowerCase()
  if (name.length < 3) return

  clearTimeout(resolveTimer)
  resolveTimer = setTimeout(async () => {
    try {
      const record = await gateway().resolveName(name)
      if (record.pubKey === identity.publicKeyHex) {
        el('resolved').textContent = 'That is you.'
        el('resolved').className = 'resolved error'
        return
      }
      recipient = record
      el('resolved').textContent = `Found — key ${record.pubKey.slice(0, 10)}…`
      el('resolved').className = 'resolved ok'
    } catch {
      el('resolved').textContent = 'No such name.'
      el('resolved').className = 'resolved error'
    }
    readyToSend()
  }, 250)
})

el('file').addEventListener('change', readyToSend)

el('gateway').addEventListener('change', async () => {
  await chrome.storage.local.set({ [GATEWAY_KEY]: el('gateway').value.trim() })
  refreshMode()
})

// ---- sending ----

el('send').addEventListener('click', async () => {
  el('send').disabled = true
  el('result').hidden = true

  try {
    const file = el('file').files[0]
    say('Reading file…')
    const plaintext = new Uint8Array(await file.arrayBuffer())

    // The key is derived, never transmitted: our private key plus their public
    // key gives the same secret they will compute from the other direction.
    say('Deriving shared key…')
    const sharedKey = deriveSharedKey(identity.privateKey, fromHex(recipient.pubKey))

    say('Encrypting…')
    const ciphertext = encrypt(plaintext, sharedKey)
    const plaintextHash = toHex(hashPlaintext(plaintext))

    // Committing to the transfer before the recipient has seen it: this
    // signature is what proves the file came from us.
    const digest = transferDigest({
      senderPubKey: identity.publicKeyHex,
      recipientPubKey: recipient.pubKey,
      plaintextHash,
    })

    say('Uploading to the gateway…')
    const result = await gateway().send(signer, {
      recipientPubKey: recipient.pubKey,
      plaintextHash,
      senderSignature: toHex(sign(digest, identity.privateKey)),
      filename: file.name,
      ciphertext: toBase64(ciphertext),
      requireExtension: el('require-extension').checked,
    })

    el('claim-link').textContent = result.claimUrl
    el('result').hidden = false
    const days = Math.round((result.expiresAt - Date.now()) / 86400000)
    say(`Sent to ${recipient.name}. Gone in ${days} day${days === 1 ? '' : 's'}.`, 'done')
  } catch (err) {
    say(err.message, 'error')
  } finally {
    readyToSend()
  }
})

el('copy-link').addEventListener('click', () => {
  navigator.clipboard.writeText(el('claim-link').textContent)
  el('copy-link').textContent = 'Copied'
  setTimeout(() => (el('copy-link').textContent = 'Copy link'), 1200)
})

init()
