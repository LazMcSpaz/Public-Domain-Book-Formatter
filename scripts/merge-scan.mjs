/**
 * Merge a volume's upload chunks back into one PDF.
 *
 * The archive hands a scanned volume over in thirty-odd-leaf pieces, and every
 * part of this app that touches pixels wants the volume. There is no `qpdf` or
 * `pdftk` in this container, but `pdf-lib` is already a dependency and
 * `copyPages` moves the JPEG 2000 streams across without re-encoding them — so
 * nothing is lost and nothing is invented.
 *
 * Two things this refuses to do quietly, because both have cost real time.
 *
 * **It will not merge a mixed set.** The chunk name carries an archive id, and
 * a directory holding two volumes of one work holds two ids. Sorting the
 * filenames and taking what matches `*.pdf` is how Vol. II gets assembled under
 * Vol. I's name — a book with the right page count, the wrong words, and no
 * sign of either. So the id is given, not inferred, and a file that does not
 * carry it is not merged.
 *
 * **It will not report a size it did not measure.** A run is filed under
 * `name\0size\0modified`, so a merge that comes out a byte different from the
 * reading's own is a book the reading cannot be found against. `--expect`
 * states the number and a mismatch is an error, not a warning.
 *
 * Run it under `node --max-old-space-size=8192`; a volume takes a couple of
 * minutes.
 *
 *   node --max-old-space-size=8192 scripts/merge-scan.mjs \
 *     --dir <chunk directory> --id coo1-ark--13960-t6640b80d-1788977050 \
 *     --out isis-vol1.pdf --expect 356942489
 *
 * **Chunks whose names say nothing** — named by their SHA-256 on the shelf, as
 * The Secret Doctrine's are — carry no span to check and no id to select by.
 * Their order is read off the leaves (part heads, opening folios) by whoever
 * builds the manifest, and the manifest is the record of it:
 *
 *   node scripts/merge-scan.mjs --manifest <chunks.json> --root <shelf> --out vol2.pdf
 *
 * `chunks.json` is `{ "chunks": [{ "path", "sha256", "leaves", "folios" }] }`,
 * in order. Every chunk's digest and leaf count is checked against the file,
 * because a manifest that names the right chunk and gets the wrong bytes is a
 * volume with somebody else's leaves in it. `gaps` in the manifest is refused
 * unless every gap is marked `blank`: a missing chunk is a hole that every
 * later leaf number points past. And the output carries no timestamp, so the
 * same chunks always give the same bytes — a volume rebuilt from the shelf is
 * the one a reading was filed against, without the merged PDF having to sit in
 * the shelf's history as well. Chunks that are encrypted are read from
 * `--decrypted <dir>`, written there by `decrypt-chunks.mjs` under the
 * original's digest; the digest checked is still the original's.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const manifestPath = arg('manifest')
if (manifestPath) await fromManifest(manifestPath)

async function fromManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const root = resolve(arg('root', '.'))
  const out = resolve(arg('out', 'merged.pdf'))
  const holes = (manifest.gaps ?? []).filter((g) => !g.blank)
  if (holes.length > 0) {
    for (const g of holes) console.error(`Missing: ${g.what ?? JSON.stringify(g)}`)
    console.error('This manifest has a gap that is not a blank leaf. Nothing was merged.')
    process.exit(1)
  }
  // No producer and no dates: the same chunks must give the same bytes.
  const merged = await PDFDocument.create({ updateMetadata: false })
  let pagesIn = 0
  for (const chunk of manifest.chunks) {
    const bytes = readFileSync(join(root, chunk.path))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (chunk.sha256 && digest !== chunk.sha256) {
      console.error(`${chunk.path}: sha256 is ${digest}, the manifest says ${chunk.sha256}.`)
      process.exit(1)
    }
    const decrypted = arg('decrypted')
    const src = decrypted
      ? await PDFDocument.load(readFileSync(join(resolve(decrypted), `${digest}.pdf`)))
      : await PDFDocument.load(bytes)
    const indices = src.getPageIndices()
    if (chunk.leaves != null && indices.length !== chunk.leaves) {
      console.error(
        `${chunk.path} holds ${indices.length} leaves; the manifest says ${chunk.leaves}.`
      )
      process.exit(1)
    }
    for (const p of await merged.copyPages(src, indices)) merged.addPage(p)
    pagesIn += indices.length
    console.log(`  ${chunk.folios ?? ''}  ${chunk.path} → ${pagesIn} leaves`)
  }
  writeFileSync(out, await merged.save({ useObjectStreams: false }))
  const digest = createHash('sha256').update(readFileSync(out)).digest('hex')
  console.log(`${out} — ${pagesIn} leaves, ${statSync(out).size} bytes, sha256 ${digest}`)
  if (manifest.output?.sha256 && manifest.output.sha256 !== digest) {
    console.error(`The manifest records ${manifest.output.sha256}; this merge is not that file.`)
    process.exit(1)
  }
  process.exit(0)
}

const dir = resolve(arg('dir', '.'))
const id = arg('id')
const out = resolve(arg('out', 'merged.pdf'))
const expect = arg('expect') ? Number(arg('expect')) : null

if (!id) {
  console.error('--id is required: the archive id every chunk of this volume carries.')
  process.exit(1)
}

// Named by their id and sorted lexically. The page spans in these names are
// zero-padded, which is what makes a lexical sort the right order — luck rather
// than a guarantee, so the spans are checked below rather than trusted.
const chunks = readdirSync(dir)
  .filter((f) => f.startsWith(id) && f.endsWith('.pdf'))
  .sort()

if (chunks.length === 0) {
  console.error(`No chunk in ${dir} begins with ${id}.`)
  process.exit(1)
}

// The spans have to run consecutively from the first leaf with no gap and no
// overlap. A missing chunk is a book with a hole in it that every later leaf
// number then points past, and nothing downstream could tell.
const spans = chunks.map((f) => {
  const m = /_p(\d+)_(\d+)\.pdf$/.exec(f)
  if (!m) throw new Error(`Cannot read a page span out of ${f}`)
  return { file: f, from: Number(m[1]), to: Number(m[2]) }
})
for (let i = 1; i < spans.length; i++) {
  const previous = spans[i - 1]
  const here = spans[i]
  if (here.from !== previous.to + 1) {
    console.error(
      `The spans do not run consecutively: ${previous.file} ends at ${previous.to} ` +
        `and ${here.file} begins at ${here.from}.`
    )
    process.exit(1)
  }
}

console.log(`${chunks.length} chunk(s) of ${id}, leaves ${spans[0].from}–${spans.at(-1).to}`)

const merged = await PDFDocument.create()
let pagesIn = 0
for (const { file, from, to } of spans) {
  const src = await PDFDocument.load(readFileSync(join(dir, file)))
  const indices = src.getPageIndices()
  // Read out of the file, never taken from the name: the count in the filename
  // is what the uploader meant and the count in the PDF is what arrived, and a
  // truncated upload is exactly the case where they differ.
  const claimed = to - from + 1
  if (indices.length !== claimed) {
    console.error(`${file} names ${claimed} page(s) and holds ${indices.length}.`)
    process.exit(1)
  }
  for (const p of await merged.copyPages(src, indices)) merged.addPage(p)
  pagesIn += indices.length
  process.stdout.write(`  ${file} → ${pagesIn} leaves\r`)
}
console.log(`\n${pagesIn} leaves copied`)

writeFileSync(out, await merged.save({ useObjectStreams: false }))
const size = statSync(out).size
console.log(`${out} — ${size} bytes`)

if (expect !== null && size !== expect) {
  console.error(
    `\nExpected ${expect} bytes and got ${size}. A run is filed under ` +
      '`name\\0size\\0modified`, so this file would not be found against the reading ' +
      'already done. Nothing has been deleted; look at the chunk list above.'
  )
  process.exit(1)
}
if (expect !== null) console.log('and it matches the size the reading is filed under.')
