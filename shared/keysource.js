/**
 * Where the user's key lives.
 *
 * Two options, chosen by the user and detected here:
 *
 *   - the extension: installed once, never altered by any page. The server
 *     cannot touch the key even by serving bad code. Trustless, desktop only.
 *   - this page: the key sits in the browser's storage and the code that uses
 *     it arrives from the server on every load. Private in operation, but the
 *     user is trusting the code they were sent today. Works anywhere.
 *
 * Callers get the same interface either way, so nothing above this file needs
 * to know which was chosen.
 */

import * as bridge from './bridge.js'
import { getOrCreateIdentity } from './identity.js'
import { localSigner } from './client.js'
import {
  deriveSharedKey, encrypt, decrypt, hashPlaintext, transferDigest, sign, toHex, fromHex, keccak256,
} from './crypto.js'

let mode = null

/** 'extension' or 'page'. Decided once per page load. */
export async function keyMode() {
  if (mode) return mode
  mode = (await bridge.extensionPresent()) ? 'extension' : 'page'
  return mode
}

export async function identity() {
  if ((await keyMode()) === 'extension') return bridge.getIdentity()
  const id = await getOrCreateIdentity()
  return { publicKey: id.publicKeyHex, address: id.address }
}

export async function signer() {
  if ((await keyMode()) === 'extension') return bridge.bridgeSigner()
  return localSigner(await getOrCreateIdentity())
}

/** Decrypt a transfer and sign its receipt — one step, whichever key is used. */
export async function openTransfer({ ciphertext, senderPubKey, expectedCommitment }) {
  if ((await keyMode()) === 'extension') {
    return bridge.openTransfer({ ciphertext: Array.from(ciphertext), senderPubKey, expectedCommitment })
  }

  const id = await getOrCreateIdentity()
  const sharedKey = deriveSharedKey(id.privateKey, fromHex(senderPubKey))
  const plaintext = decrypt(Uint8Array.from(ciphertext), sharedKey)

  const hash = toHex(hashPlaintext(plaintext))
  // The sender committed to keccak(hash), not to the hash itself — so the
  // check is against the commitment, and the hash stays ours to reveal.
  if (expectedCommitment && keccak256(fromHex(hash)) !== expectedCommitment.toLowerCase()) {
    throw new Error('the decrypted file does not match what the sender committed to')
  }

  const digest = transferDigest({ senderPubKey, recipientPubKey: id.publicKeyHex, plaintextHash: hash })
  return { plaintext: Array.from(plaintext), plaintextHash: hash, signature: toHex(sign(digest, id.privateKey)) }
}
