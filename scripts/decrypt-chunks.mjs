/**
 * Take the permissions lock off every chunk a merge manifest names.
 *
 * The Theosophical University Press chunks of The Secret Doctrine are all
 * encrypted with an empty user password: pdf.js opens them without asking, and
 * `pdf-lib` refuses them outright, so `merge-scan.mjs` cannot copy a page. What
 * decrypts them is mupdf, which is **not** a dependency of this app and should
 * not become one for a step run once per volume:
 *
 *   npm install --no-save mupdf
 *   node scripts/decrypt-chunks.mjs <chunks.json> --root <shelf> --out <dir>
 *   node scripts/merge-scan.mjs --manifest <chunks.json> --root <shelf> --decrypted <dir> --out <vol.pdf>
 *
 * Each copy is written as `<dir>/<sha256 of the original>.pdf`, so the merge can
 * check the original's digest and still find the copy. A chunk that needs a real
 * password is refused: nothing here guesses one. mupdf writes the same bytes
 * every time, which is what lets a merged volume be rebuilt rather than stored.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const manifestPath = process.argv[2]
const root = resolve(arg('root', '.'))
const out = resolve(arg('out', 'decrypted'))
if (!manifestPath || manifestPath.startsWith('--')) {
  console.error('usage: node scripts/decrypt-chunks.mjs <chunks.json> --root <shelf> --out <dir>')
  process.exit(2)
}

let mupdf
try {
  mupdf = await import('mupdf')
} catch {
  console.error('mupdf is not installed. `npm install --no-save mupdf`, then run this again.')
  process.exit(1)
}

mkdirSync(out, { recursive: true })
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const chunk of manifest.chunks) {
  const bytes = readFileSync(join(root, chunk.path))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const doc = mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  if (doc.needsPassword()) {
    console.error(`${chunk.path} needs a password. Nothing further was decrypted.`)
    process.exit(1)
  }
  writeFileSync(join(out, `${digest}.pdf`), doc.saveToBuffer('encrypt=none').asUint8Array())
  console.log(`  ${chunk.path} → ${digest.slice(0, 12)}….pdf, ${doc.countPages()} leaves`)
}
