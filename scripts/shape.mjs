/**
 * What a book is made of, measured off its file and recorded in its book file.
 *
 *   node scripts/shape.mjs <book-dir>                 measure the scan the book names; print shape and route
 *   node scripts/shape.mjs <book-dir> --write         …and record it as `run.shape` in book.json
 *   node scripts/shape.mjs <file.pdf>                 measure any PDF
 *   node scripts/shape.mjs <book-dir> --from <file.pdf> [--write]
 *                                                     measure a file the book file does not name
 *   node scripts/shape.mjs <book-dir> --declare '<shape json>' --because '<reason>' [--write]
 *                                                     for a book nothing here can measure
 *   node scripts/shape.mjs --shelf <books-dir>        one row per book: shape, how, route
 *   node scripts/shape.mjs --flow                     regenerate the route table in docs/FLOW.md
 *
 * The measurement is the browser's own — `largestImageCoverage` over each
 * sampled page's operator list, and the file's producer — run here under
 * pdf.js's legacy build so a shelf of books can be classified without opening
 * a tab. The classification (`shapeOfPdf`) and the route (`routeFor`) are
 * core, so this script and the app cannot disagree about what a book is.
 *
 * `--write` rewrites book.json in the formatting it found (the app writes two
 * spaces and no trailing newline; one book on the shelf is one space and a
 * newline) and refuses when the file does not round-trip byte for byte before
 * the change — a book file is the shelf's source of truth, and a script that
 * reformats one on its way to setting a field has changed more than it said.
 */
import { register } from 'node:module'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'

register('./resolve-ts.mjs', import.meta.url)

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const after = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? null : (args[at + 1] ?? null)
}
const positional = args.filter(
  (a, i) =>
    !a.startsWith('--') && !['--declare', '--because', '--shelf', '--from'].includes(args[i - 1])
)

const { shapeOfPdf, declaredShape, parseShape, describeShape } =
  await import('../src/core/provenance/shape.ts')
const { routeKey, withRouteTable } = await import('../src/core/provenance/route.ts')
const { largestImageCoverage, SCANNED_COVERAGE } =
  await import('../src/core/provenance/coverage.ts')

if (flag('--flow')) {
  const p = resolve(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'FLOW.md')
  const before = readFileSync(p, 'utf8')
  const after = withRouteTable(before)
  writeFileSync(p, after)
  console.log(`${p}: ${before === after ? 'already in step' : 'regenerated'}`)
  process.exit(0)
}

/** Sample a PDF the way the browser does, under Node's build of pdf.js. */
async function measure(path, sample = 8) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const ops = {
    save: pdfjs.OPS.save,
    restore: pdfjs.OPS.restore,
    transform: pdfjs.OPS.transform,
    formBegin: pdfjs.OPS.paintFormXObjectBegin,
    formEnd: pdfjs.OPS.paintFormXObjectEnd,
    image: [
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintInlineImageXObject
    ]
  }
  const data = new Uint8Array(readFileSync(path))
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
  try {
    const total = doc.numPages
    const step = Math.max(1, Math.floor(total / Math.min(sample, total)))
    const samples = []
    for (let i = 0; i < total && samples.length < sample; i += step) {
      const page = await doc.getPage(i + 1)
      const vp = page.getViewport({ scale: 1 })
      const list = await page.getOperatorList()
      const coverage = largestImageCoverage(
        list.fnArray,
        list.argsArray,
        vp.width * vp.height,
        ops,
        (a, b) => pdfjs.Util.transform(a, b)
      )
      const content = await page.getTextContent()
      const text = content.items.reduce((n, it) => n + ('str' in it ? it.str.length : 0), 0)
      samples.push({ page: i, coverage, scanned: coverage >= SCANNED_COVERAGE, text })
      page.cleanup()
    }
    let producer = null
    let creator = null
    try {
      const info = (await doc.getMetadata()).info ?? {}
      producer = typeof info.Producer === 'string' ? info.Producer : null
      creator = typeof info.Creator === 'string' ? info.Creator : null
    } catch {
      /* the pages decide; the producer only corroborates */
    }
    return { pages: total, samples, producer, creator }
  } finally {
    await doc.destroy()
  }
}

