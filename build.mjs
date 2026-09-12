/** Bundles the browser code. */

import { build } from 'esbuild'

const targets = [
  { in: 'extension/src/popup.js', out: 'extension/lib/popup.bundle.js' },
  { in: 'extension/src/background.js', out: 'extension/lib/background.bundle.js' },
  { in: 'web/src/claim.js', out: 'web/claim.bundle.js' },
  { in: 'web/src/setup.js', out: 'web/setup.bundle.js' },
  { in: 'web/src/lander.js', out: 'web/lander.bundle.js' },
  { in: 'web/src/callback.js', out: 'web/callback.bundle.js' },
  { in: 'web/src/nav.js', out: 'web/nav.bundle.js' },
]

for (const target of targets) {
  const result = await build({
    entryPoints: [target.in],
    outfile: target.out,
    bundle: true,
    format: 'esm',
    metafile: true,
    // The Circle SDK is imported from a CDN by URL; leave it to the browser.
    external: ['https://*'],
  })
  const bytes = Object.values(result.metafile.outputs)[0].bytes
  console.log(`  ${target.out}  ${(bytes / 1024).toFixed(0)}kb`)
}
