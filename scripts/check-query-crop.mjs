/**
 * One question: does the query gate draw its pixels for a book with no scan?
 *
 * The gate promises the scan beside every decision and keeps it by rendering
 * the leaf — which works until the scan is too large for the shelf to hold.
 * Vol. I of *Isis Unveiled* is 357 MB, past this shelf's refusal and past
 * GitHub's per-file limit both, so it can go up in no form at all. For such a
 * book the crops are cut in advance (`drive.mjs querycrops`) and the gate
 * fetches them one at a time.
 *
 * What has to be true is not that a path is computed. It is that an **image is
 * drawn**: the failure this replaces was a gate that showed nothing and said
 * nothing, and a `shelf:` ref reaching the DOM unresolved would look the same
 * from the outside as a crop that is simply not there.
 *
 * Its own page and its own stub, rather than a section of `screenshot-flow`.
 * That was tried first and the accumulated state of the run is what it kept
 * measuring: a shelf holding several books, a device deliberately wiped, a
 * book whose queries an earlier section had already ruled on. Three separate
 * green-looking failures came out of that, each a true statement about a book
 * this check was not looking at.
 *
 *   node scripts/check-query-crop.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

// `/@fs<absolute path>`, never `/src/...`: the dev server answers the latter
// with `index.html`, so an import of it resolves to a document and the check
// would fail on a message about the module rather than about the gate.
const REPO = resolve(import.meta.dirname, '..')

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// One black pixel. This is about the fetch and the render, not the picture.
const ONE_PIXEL_JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
if (process.env.PDBF_TRACE) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log('  page:', m.text().slice(0, 160))
  })
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 200)))
}
const problems = []

// The shelf, configured before the app's first line runs.
await page.addInitScript(() => {
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
})

// The stub goes on before anything navigates. Installed after the first load,
// the app had already tried to list the shelf and failed against the sandbox's
// own certificate authority — two `ERR_CERT_AUTHORITY_INVALID` lines and a
// shelf that read as empty, which looks exactly like a shelf that is empty.
const files = new Map()
let cropRequested = false
// Filled once the book is built. Until then the listing is honestly empty:
// the first load happens before there is a book, and the app is entitled to
// see a shelf with nothing on it rather than a name that resolves to nothing.
let slug = null
let cropPath = null
await page.route('https://api.github.com/**', async (route) => {
  const url = route.request().url()
  if (process.env.PDBF_TRACE) console.log('  stub:', route.request().method(), url)
  if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ full_name: 'LazMcSpaz/Test-Shelf', default_branch: 'main' })
    })
  }
  const path = decodeURIComponent(/\/contents\/([^?]+)/.exec(url)?.[1] ?? '')
  if (path === 'books') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(slug ? [{ name: slug, type: 'dir' }] : [])
    })
  }
  const held = files.get(path)
  if (held === undefined) return route.fulfill({ status: 404, body: '{}' })
  if (path === cropPath) cropRequested = true
  // `getBytes` asks for the raw media type and `getText` for JSON; the stub
  // answers both with the bytes, which is what the real endpoint does.
  return route.fulfill({
    status: 200,
    contentType: 'application/vnd.github.raw',
    body: Buffer.from(held, 'base64')
  })
})

// A book file with one query on it, built by the app's own serializer so this
// cannot pass against a shape the app would refuse.
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
const built = await page.evaluate(async (repo) => {
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  const sync = await import(`/@fs${repo}/src/core/sync/index.ts`)
  const queries = await import(`/@fs${repo}/src/core/queries/index.ts`)

  const key = project.fileKey({ name: 'no-scan.pdf', size: 4242, lastModified: 7 })
  const quote = 'the spirits of heaven that descend'
  const run = project.createSavedRun({
    key,
    pageCount: 2,
    fileName: 'no-scan.pdf',
    transcriptions: [
      {
        pageIndex: 0,
        role: 'body',
        blocks: [{ kind: 'paragraph', text: `It is not ${quote} upon earth.` }],
        uncertain: [],
        furniture: { folio: '170' },
        queries: [
          {
            kind: 'printers-error',
            quote,
            // Long on purpose: a standing ruling explained once and pointed at
            // from every place it covers. It has to sit *below* the passage,
            // or on a phone the passage is past the fold and the editor is
            // reading an argument about somewhere else.
            why:
              'One decision applied thirty-one times, not thirty-one decisions. '.repeat(8) +
              'Raised so the gate has a decision to hang a crop beside.'
          }
        ]
      }
    ],
    failures: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    modelId: 'claude-opus-5',
    identityAnswers: {},
    complete: true
  })
  const json = project.serializeBookFile({ run, answers: {}, voice: null })
  const raised = queries.collectQueries(run.transcriptions)
  const queryKey = queries.queryKey(raised[0])
  return {
    key,
    json,
    slug: sync.shelfSlug(key),
    bookPath: sync.bookPath(key),
    aboutPath: sync.aboutPath(key),
    cropPath: sync.queryCropPath(key, queryKey)
  }
}, REPO)

const card = {
  key: built.key,
  fileName: 'no-scan.pdf',
  savedAt: new Date().toISOString(),
  pageCount: 2,
  notes: 0,
  corrections: 0,
  marked: 0,
  facts: 0,
  complete: true,
  // The whole point: no scan anywhere, so the shelf is the only source of
  // pixels the gate can have.
  scanPath: null
}

const b64 = (text) => Buffer.from(text).toString('base64')
files.set(built.bookPath, b64(built.json))
files.set(built.aboutPath, b64(JSON.stringify(card)))
files.set(built.cropPath, ONE_PIXEL_JPEG)
slug = built.slug
cropPath = built.cropPath

// Opened the way a link opens it: the book file and nothing else, landing on
// the gate.
// `goto` to a URL that differs only in its hash does not reload the document,
// so the mount effects the link is read by never run again. The reload is what
// makes this the same thing as following the link from cold.
await page.goto(`${URL_BASE}/#book=${built.slug}&at=review`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(6000)

const where = await page
  .locator('.rail li.active .label')
  .innerText()
  .catch(() => '(none)')
const src = await page
  .locator('.q-evidence img')
  .first()
  .getAttribute('src')
  .catch(() => null)

await page.screenshot({ path: 'screenshots/13-query-crop-from-shelf.png', fullPage: true })
// And the phone, which is where the fold matters.
await page.setViewportSize({ width: 430, height: 930 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'screenshots/13b-query-gate-phone.png', fullPage: true })
await page.setViewportSize({ width: 1100, height: 1400 })

if (!/Decisions waiting/i.test(where)) {
  problems.push(`the link did not land on the query gate — it is at "${where}"`)
}
if (!cropRequested) problems.push('the crop was never asked for')
if (!String(src).startsWith('blob:')) {
  problems.push(`no crop was drawn (the img src is ${src})`)
}

console.log(`landed at : ${where}`)
console.log(`crop asked: ${cropRequested}`)
console.log(`img src   : ${String(src).slice(0, 24)}${String(src).length > 24 ? '…' : ''}`)
console.log('→ screenshots/13-query-crop-from-shelf.png')

await browser.close()

if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nthe gate finds its pixels on the shelf.')
