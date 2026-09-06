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
 * Many documents open with their own title heading, so the volume would set the
 * edition's title and the paper's immediately under it: *The Masters, Part I*
 * and then `THE MASTERS.` The paper's is dropped where it **says nothing the
 * edition's title does not** — compared on letters and digits alone, a leading
 * `The` ignored, so `THE ATTAINMENT OF WISDOM.` and *Attainment of Wisdom* are
 * one heading and `THE MASTERS.` is contained in *The Masters, Part I*.
 *
 * A heading that adds something is **kept**, set under the title as a
 * sub-heading, and reported. `THE FOURTH DIMENSION AND THE THIRD EYE.` names
 * the third eye where the edition's title does not; `A TALK TO THOSE WHO
 * ASPIRE TO BE TEACHERS.` is a different sentence altogether. Dropping either
 * would be losing text to tidy a page, and the rule is containment rather than
 * similarity for exactly that reason.
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

/**
 * What a leaf's role means once its document is a chapter of something larger.
 *
 * Each reading was made of a document standing on its own, so its roles are
 * that document's: manuscript 36 has a dedication leaf, a contents leaf and a
 * NOTE; manuscript 37 opens with an INTRODUCTION and divides itself with two
 * part titles. Read as a book those are front matter and are handled as front
 * matter — and inside a collected volume that is simply wrong, because there is
 * one book here and its front matter is the volume's.
 *
 * Left alone it does real damage, and did: `dedication` is `transcribe-aside`,
 * so manuscript 36's dedication to H. P. B. was hoisted out of its chapter and
 * set as twenty-odd pages of the VOLUME's front matter, one typed line to a
 * page, before the reader had reached lecture one. `table-of-contents` is
 * `discard`, which silently emptied two chapters.
 *
 * So every leaf of a document is body, except the wrappers. The wrappers keep
 * their roles because assembly is right about those: a printed cover is a
 * source of metadata and a blank leaf is a blank leaf, whichever book it is in.
 *
 * The discarded contents leaves are worth naming, because the rule that
 * discards a scanned contents is about *pagination* — the original's numbers
 * are not this edition's — and neither of these carries a page number. Hall's
 * Scientific Series leaf lists what the bundle contained; manuscript 36's lists
 * its own nine parts. Both are text he wrote, and one of them is a whole
 * chapter of this volume.
 */
const WRAPPER_ROLES = new Set([
  'title-page',
  'half-title',
  'copyright',
  'blank',
  'digitization-notice'
])
const roleInCollection = (role) => (WRAPPER_ROLES.has(role) ? role : 'body')

/**
 * The two hand-drawn diagrams, and where each goes.
 *
 * They are `supplied` pictures rather than scan crops, and `illustrations.md`
 * on the shelf says why: Hall's typist wrapped the body text round both, so no
 * rectangle isolates either and each had to be cut with masks the app's cutter
 * cannot take. A supplied picture has no source leaf, so an anchor is the only
 * thing that says where it belongs.
 *
 * `after` is the index, in the leaf's own block list, of the block the picture
 * follows — the paragraph that introduces it, which is where the reading put
 * the caption describing it. The caption block itself is consumed: it is a
 * description of the drawing, and with the drawing on the page it belongs under
 * it rather than in the flow as a short paragraph of prose. That is the same
 * thing assembly does with a caption on a leaf a scan picture was cut from.
 */
const PLATES = {
  'manuscript-43.json': [
    {
      leaf: 3,
      after: 0,
      caption: 1,
      id: 'd74b8b1ecbf24dd8e6628e1510dcb6fec25851362615120f841ec1483d772745',
      width: 1176,
      height: 925
    },
    {
      leaf: 3,
      after: 4,
      caption: 5,
      id: '529c87c974aacd9cc5c7623ea648322afeb7308eb9afc0147f51075e93e2f6bc',
      width: 885,
      height: 1450
    }
  ]
}

/** The image edits the plates become, filled in as the leaves are renumbered. */
const imageEdits = []

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

  const bare = (t) =>
    t
      .replace(/^\s*the\s+/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
  let carried = false
  for (const page of [...doc.pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    // The role this leaf has in the volume, not the one it had in its own
    // document — and the test below has to use it. Asking the reading's role
    // instead exempted every document whose first text leaf came back
    // `chapter-opening` (manuscript 24 and eight others) from both the drop and
    // the report of what was kept: they set their title twice and nothing said
    // so, which is the worse half.
    const role = roleInCollection(page.role)
    const plates = (PLATES[doc.file] ?? []).filter((p) => p.leaf === page.pageIndex)
    const captionsTaken = new Set(plates.map((p) => p.caption))
    const leafIndex = next
    const blocks = []
    for (const [i, b] of page.blocks.entries()) {
      // A caption a plate is taking travels on the picture instead.
      if (captionsTaken.has(i)) continue
      for (const plate of plates) {
        if (plate.after !== i) continue
        imageEdits.push({
          kind: 'image',
          imageId: plate.id,
          // `p{leaf}b{index}` is how assembly names a block, and the index is
          // the block's place in the leaf's own list *as handed to it* — so it
          // is counted here, after the captions have been taken out, not from
          // the reading's own numbering.
          afterBlockId: `p${leafIndex}b${blocks.length}`,
          sourceWidth: plate.width,
          sourceHeight: plate.height,
          caption: page.blocks[plate.caption]?.text ?? ''
        })
      }
      if (b.kind !== 'heading') {
        blocks.push(b)
        continue
      }
      // Dropped only when the paper's heading is contained in the edition's
      // title: it then says nothing that is not already being set above it.
      if (!carried && role === 'body' && bare(title).includes(bare(b.text))) {
        carried = true
        continue
      }
      blocks.push({ ...b, level: 2 })
    }
    transcriptions.push({ ...page, pageIndex: next++, role, blocks })
  }
  if (!carried) {
    const first = doc.pages
      .filter((p) => roleInCollection(p.role) === 'body')
      .sort((a, b) => a.pageIndex - b.pageIndex)[0]?.blocks[0]
    if (first?.kind === 'heading') kept.push(`${title}  <-  ${first.text}`)
  }
}

const words = transcriptions.reduce(
  (n, p) =>
    n + p.blocks.reduce((m, b) => m + (b.text ?? '').split(/\s+/).filter(Boolean).length, 0),
  0
)

// The edition and the look. Both live here rather than being answered at the
// gates, because a collected volume is never taken through the wizard: it is
// built from thirty-two readings that were each taken through their own.
//
// The design is the imprint's, matched to the last book set under it, so a
// reader who has one on the shelf recognises the other. What is deliberately
// NOT copied from that book is `dropCap`: these are lecture transcripts, and a
// three-line initial over a paragraph that opens `In our last talk we were
// considering...` sets a talk up as scripture.
const EDITION = {
  title: 'The Collected Manuscript Lectures',
  author: 'Manly Palmer Hall',
  originalYear: '1923–1925',
  imprint: 'Libri Vetus',
  imprintLine: 'Rare and esoteric books, set afresh for the present-day reader.',
  copyrightHolder: 'Libri Vetus',
  editionDate: '2026',
  editionStatement:
    'First collected edition. The lectures were issued singly, in typescript, and have not been gathered before.',
  isbn: '',
  publicDomainNotice: true,
  // Off until the notes are in. The line says the notes and the definitions are
  // the editor's, and today there are none — a claim on the copyright page that
  // the book does not keep. Turn it back on with them.
  annotatedNotice: false,
  sourceNotice:
    'Gathered from thirteen surviving sources — printed wrappers, born-digital scans and photographs of the original typescripts — and read leaf by leaf against them. Twenty-seven of the forty-six numbered manuscripts survive; the nineteen that do not are listed rather than passed over.'
}

