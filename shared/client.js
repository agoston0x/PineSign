/**
 * Gateway client, shared by the extension and the claim page.
 *
 * Every write is authenticated by signing a one-time nonce, so the gateway
 * knows whose upload it is paying for without ever holding a credential.
 */

import { sha256 } from '@noble/hashes/sha256'
import { sign, toHex, fromHex } from './crypto.js'

export class Gateway {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async #json(path, options) {
    const res = await fetch(this.baseUrl + path, options)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
    return body
  }

  /** Fresh nonce, signed with the caller's key — the proof of identity. */
  async #authFields(identity) {
    const pubKey = toHex(identity.publicKey)
    const { nonce } = await this.#json('/api/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubKey }),
    })
    const signature = toHex(sign(sha256(new TextEncoder().encode(nonce)), identity.privateKey))
    return { pubKey, nonce, signature }
  }

  health() {
    return this.#json('/api/health')
  }

  async send(identity, payload) {
    return this.#json('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(await this.#authFields(identity)), ...payload }),
    })
  }

  transfer(id) {
    return this.#json(`/api/transfer/${id}`)
  }

  async blob(id) {
    const res = await fetch(`${this.baseUrl}/api/blob/${id}`)
    if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async claim(identity, id, claimSignature) {
    return this.#json('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(await this.#authFields(identity)), id, claimSignature }),
    })
  }
}

export function toBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export { toHex, fromHex }
