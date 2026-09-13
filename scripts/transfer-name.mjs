#!/usr/bin/env node
/**
 * Transfer this server's ENS name to another address.
 *
 *   node scripts/transfer-name.mjs 0xRecipientAddress
 *
 * Reads the owning key and the token id from .storage/config.json. This is the
 * escape hatch for a server you are abandoning: the name leaves with you.
 */

import '../gateway/env.js'
import { readFile } from 'node:fs/promises'
import { storagePath } from '../gateway/paths.js'
import { transferName } from '../gateway/ens.js'

const to = process.argv[2]
if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? '')) {
  console.error('usage: node scripts/transfer-name.mjs 0xRecipientAddress')
  process.exit(1)
}

const config = JSON.parse(await readFile(storagePath('config.json'), 'utf8'))
const reg = config.nameRegistration
if (!config.deployer?.privateKey) throw new Error('no deployer key in config')
if (!reg?.tokenId || !reg?.registry) {
  throw new Error('no token id recorded — this name was registered before ids were captured; ask for the id from the registry')
}

console.log(`transferring ${reg.name} (token ${reg.tokenId}) to ${to}…`)
const result = await transferName(config.deployer.privateKey, { registry: reg.registry, tokenId: reg.tokenId, to })
console.log('done:', result.tx)
