#!/usr/bin/env node
/**
 * Build one `book.json` out of a shelf directory full of separate readings.
 *
 * Every other book on this shelf is one document read from one scan, and the
 * app's own shape fits that exactly: a `SavedRun` names a source file and holds
 * its leaves. A **collected** volume does not fit it. Manly Hall's Manuscript
 * Lectures are 32 documents off 13 scans, and no single `key` names them.
 *
 *   node scripts/build-collection.mjs <book-dir> [--out book.json]
 *
 * So the readings are concatenated into one synthetic run, their leaves
 * renumbered into a single sequence, and the result written as a book file the
 * app can open. What that costs is stated below rather than discovered later.
 *
 * ## Why concatenating is safe, and how that was checked
 *
 * Assembly stitches a paragraph across a page seam, which is right within a
 * document and wrong between two. It is governed by `continuesNext` on the last
 * block of a leaf — and **no document here ends with that flag set**, checked
 * across all 32 before this was written. So the seam breaks at every document
 * boundary on its own, with nothing to add.
 *
 * The check is repeated at build time rather than trusted, because it is a
 * property of the data and the data changes.
 *
 * ## What the volume gives up, and it is not nothing
 *
 * **The scan pointer names one file, and there are thirteen.** So the book file
 * carries none, and the proof step's *check against the scan* view cannot work
 * on the collected volume: there is no one scan to check against. That is a
 * real loss and it is bearable for one reason — every reading was checked
 * against its own scan before it arrived here, leaf by leaf, and this is a
 * compilation of readings rather than a reading of a book.
 *
 * Anything that wants pixels wants the individual document, which is still on
 * the shelf with its own scan beside it.
 *
 * ## Where a chapter's title comes from
 *
 * From `contents.md`, which is where the editor set the edition's titles, and
 * from each reading's `metadata` only where that table has no row. Never from
 * the blocks.
 *
 * The difference is not cosmetic. The metadata carries the wrapper's own
 * wording, run together: `Teacher and Pupil Part I`, `MARRIAGE The Mystic
 * Rite`, `Are you a Teacher Are you a Student`. The table carries the edition's:
 * *Teacher and Pupil, Part I*, *Marriage: The Mystic Rite*, *Are You a Teacher?
 * Are You a Student?* Those are the editor's sentences and no amount of reading
 * the wrappers would recover them.
 *
 * The blocks cannot supply it either way: 27 of these leaves are the documents'
 * own printed wrappers, which the disposition machinery discards as sources of
 * metadata, so the block flow does not reliably name anything. And it is what
 * keeps the two Reincarnation lectures apart, since both head their leaf
 * `THE THEORY OF REINCARNATION` and only the table says which is Part One.
 *
 * The number goes in as a heading of its own, above the title, so a chapter
 * opens the way the series did: `MANUSCRIPT LECTURE No. 3` over `Teacher and
 * Pupil, Part I`.
 *
 * ## Levels, and why the whole volume turns on them
 *
 * A document's own headings — `The Gnomes`, `Versatility.`, `The Three Paths.`
 * — are **sub-headings of a lecture**, not chapters of the volume. Left at the
 * default the engine treats every one as a chapter opening: 212 of them here
 * against 32, each taking a chapter's ornament, a chapter's sinkage, its own
 * page break and a line in the contents.
 *
 * So every heading coming out of a reading is tagged **level 2** and the two
 * inserted ones **level 1**. That is not a convention invented here: the engine
 * already asks `(block.level ?? 1) === 1` to decide the heading's scale, the
 * gap after it, whether it takes the chapter ornament, whether it changes the
 * running head, and how the contents spaces it. One field, and all of that
 * follows.
 *
 * **Every** heading from a reading is demoted, including one already tagged
 * level 1. In a standalone reading that tag is right — `BUDDHA, THE DIVINE
 * WANDERER.` is that document's title. In the volume the document is a chapter
 * and its own title heading is the chapter's, so leaving it at level 1 gave 44
 * chapters where there are 32, and put the six chapter divisions of *Unseen
 * Forces* beside the lectures instead of inside the one that holds them.
 *
 * ## The title that would print twice
 *
 * Five documents open with their own title heading, so the volume would set the
 * edition's title and then the paper's immediately under it. Where the two are
 * the same words — compared on letters and digits alone, since `BUDDHA, THE
 * DIVINE WANDERER.` and *Buddha, the Divine Wanderer* differ only in case and a
 * full stop — the paper's is dropped as already carried.
 *
 * Where they are not the same words it is **kept**, as a sub-heading, and
 * reported. `FUNDAMENTAL ERRORS IN MODERN OCCULTISM.` is not the edition's
 * *Errors of Modern Occultism and Their Remedy*, and dropping a heading that
 * says something different would be losing text to tidy a page.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at < 0) return fallback
  const v = argv[at + 1]
  argv.splice(at, 2)
  return v
}
const out = opt('--out', null)
const [dir] = argv
if (!dir) {
  console.error('usage: node scripts/build-collection.mjs <book-dir> [--out book.json]')
  process.exit(2)
}
const bookDir = resolve(dir)
const outPath = out ? resolve(out) : join(bookDir, 'book.json')

/**
 * The order the volume prints in.
 *
 * Numerical, because that is the only order the documents themselves assert.
 * Three lectures carry no number and print where the editor believes they
 * belong (ruled 2026-09-05), marked as a belief; the Children of the Elements
 * prints whole between 8 and 29; the Scientific Series contents leaf describes
 * that bundle rather than belonging to the run, and closes the book.
 *
 * Keyed by reading file, because a title can be edited and a file name is what
 * the shelf actually holds.
 */
