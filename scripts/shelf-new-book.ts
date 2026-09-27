/**
 * Put a book on the shelf that nobody has read yet: its scan under its own
 * digest, a `book.json` holding its first leaf and nothing more, and the
 * catalogue card the intake screen lists — so it shows on the shelf and opens
 * the way every other shelf book opens, by fetching the file and then the scan.
 *
 *   npx vite-node --config vitest.config.ts scripts/shelf-new-book.ts \
 *     <shelf> <scan.pdf|scan.epub> <Author-TitleCamel> <leaves> \
 *     <voice-from/book.json> <leaf0.json>
 *
 * `<leaf0.json>` is one `PageTranscription` for leaf 0, read against the
 * render. A run with no leaves is not a run: `migrateSavedRun` throws on it.
 *
 * `<leaves>` is the page count for a PDF and the spine length for an EPUB; it
 * is measured by the caller, because the engines that measure it are not core.
 * The directory is `<Author-TitleCamel>-<tag>`, the tag being the one
 * `shelfSlug` computes from the key, so a readable name still carries the
 * key's fingerprint as the renamed directories on this shelf do.
 *
 * The book file is built with the same core functions a save uses and the card
 * from the same summary the app's card uses, so neither can describe a book
 * that would not load. Refuses to overwrite a directory that already holds a
 * `book.json`: this is for a book the shelf has never held.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createSavedRun, parseBookFile, serializeBookFile, summarizeBookFile } from '@core/project'
import { defaultVoice } from '@core/annotate/voice'
import { scanPath, shelfSlug } from '@core/sync/shelf'

const args = process.argv.slice(2).filter((a) => !a.endsWith('shelf-new-book.ts'))
const [shelf, source, name, leavesArg, voiceFrom, firstLeaf] = args
const leaves = Number(leavesArg)
if (!shelf || !source || !name || !(leaves > 0)) {
  throw new Error(
    'shelf-new-book.ts <shelf> <scan> <Author-TitleCamel> <leaves> <voice-from> <leaf0.json>'
  )
}

const bytes = readFileSync(source)
const digest = createHash('sha256').update(bytes).digest('hex')
const ext = /\.epub$/i.test(source) ? 'epub' : 'pdf'
const fileName = `${digest}.${ext}`
const scan = scanPath(digest, fileName)
const key = `${fileName}\u0000${statSync(source).size}\u0000${Date.now()}`
const tag = shelfSlug(key).split('-').pop()
const dir = resolve(shelf, 'books', `${name}-${tag}`)
if (existsSync(resolve(dir, 'book.json'))) throw new Error(`${dir} already holds a book.json`)

const scanOut = resolve(shelf, scan)
if (!existsSync(scanOut)) copyFileSync(source, scanOut)

const voice = voiceFrom ? parseBookFile(readFileSync(voiceFrom, 'utf8')).voice : defaultVoice()
const run = createSavedRun({
  key,
  fileName,
  pageCount: leaves,
  leafCount: leaves,
  // A saved run must hold at least one leaf (`migrateSavedRun` refuses an
  // empty one), so the book goes up with its first leaf read — looked at
  // against the render and set down as printed — and the rest left unread.
  transcriptions: firstLeaf ? [JSON.parse(readFileSync(firstLeaf, 'utf8'))] : [],
  failures: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  modelId: '',
  identityAnswers: {},
  complete: false
})
const json = serializeBookFile({
  run,
  answers: {},
  voice,
  scan: { path: scan, fileName, bytes: bytes.length, key }
})
const summary = summarizeBookFile(parseBookFile(json))
const card = {
  key,
  fileName: summary.fileName,
  savedAt: new Date().toISOString(),
  pageCount: summary.pageCount,
  notes: summary.notes,
  corrections: summary.corrections,
  marked: summary.marked,
  facts: summary.facts,
  complete: summary.complete,
  read: summary.read,
  queries: summary.queries,
  scanPath: scan
}
mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'book.json'), json.endsWith('\n') ? json : `${json}\n`)
writeFileSync(resolve(dir, 'about.json'), `${JSON.stringify(card, null, 1)}\n`)
console.log(`${basename(dir)}  ${leaves} leaves  ${scan}  from ${basename(source)}`)
