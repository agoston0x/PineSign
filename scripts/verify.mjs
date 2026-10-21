#!/usr/bin/env node
/**
 * Verify a transfer from chain alone.
 *
 *   PINESIGN_PARENT=example.eth ENS_REGISTRY=0x… RPC_URL=https://… \
 *     node scripts/verify.mjs <transfer-id>
 *
 * Reads the resolver from the ENS registry, reads the records, and checks both
 * signatures and the hash commitment. No server belonging to whoever sent you the file
 * is contacted at any point — which is the entire reason this script exists. If it
 * trusted a gateway to tell it what the records said, it would be proving nothing.
 *
 * Nothing is hardcoded: a deployment's own name, registry and RPC are its business, and
 * baking any of them in here would quietly make this script wrong for everybody else.
 */

import { createPublicClient, http, parseAbi, keccak256 as viemKeccak } from 'viem'
import { sepolia } from 'viem/chains'
import { namehash } from '../gateway/ens.js'
import { transferDigest, verify, fromHex } from '../shared/crypto.js'

const [id, parentArg] = process.argv.slice(2)

const need = (value, name, how) => {
  if (value) return value
  console.error(`${name} is not set. ${how}`)
  process.exit(1)
}

const parent = parentArg ?? process.env.PINESIGN_PARENT
const REGISTRY = process.env.ENS_REGISTRY
const RPC = process.env.RPC_URL

if (!id) {
  console.error('usage: node scripts/verify.mjs <transfer-id> [parent-name]')
  console.error('env:   PINESIGN_PARENT, ENS_REGISTRY, RPC_URL')
  process.exit(1)
}
need(parent, 'PINESIGN_PARENT', 'Pass it as the second argument, or set it — e.g. example.eth')
need(REGISTRY, 'ENS_REGISTRY', 'The ENS registry address on whichever chain the receipt lives.')
need(RPC, 'RPC_URL', 'Any RPC for that chain. A public one is fine; it is only read from.')

const c = createPublicClient({ chain: sepolia, transport: http(RPC) })

const label = parent.replace(/\.eth$/, '')
const resolver = await c.readContract({
  address: REGISTRY, abi: parseAbi(['function getResolver(string) view returns (address)']),
  functionName: 'getResolver', args: [label],
})
const name = `${id}.tx.${parent}`
const node = namehash(name)
const abi = parseAbi(['function text(bytes32,string) view returns (string)', 'function frozen(bytes32) view returns (bool)'])
const text = (k) => c.readContract({ address: resolver, abi, functionName: 'text', args: [node, k] })

const keys = ['sender', 'sender.key', 'sender.sig', 'recipient', 'recipient.key', 'file.name', 'file.commitment', 'file.hash', 'swarm', 'sent', 'recipient.sig', 'delivered']
const r = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await text(k)])))
const frozen = await c.readContract({ address: resolver, abi, functionName: 'frozen', args: [node] })

console.log(`\n${name}`)
console.log(`resolver ${resolver} (from ENS registry, not from PineSign)\n`)
for (const k of keys) console.log(`  ${k.padEnd(16)} ${r[k] || '—'}`)

console.log('\nchecks')
const ok = (label, v) => console.log(`  ${v ? '✓' : '✗'} ${label}`)

const digest = transferDigest({ senderPubKey: r['sender.key'], recipientPubKey: r['recipient.key'], plaintextHash: r['file.hash'] })
ok('sender signature valid over (sender.key, recipient.key, file.hash)', r['sender.sig'] && verify(fromHex(r['sender.sig']), digest, fromHex(r['sender.key'])))
ok('recipient signature valid over the same digest', r['recipient.sig'] && verify(fromHex(r['recipient.sig']), digest, fromHex(r['recipient.key'])))
ok('file.hash matches the commitment made at send time', r['file.hash'] && viemKeccak(`0x${r['file.hash']}`) === r['file.commitment'])
ok('record is frozen (no one can amend it)', frozen)
ok('delivered', Boolean(r['delivered']))

console.log(`\nswarm reference ${r['swarm']}\n  fetch: curl http://<any-bee-node>:1633/bytes/${r['swarm']}  (ciphertext; only ${r['recipient']} can open it)\n`)