/** The scan a book file names, found on the shelf the book sits on. */
function scanOf(bookDir, book) {
  const path = book?.scan?.path
  if (typeof path !== 'string') return null
  for (const root of [resolve(bookDir, '..', '..'), bookDir]) {
    const full = resolve(root, path)
    if (existsSync(full)) return full
  }
  return null
}

/** How this book file is written, so a rewrite changes one field and nothing else. */
function serialization(raw, parsed) {
  for (const indent of [2, 1]) {
    for (const newline of ['', '\n']) {
      if (JSON.stringify(parsed, null, indent) + newline === raw) return { indent, newline }
    }
  }
  return null
}

function record(bookDir, shape) {
  const p = join(bookDir, 'book.json')
  const raw = readFileSync(p, 'utf8')
  const book = JSON.parse(raw)
  const how = serialization(raw, book)
  if (!how) {
    throw new Error(
      `${p} does not round-trip through JSON.stringify as it stands, so writing it would ` +
        'reformat the whole file. Record the shape another way.'
    )
  }
  book.run.shape = shape
  writeFileSync(p, JSON.stringify(book, null, how.indent) + how.newline)
  return p
}

function report(name, shape) {
  console.log(`${name}`)
  console.log(`  ${describeShape(shape)}`)
  console.log(`  route: ${routeKey(shape)}`)
  for (const e of shape.evidence) console.log(`  · ${e}`)
}

if (flag('--shelf')) {
  const root = after('--shelf')
  if (!root) {
    console.error('usage: node scripts/shape.mjs --shelf <books-dir>')
    process.exit(2)
  }
  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const width = Math.max(...names.map((n) => n.length))
  let missing = 0
  for (const name of names) {
    const p = join(root, name, 'book.json')
    if (!existsSync(p)) {
      console.log(`${name.padEnd(width)}  (no book.json)`)
      continue
    }
    const shape = parseShape(JSON.parse(readFileSync(p, 'utf8')).run?.shape)
    if (!shape) {
      missing += 1
      console.log(`${name.padEnd(width)}  not recorded`)
      continue
    }
    console.log(
      `${name.padEnd(width)}  ${routeKey(shape).padEnd(16)} ${shape.how.padEnd(9)} ${describeShape(shape)}`
    )
  }
  if (missing > 0) {
    console.log(`\n${missing} book${missing === 1 ? '' : 's'} without a recorded shape`)
    process.exitCode = 1
  }
  process.exit()
}

const target = positional[0]
if (!target) {
  console.error(
    'usage: node scripts/shape.mjs <book-dir>|<file.pdf> [--write] [--declare <json> --because <reason>]'
  )
  console.error('       node scripts/shape.mjs --shelf <books-dir> | --flow')
  process.exit(2)
}

const isDir = existsSync(target) && statSync(target).isDirectory()
const declared = after('--declare')

let shape
if (declared) {
  const because = after('--because')
  if (!because) {
    console.error('--declare needs --because <reason>: a declaration with no reason is a guess.')
    process.exit(2)
  }
  const fields = JSON.parse(declared)
  shape = declaredShape(fields, because)
  if (!parseShape(shape)) {
    console.error(
      'That is not a shape: pixels, textLayer (none|converted|typeset), externalText, container (pdf|epub|collection).'
    )
    process.exit(2)
  }
} else if (isDir) {
  const book = JSON.parse(readFileSync(join(target, 'book.json'), 'utf8'))
  // `--from` names the file when the book file does not: a source too large
  // for the shelf, or one read before the pointer was written. Still a
  // measurement, and the evidence says which file it was taken from.
  const scan = after('--from') ? resolve(after('--from')) : scanOf(target, book)
  if (!scan) {
    console.error(
      `${basename(target)}: book.json names no scan on this shelf, so nothing here can measure it. ` +
        'Declare the shape: --declare <json> --because <reason>.'
    )
    process.exit(1)
  }
  shape = shapeOfPdf(await measure(scan))
  if (after('--from'))
    shape.evidence.push(`measured off ${basename(scan)}, which book.json does not name`)
} else {
  shape = shapeOfPdf(await measure(target))
}

report(isDir ? basename(target) : target, shape)

if (flag('--write')) {
  if (!isDir) {
    console.error('--write needs a book directory to write into.')
    process.exit(2)
  }
  const wrote = record(target, shape)
  console.log(`  recorded in ${wrote}`)
}
