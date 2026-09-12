/**
 * Where this server keeps its state.
 *
 * A single definition, overridable, so a test run can be given its own
 * directory instead of sharing — and quietly overwriting — the real one.
 */

import path from 'node:path'

export const STORAGE_DIR = path.resolve(process.env.PINESIGN_STORAGE_DIR ?? '.storage')

export function storagePath(...parts) {
  return path.join(STORAGE_DIR, ...parts)
}