const PLACED = {
  'einstein-relativity.json': 2.5,
  'reincarnation-part-one.json': 4.5,
  'reincarnation-part-two.json': 7.5,
  'unseen-forces.json': 8.5,
  'scientific-series-contents-leaf.json': 1000
}

/**
 * The edition's titles, out of `contents.md`.
 *
 * Keyed on the number as the table writes it, question mark and all, since a
 * hypothesised number is how those three rows are addressed.
 */
function editionTitles(md) {
  const titles = new Map()
  for (const line of md.split('\n')) {
    const row = line.match(/^\|\s*(\d+\??)\s*\|\s*([^|]+?)\s*\|/)
    if (row) titles.set(row[1], row[2])
  }
  return titles
}
const TITLES = editionTitles(readFileSync(join(bookDir, 'contents.md'), 'utf8'))
/** Where the table addresses a document by something other than its number. */
const TITLE_KEY = {
  'einstein-relativity.json': '2?',
  'reincarnation-part-one.json': '4?',
  'reincarnation-part-two.json': '7?'
}
const STANDING = {
  'unseen-forces.json': 'The Children of the Elements',
  'scientific-series-contents-leaf.json': 'The Scientific Series: Hall\u2019s Own Contents Leaf'
}

const readingsDir = join(bookDir, 'readings')
const documents = []
for (const file of readdirSync(readingsDir).sort()) {
  if (!file.endsWith('.json')) continue
  const pages = JSON.parse(readFileSync(join(readingsDir, file), 'utf8'))
  if (!Array.isArray(pages) || pages.length === 0) continue
  const metadata = {}
  for (const page of pages) Object.assign(metadata, page.metadata ?? {})
  const number = Number(metadata.manuscriptNumber)
  const at = PLACED[file] ?? (Number.isFinite(number) ? number : null)
  if (at === null) {
    console.error(`  ?? ${file}: no number and no place — left out`)
    continue
  }
  documents.push({ file, pages, metadata, number, at })
}
documents.sort((a, b) => a.at - b.at)