const DESIGN = {
  kind: 'nonfiction',
  period: 'victorian',
  chapterOpener: 'ornamented',
  runningHeads: 'chapter',
  font: 'libre-caslon',
  dropCap: false,
  runningHeadVerso: 'author',
  chaptersOpenRecto: true,
  trimSize: '6x9',
  bodyFontSize: '12',
  ornamentChapter: 'chapter-rule',
  // Chapters only. The sub-headings are the typescripts' own display lines and
  // there are a hundred and fifty of them: real section titles, but also a
  // byline under a title, `(To be continued.)` at a foot, and the numbered
  // steps of a list. Listed, they made a four-leaf contents in which the
  // thirty-two lectures were hard to find.
  contentsDepth: '1',
  ornamentBlank: 'chapter-asterism',
  frontTitleBorder: true
}

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
  edits: imageEdits,
  images: [],
  facts: []
}

/** Each plate as the book file names it: an id and a path into the shelf's own
 * `images/`, never base64 inline. A picture rewritten inline on every save
 * grows the repository by all of it again each time. */
const PLATE_FILES = imageEdits.map((edit) => ({
  id: edit.imageId,
  path: `images/${edit.imageId}.png`
}))

const book = {
  format: 'public-domain-book-formatter/book',
  version: 2,
  savedAt: run.savedAt,
  runSchema: run.schemaVersion,
  run,
  answers: { export: EDITION, design: DESIGN },
  voice: null,
  notesCheckpoint: null,
  images: PLATE_FILES,
  // Thirteen scans, and this field names one. See the note at the head.
  scan: null
}

writeFileSync(outPath, JSON.stringify(book, null, 1) + '\n')

// The catalogue card, beside the book and written from it. A few hundred bytes
// so the intake screen can put a title and a page count on a button without
// downloading four megabytes of book — and written here rather than by hand
// because a card typed once is a card that is wrong by the third rebuild.
//
// `scanPath` is null on purpose and is the one field a collected volume cannot
// answer: there are thirteen scans and this names one. Anything that wants
// pixels wants the individual document, which is on the shelf with its own scan
// beside it.
writeFileSync(
  join(bookDir, 'about.json'),
  JSON.stringify(
    {
      key: run.key,
      fileName: EDITION.title,
      savedAt: run.savedAt,
      pageCount: transcriptions.length,
      notes: run.edits.filter((e) => e.kind === 'note').length,
      corrections: run.edits.filter((e) => e.kind === 'text').length,
      facts: run.facts.length,
      complete: true,
      scanPath: null
    },
    null,
    2
  ) + '\n'
)
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
