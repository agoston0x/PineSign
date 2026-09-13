/**
 * Invitations.
 *
 * A transfer cannot begin until the recipient has a key, so it starts with an
 * invitation: the sender names an email address, the recipient signs up from
 * the link, and the sender is told they may now send. The invitation is the
 * only place an email address is stored, and it is the sender who supplied it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { storagePath } from './paths.js'

const FILE = storagePath('invites.json')
const TTL_MS = 7 * 24 * 60 * 60 * 1000

let invites = null

async function load() {
  if (invites) return invites
  try {
    invites = JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    invites = {}
  }
  return invites
}

async function persist() {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(invites, null, 2))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validEmail(s) {
  return typeof s === 'string' && EMAIL.test(s) && s.length < 200
}

export async function create({ fromPubKey, fromName, fromEmail, toEmail }) {
  if (!validEmail(toEmail)) throw new Error('that is not an email address')
  const all = await load()
  const id = randomBytes(12).toString('hex')
  all[id] = {
    id,
    fromPubKey,
    fromName,
    fromEmail: validEmail(fromEmail) ? fromEmail : null,
    toEmail,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    acceptedBy: null,
  }
  await persist()
  return all[id]
}

export async function get(id) {
  const all = await load()
  const inv = all[id]
  if (!inv) return null
  if (inv.status === 'pending' && Date.now() > inv.expiresAt) return { ...inv, status: 'expired' }
  return inv
}

/** The recipient has a name now; the sender can be told. */
export async function accept(id, { pubKey, name }) {
  const all = await load()
  const inv = all[id]
  if (!inv) throw new Error('unknown invitation')
  if (inv.status !== 'pending') throw new Error(`invitation is ${inv.status}`)
  if (Date.now() > inv.expiresAt) throw new Error('invitation expired')
  inv.status = 'accepted'
  inv.acceptedBy = { pubKey, name, at: Date.now() }
  await persist()
  return inv
}

/** Sender's view: everything they have sent out. */
export async function bySender(pubKey) {
  const all = await load()
  return Object.values(all).filter((i) => i.fromPubKey === pubKey)
}

/** The email an invitation was sent to — how a recipient is reached later. */
export async function emailFor(pubKey) {
  const all = await load()
  const hit = Object.values(all).find((i) => i.acceptedBy?.pubKey === pubKey)
  return hit?.toEmail ?? null
}

/** The sender's own email, if they gave one when inviting. */
export async function senderEmailFor(pubKey) {
  const all = await load()
  const hit = Object.values(all).find((i) => i.fromPubKey === pubKey && i.fromEmail)
  return hit?.fromEmail ?? null
}
