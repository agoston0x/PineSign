/**
 * Identity storage.
 *
 * One secp256k1 keypair per install. It is generated locally, never sent
 * anywhere, and is the only thing that can decrypt what was sent to it — the
 * gateway cannot recover a file even if it wanted to.
 */

import { generatePrivateKey, publicKeyFrom, addressFrom, toHex, fromHex } from './crypto.js'

const KEY = 'pinesign.identity'

const store = {
  async get() {
    if (globalThis.chrome?.storage?.local) {
      const out = await chrome.storage.local.get(KEY)
      return out[KEY] ?? null
    }
    return localStorage.getItem(KEY)
  },
  async set(value) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.set({ [KEY]: value })
    localStorage.setItem(KEY, value)
  },
}

function hydrate(privateKeyHex) {
  const privateKey = fromHex(privateKeyHex)
  return {
    privateKey,
    publicKey: publicKeyFrom(privateKey),
    publicKeyHex: toHex(publicKeyFrom(privateKey)),
    address: addressFrom(privateKey),
  }
}

export async function loadIdentity() {
  const stored = await store.get()
  return stored ? hydrate(stored) : null
}

export async function createIdentity() {
  const privateKeyHex = toHex(generatePrivateKey())
  await store.set(privateKeyHex)
  return hydrate(privateKeyHex)
}

export async function getOrCreateIdentity() {
  return (await loadIdentity()) ?? (await createIdentity())
}

export async function importIdentity(privateKeyHex) {
  const clean = privateKeyHex.trim().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('expected a 64-character hex private key')
  await store.set(clean.toLowerCase())
  return hydrate(clean.toLowerCase())
}
