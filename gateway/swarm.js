/**
 * Swarm storage.
 *
 * The gateway is the only party holding Swarm credentials — users never learn
 * what a postage stamp is. Once the admin panel has bought a batch, uploads go
 * to the real network; until then blobs land in .storage/ so the rest of the
 * system can be worked on without a funded node.
 */

import { Bee } from '@ethersphere/bee-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { BEE_URL } from './bee.js'
import * as setup from './setup.js'
import { storagePath } from './paths.js'

const LOCAL_DIR = storagePath('blobs')

let bee = null

/**
 * The batch comes from configuration rather than the environment, so buying one
 * in the admin panel is enough to switch modes — no restart, no env editing.
 */
async function batchId() {
  return (await setup.get()).postageBatchId ?? process.env.POSTAGE_BATCH_ID ?? null
}

export async function mode() {
  return (await batchId()) ? 'swarm' : 'local'
}

function client() {
  bee ??= new Bee(BEE_URL)
  return bee
}

export async function upload(bytes) {
  const batch = await batchId()

  if (batch) {
    const result = await client().uploadData(batch, bytes)
    return result.reference.toString()
  }

  // Local fallback: address the blob by its own hash, as Swarm does, so a
  // reference means the same thing in both modes.
  const ref = createHash('sha256').update(bytes).digest('hex')
  await mkdir(LOCAL_DIR, { recursive: true })
  await writeFile(path.join(LOCAL_DIR, ref), bytes)
  return ref
}

export async function download(reference) {
  if (await batchId()) {
    const data = await client().downloadData(reference)
    return new Uint8Array(data.toUint8Array())
  }
  return new Uint8Array(await readFile(path.join(LOCAL_DIR, reference)))
}

/** What the health endpoint reports about storage. */
export async function stampInfo() {
  const current = await mode()
  if (current !== 'swarm') return { mode: current, usable: true, batchTTL: null }

  const batch = await client().getPostageBatch(await batchId())
  return {
    mode: current,
    usable: batch.usable,
    batchTTL: batch.batchTTL,
    utilization: batch.utilization,
    depth: batch.depth,
  }
}
