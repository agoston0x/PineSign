/** Bundles the browser code. */

import './gateway/env.js' // PUBLIC_ORIGIN from .env, so the extension knows its server
import { build } from 'esbuild'

/**
 * The extension is downloaded from the server that built it, so the server's
 * own address is compiled in. A dev build with no PUBLIC_ORIGIN falls back to
 * localhost and keeps the field editable.
 */
const GATEWAY = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8788'
console.log(`  extension gateway: ${GATEWAY}`)

const targets = [
  { in: 'extension/src/popup.js', out: 'extension/lib/popup.bundle.js' },
  { in: 'extension/src/background.js', out: 'extension/lib/background.bundle.js' },
  { in: 'web/src/claim.js', out: 'web/claim.bundle.js' },
  { in: 'web/src/setup.js', out: 'web/setup.bundle.js' },
  { in: 'web/src/lander.js', out: 'web/lander.bundle.js' },
  { in: 'web/src/callback.js', out: 'web/callback.bundle.js' },
  { in: 'web/src/nav.js', out: 'web/nav.bundle.js' },
]

import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

for (const target of targets) {
  const result = await build({
    entryPoints: [target.in],
    outfile: target.out,
    bundle: true,
    format: 'esm',
    metafile: true,
    // The Circle SDK is imported from a CDN by URL; leave it to the browser.
    external: ['https://*'],
    define: { __PINESIGN_GATEWAY__: JSON.stringify(GATEWAY) },
  })
  const bytes = Object.values(result.metafile.outputs)[0].bytes
  console.log(`  ${target.out}  ${(bytes / 1024).toFixed(0)}kb`)
}

// The extension, zipped for download from the site. Bundles are built above,
// so the archive is always current with them.
rmSync('web/pinesign-extension.zip', { force: true })
execSync(
  'cd extension && zip -qr ../web/pinesign-extension.zip manifest.json popup.html popup.css content.js icons lib',
  { stdio: 'inherit' },
)
console.log('  web/pinesign-extension.zip')
