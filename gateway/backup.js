/**
 * Key backup.
 *
 * The deployer key exists in exactly one place, and anything that removes
 * .storage destroys it along with whatever it holds. A copy is written outside
 * that directory the moment a key is generated, so a wipe is recoverable.
 */

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const DIR = process.env.PINESIGN_BACKUP_DIR ?? path.join(os.homedir(), '.pinesign', 'keys')

/** Written once per key, named by address so nothing is ever overwritten. */
export async function backupDeployer(deployer, context = {}) {
  await mkdir(DIR, { recursive: true })
  const file = path.join(DIR, `${deployer.address}.json`)
  await writeFile(
    file,
    JSON.stringify({ ...deployer, ...context, backedUpAt: new Date().toISOString() }, null, 2),
    { mode: 0o600, flag: 'wx' },
  ).catch((err) => {
    if (err.code !== 'EEXIST') throw err // already backed up, which is the point
  })
  return file
}

/** Keys from previous runs, so a wiped .storage can be pointed back at one. */
export async function listBackups() {
  try {
    const files = await readdir(DIR)
    return Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          const { address, backedUpAt, parentName } = JSON.parse(await readFile(path.join(DIR, f), 'utf8'))
          return { address, backedUpAt, parentName, file: path.join(DIR, f) }
        }),
    )
  } catch {
    return []
  }
}

export const BACKUP_DIR = DIR
