/**
 * Transfer registry.
 *
 * Tonight this is the stand-in for the receipt contract and the ephemeral ENS
 * subname: it holds the transfer record, it expires, and it refuses a second
 * claim. The contract in contracts/ is the real version of `claim` — same
 * write-once rule, same two signatures.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FILE = path.resolve('.storage/transfers.json')
const TTL_MS = Number(process.env.TRANSFER_TTL_MS ?? 3 * 24 * 60 * 60 * 1000)

let transfers = null

async function load() {
  if (transfers) return transfers
  try {
    transfers = JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    transfers = {}
  }
  return transfers
}

async function persist() {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(transfers, null, 2))
}

export async function create(record) {
  const all = await load()
  all[record.id] = {
    ...record,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    claim: null,
  }
  await persist()
  return all[record.id]
}

export async function get(id) {
  const all = await load()
  const t = all[id]
  if (!t) return null
  // Expiry is passive, exactly as the Swarm stamp and the ENS name are: nothing
  // is deleted on a schedule, the record simply stops being valid.
  if (Date.now() > t.expiresAt && !t.claim) return { ...t, expired: true }
  return t
}

export async function recordClaim(id, claim) {
  const all = await load()
  const t = all[id]
  if (!t) throw new Error('unknown transfer')
  if (t.claim) throw new Error('already claimed')
  if (Date.now() > t.expiresAt) throw new Error('transfer expired')
  t.claim = { ...claim, claimedAt: Date.now() }
  await persist()
  return t
}

export async function list() {
  return Object.values(await load())
}
