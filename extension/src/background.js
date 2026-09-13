/**
 * Extension service worker.
 *
 * The private key lives here and nowhere else. Pages never receive it — they
 * ask the extension to do the work and get back only a result: a public key, a
 * decrypted file, a signature. A compromised page learns nothing it could reuse.
 */

import {
  deriveSharedKey,
  encrypt,
  decrypt,
  hashPlaintext,
  transferDigest,
  sign,
  toHex,
  fromHex,
  keccak256,
} from '../../shared/crypto.js'
import { getOrCreateIdentity } from '../../shared/identity.js'

/** Public surface a web page is allowed to reach. */
const handlers = {
  /** Who am I? Public half only. */
  async identity() {
    const id = await getOrCreateIdentity()
    return { publicKey: id.publicKeyHex, address: id.address }
  },

  /**
   * Decrypt a transfer and sign its receipt, in one step.
   *
   * Deliberately one call: handing a page the plaintext and then trusting it to
   * come back for the signature would let it take the file and skip the receipt.
   * Here, decrypting and attesting are the same operation.
   */
  async openTransfer({ ciphertext, senderPubKey, expectedCommitment }) {
    const id = await getOrCreateIdentity()
    const sharedKey = deriveSharedKey(id.privateKey, fromHex(senderPubKey))
    const plaintext = decrypt(Uint8Array.from(ciphertext), sharedKey)

    const hash = toHex(hashPlaintext(plaintext))
    // The sender committed to keccak(hash), not to the hash itself — so the
    // check is against the commitment, and the hash stays ours to reveal.
    if (expectedCommitment && keccak256(fromHex(hash)) !== expectedCommitment.toLowerCase()) {
      throw new Error('the decrypted file does not match what the sender committed to')
    }

    const digest = transferDigest({
      senderPubKey,
      recipientPubKey: id.publicKeyHex,
      plaintextHash: hash,
    })

    return {
      plaintext: Array.from(plaintext),
      plaintextHash: hash,
      signature: toHex(sign(digest, id.privateKey)),
    }
  },

  /** Encrypt for a recipient, and commit to the transfer. */
  async sealTransfer({ plaintext, recipientPubKey }) {
    const id = await getOrCreateIdentity()
    const bytes = Uint8Array.from(plaintext)
    const sharedKey = deriveSharedKey(id.privateKey, fromHex(recipientPubKey))
    const ciphertext = encrypt(bytes, sharedKey)
    const plaintextHash = toHex(hashPlaintext(bytes))

    const digest = transferDigest({
      senderPubKey: id.publicKeyHex,
      recipientPubKey,
      plaintextHash,
    })

    return {
      ciphertext: Array.from(ciphertext),
      plaintextHash,
      senderSignature: toHex(sign(digest, id.privateKey)),
      senderPubKey: id.publicKeyHex,
    }
  },

  /** Sign an arbitrary digest — used for gateway nonces. */
  async signDigest({ digest }) {
    const id = await getOrCreateIdentity()
    return { signature: toHex(sign(fromHex(digest), id.privateKey)) }
  },
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const handler = handlers[message?.type]
  if (!handler) {
    respond({ ok: false, error: `unknown request: ${message?.type}` })
    return false
  }
  handler(message.payload ?? {})
    .then((result) => respond({ ok: true, result }))
    .catch((err) => respond({ ok: false, error: err.message }))
  return true // keep the channel open for the async reply
})