// The property that makes concatenation safe, asserted rather than assumed.
for (const doc of documents) {
  const leaves = doc.pages.filter((p) => p.blocks.length).sort((a, b) => a.pageIndex - b.pageIndex)
  const last = leaves.at(-1)?.blocks.at(-1)
  if (last?.continuesNext) {
    console.error(
      `${doc.file} ends with continuesNext set: assembly would stitch its last ` +
        `paragraph onto the next document's first. Refusing to build.`
    )
    process.exit(1)
  }
}

const transcriptions = []
let next = 0
const contents = []
/** Documents whose own opening heading says something the edition's title does
 * not, and so prints under it as a sub-heading rather than being dropped. */
const kept = []
for (const doc of documents) {
  const key = TITLE_KEY[doc.file] ?? (Number.isFinite(doc.number) ? String(doc.number) : null)
  const title =
    STANDING[doc.file] ??
    (key !== null ? TITLES.get(key) : null) ??
    doc.metadata.title ??
    doc.file.replace(/\.json$/, '')
  const label = Number.isFinite(doc.number)
    ? `MANUSCRIPT LECTURE No. ${doc.number}`
    : (doc.metadata.seriesLabel ?? null)
  const opening = {
    pageIndex: next++,
    role: 'chapter-opening',
    blocks: [
      ...(label ? [{ kind: 'heading', text: label, level: 1 }] : []),
      { kind: 'heading', text: title, level: 1 }
    ],
    furniture: {},
    queries: []
  }
  transcriptions.push(opening)
  contents.push({ at: opening.pageIndex, number: doc.number ?? null, title, from: doc.file })

  const bare = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '')
  let carried = false
  for (const page of [...doc.pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const blocks = []
    for (const b of page.blocks) {
      if (b.kind !== 'heading') {
        blocks.push(b)
        continue
      }
      if (!carried && page.role === 'body' && bare(b.text) === bare(title)) {
        carried = true
        continue
      }
      blocks.push({ ...b, level: 2 })
    }
    transcriptions.push({ ...page, pageIndex: next++, blocks })
  }
  if (!carried) {
    const first = doc.pages
      .filter((p) => p.role === 'body')
      .sort((a, b) => a.pageIndex - b.pageIndex)[0]?.blocks[0]
    if (first?.kind === 'heading') kept.push(`${title}  <-  ${first.text}`)
  }
}

const words = transcriptions.reduce(
  (n, p) =>
    n + p.blocks.reduce((m, b) => m + (b.text ?? '').split(/\s+/).filter(Boolean).length, 0),
  0
)

const run = {
  schemaVersion: 15,
  key: 'collection:manly-hall-manuscript-lectures',
  fileName: 'Manly P. Hall — Collected Manuscript Lectures',
  savedAt: new Date().toISOString(),
  pageCount: transcriptions.length,
  scanPageCount: 0,
  transcriptions,
  failures: [],
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  modelId: 'read-by-hand',
  identityAnswers: {},
  edits: [],
  images: [],
  facts: []
}

const book = {
  format: 'public-domain-book-formatter/book',
  version: 2,
  savedAt: run.savedAt,
  runSchema: run.schemaVersion,
  run,
  answers: {},
  voice: null,
  notesCheckpoint: null,
  images: [],
  imagePaths: {},
  // Thirteen scans, and this field names one. See the note at the head.
  scan: null
}

writeFileSync(outPath, JSON.stringify(book, null, 1) + '\n')
console.log(
  `${documents.length} documents, ${transcriptions.length} leaves, ${words.toLocaleString()} words`
)
console.log(`-> ${outPath}`)
if (kept.length) {
  console.log(
    `\n${kept.length} document(s) keep their own opening heading under the chapter title:`
  )
  for (const k of kept) console.log(`   ${k}`)
}
for (const c of contents)
  console.log(
    `  ${String(Number.isFinite(c.number) ? c.number : '—').padStart(4)}` +
      `  leaf ${String(c.at).padStart(4)}  ${c.title}`
  )
