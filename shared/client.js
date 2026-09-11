/**
 * Gateway client, shared by the extension and the claim page.
 *
 * It never handles a private key. Anything that needs signing goes through a
 * `signer`, which is a local keypair inside the extension and a message to the
 * extension everywhere else — so the same code works on a page that is not
 * allowed to know the key.
 */

import { sha256 } from '@noble/hashes/sha256'
import { sign, toHex } from './crypto.js'

/** Signer backed by a keypair in this context. Extension-side only. */
export function localSigner(identity) {
  return {
    publicKeyHex: identity.publicKeyHex,
    address: identity.address,
    async signDigest(digest) {
      return toHex(sign(digest, identity.privateKey))
    },
  }
}

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

  #post(path, body) {
    return this.#json(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  /** A fresh nonce, signed — the gateway's proof of who is asking. */
  async #auth(signer) {
    const pubKey = signer.publicKeyHex
    const { nonce } = await this.#post('/api/nonce', { pubKey })
    const signature = await signer.signDigest(sha256(new TextEncoder().encode(nonce)))
    return { pubKey, nonce, signature }
  }

  health() {
    return this.#json('/api/health')
  }

  async send(signer, payload) {
    return this.#post('/api/send', { ...(await this.#auth(signer)), ...payload })
  }

  transfer(id) {
    return this.#json(`/api/transfer/${id}`)
  }

  async blob(id) {
    const res = await fetch(`${this.baseUrl}/api/blob/${id}`)
    if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async claim(signer, id, claimSignature) {
    return this.#post('/api/claim', { ...(await this.#auth(signer)), id, claimSignature })
  }

  // ---- names ----

  /** Claim a name and publish an encryption key under it. */
  async registerName(signer, label) {
    return this.#post('/api/name/register', {
      ...(await this.#auth(signer)),
      label,
      address: signer.address ?? null,
    })
  }

  /** Name to key — how a sender finds out where to encrypt. */
  resolveName(name) {
    return this.#json(`/api/name/resolve/${encodeURIComponent(name)}`)
  }

  /** Key to name, for showing a person rather than a hex string. */
  async reverseName(pubKey) {
    try {
      return await this.#json(`/api/name/reverse/${pubKey}`)
    } catch {
      return null
    }
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
