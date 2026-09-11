/**
 * Swarm adapter.
 *
 * The gateway is the only party holding Swarm credentials — users never learn
 * what a postage stamp is. Point BEE_URL + POSTAGE_BATCH_ID at a real Bee node
 * and uploads go to Swarm; leave them unset and blobs land in .storage/ so the
 * rest of the system can be demoed without a funded batch.
 */

import { Bee } from '@ethersphere/bee-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const BEE_URL = process.env.BEE_URL
const BATCH_ID = process.env.POSTAGE_BATCH_ID
const LOCAL_DIR = path.resolve('.storage')

export const mode = BEE_URL && BATCH_ID ? 'swarm' : 'local'

const bee = mode === 'swarm' ? new Bee(BEE_URL) : null

export async function upload(bytes) {
  if (mode === 'swarm') {
    const result = await bee.uploadData(BATCH_ID, bytes)
    return result.reference.toString()
  }
  // Local fallback: address the blob by its own hash, exactly as Swarm does,
  // so a reference means the same thing in both modes.
  const ref = createHash('sha256').update(bytes).digest('hex')
  await mkdir(LOCAL_DIR, { recursive: true })
  await writeFile(path.join(LOCAL_DIR, ref), bytes)
  return ref
}

export async function download(reference) {
  if (mode === 'swarm') {
    const data = await bee.downloadData(reference)
    return new Uint8Array(data.toUint8Array())
  }
  return new Uint8Array(await readFile(path.join(LOCAL_DIR, reference)))
}

export async function stampInfo() {
  if (mode !== 'swarm') return { mode, usable: true, batchTTL: null }
  const batch = await bee.getPostageBatch(BATCH_ID)
  return {
    mode,
    usable: batch.usable,
    batchTTL: batch.batchTTL,
    utilization: batch.utilization,
  }
}
