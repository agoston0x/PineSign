/**
 * End-to-end: Alice encrypts and sends, Bob decrypts and claims, and the
 * things that must not be possible are not possible.
 */

import {
  generatePrivateKey, publicKeyFrom, deriveSharedKey, encrypt, decrypt,
  hashPlaintext, transferDigest, sign, toHex, fromHex,
} from '../shared/crypto.js'
import { sha256 } from '@noble/hashes/sha256'

const BASE = process.env.BASE ?? 'http://localhost:8799'
let pass = 0, fail = 0

function check(label, condition) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  condition ? pass++ : fail++
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function auth(priv, pub) {
  const { body } = await post('/api/nonce', { pubKey: pub })
  const signature = toHex(sign(sha256(new TextEncoder().encode(body.nonce)), priv))
  return { pubKey: pub, nonce: body.nonce, signature }
}

const alicePriv = generatePrivateKey(), alicePub = toHex(publicKeyFrom(alicePriv))
const bobPriv = generatePrivateKey(), bobPub = toHex(publicKeyFrom(bobPriv))
const evePriv = generatePrivateKey(), evePub = toHex(publicKeyFrom(evePriv))

const plaintext = new TextEncoder().encode('The quiet part, written down. ' + Date.now())
const plaintextHash = toHex(hashPlaintext(plaintext))

console.log('\nsend')
const sharedAlice = deriveSharedKey(alicePriv, fromHex(bobPub))
const ciphertext = encrypt(plaintext, sharedAlice)
const digest = transferDigest({ senderPubKey: alicePub, recipientPubKey: bobPub, plaintextHash })

const sent = await post('/api/send', {
  ...(await auth(alicePriv, alicePub)),
  recipientPubKey: bobPub,
  plaintextHash,
  senderSignature: toHex(sign(digest, alicePriv)),
  filename: 'note.txt',
  ciphertext: Buffer.from(ciphertext).toString('base64'),
})
check('gateway accepts the transfer', sent.status === 200 && sent.body.id)
check('gateway returns a swarm reference', Boolean(sent.body.reference))
const id = sent.body.id

console.log('\nauth')
const stale = await post('/api/send', {
  pubKey: alicePub, nonce: 'never-issued', signature: '00'.repeat(64),
  recipientPubKey: bobPub, plaintextHash, senderSignature: '00'.repeat(64),
  ciphertext: 'AAAA',
})
check('unknown nonce is rejected', stale.status === 401)

const a = await auth(alicePriv, alicePub)
await post('/api/send', { ...a, recipientPubKey: bobPub, plaintextHash, senderSignature: toHex(sign(digest, alicePriv)), ciphertext: Buffer.from(ciphertext).toString('base64') })
const replay = await post('/api/send', { ...a, recipientPubKey: bobPub, plaintextHash, senderSignature: toHex(sign(digest, alicePriv)), ciphertext: Buffer.from(ciphertext).toString('base64') })
check('a nonce cannot be replayed', replay.status === 401)

console.log('\nreceive')
const record = await (await fetch(`${BASE}/api/transfer/${id}`)).json()
check('record names the recipient', record.recipientPubKey === bobPub)
check('record carries no plaintext', !JSON.stringify(record).includes('quiet part'))

const blob = new Uint8Array(await (await fetch(`${BASE}/api/blob/${id}`)).arrayBuffer())
check('stored blob is not the plaintext', !Buffer.from(blob).toString().includes('quiet part'))

const sharedBob = deriveSharedKey(bobPriv, fromHex(record.senderPubKey))
const recovered = decrypt(blob, sharedBob)
check('bob decrypts to the original', Buffer.from(recovered).equals(Buffer.from(plaintext)))
check('hash matches the commitment', toHex(hashPlaintext(recovered)) === record.plaintextHash)

console.log('\neve')
let eveFailed = false
try {
  const eveKey = deriveSharedKey(evePriv, fromHex(record.senderPubKey))
  decrypt(blob, eveKey)
} catch {
  eveFailed = true
}
check('a third party cannot decrypt', eveFailed)

const eveClaim = await post('/api/claim', {
  ...(await auth(evePriv, evePub)),
  id,
  claimSignature: toHex(sign(fromHex(record.digest), evePriv)),
})
check('a third party cannot claim', eveClaim.status === 403)

console.log('\nclaim')
const claimSig = toHex(sign(transferDigest({
  senderPubKey: record.senderPubKey, recipientPubKey: bobPub, plaintextHash: record.plaintextHash,
}), bobPriv))
const claimed = await post('/api/claim', { ...(await auth(bobPriv, bobPub)), id, claimSignature: claimSig })
check('bob claims successfully', claimed.status === 200 && claimed.body.claim)

const again = await post('/api/claim', { ...(await auth(bobPriv, bobPub)), id, claimSignature: claimSig })
check('a claim is write-once', again.status === 400 && /already claimed/.test(again.body.error))

const final = await (await fetch(`${BASE}/api/transfer/${id}`)).json()
check('receipt is on the record', Boolean(final.claim?.recipientSignature))

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
