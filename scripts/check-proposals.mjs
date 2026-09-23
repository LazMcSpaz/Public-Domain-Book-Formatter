/**
 * One question: does the query gate offer the reader's answers without
 * answering for the editor?
 *
 * The editor asked for proposals at the gate — a handful of complete answers
 * to pick among, because the reader has a view most of the time and taking it
 * should cost a tap. The rule the rest of `@core/queries` is built on is that
 * a suggestion beside a question is an answer in all but name, and the whole
 * defence of a menu is two properties that are invisible in a unit test of the
 * question shape and obvious on a screen:
 *
 * - **nothing is selected**, so a press of Next files nothing; and
 * - **the three plain decisions are still there**, so a screen whose proposals
 *   are all wrong has an honest way forward.
 *
 * Both are asserted against the DOM the editor actually meets, at the width
 * they meet it: a radio the app leaves unchecked and a browser checks anyway
 * would pass every test in `test/query-proposals.test.ts` and file a ruling
 * nobody made.
 *
 * Its own page and its own stub, for the reason `check-query-crop.mjs` gives:
 * a section of `screenshot-flow` measures the accumulated state of the run.
 *
 *   node scripts/check-proposals.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

// `/@fs<absolute path>`, never `/src/...`: the dev server answers the latter
// with `index.html`, so an import of it resolves to a document and the check
// would fail on a message about the module rather than about the gate.
const REPO = resolve(import.meta.dirname, '..')

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

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
// Filled once the book is built. Until then the listing is honestly empty:
// the first load happens before there is a book, and the app is entitled to
// see a shelf with nothing on it rather than a name that resolves to nothing.
let slug = null
// Whether anything asked for the scan. The query gate must not: a link to it
// takes the light route, and fetching the scan is minutes of download and
// Tesseract for a recovery half this book finished long ago.
let scanAsked = false
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
  if (path === SCAN_PATH) scanAsked = true
  const held = files.get(path)
  if (held === undefined) return route.fulfill({ status: 404, body: '{}' })
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
    complete: true,
    // Two, because one option beside a question is the thing the rule
    // forbids; the menu is the defence and a menu of one is not one.
    proposals: [
      {
        pageIndex: 0,
        quote,
        decision: 'corrected',
        correction: 'the spirits of heaven that descend',
        because: 'The same phrase is set with the article on leaf 44 and on leaf 212.',
        by: 'the reading session'
      },
      {
        pageIndex: 0,
        quote,
        decision: 'noted',
        because: 'The 1877 compositor sets it both ways; a note is cheaper than a choice.',
        by: 'the reading session'
      }
    ]
  })
  const json = project.serializeBookFile({ run, answers: {}, voice: null })
  return {
    key,
    json,
    slug: sync.shelfSlug(key),
    bookPath: sync.bookPath(key),
    aboutPath: sync.aboutPath(key)
  }
}, REPO)

const SCAN_PATH = 'scans/deadbeef.pdf'

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
  // Set, and that is the point: a book whose scan the shelf *does* hold still
  // opens the light way when the link names the query gate. With this null the
  // check passes against the fault, because the light route was already the
  // only route for a book with no scan.
  scanPath: SCAN_PATH
}

const b64 = (text) => Buffer.from(text).toString('base64')
files.set(built.bookPath, b64(built.json))
files.set(built.aboutPath, b64(JSON.stringify(card)))
slug = built.slug

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

// Every radio in the decision group, as the DOM has it. Read off the input
// rather than off a class name: what decides whether a press of Next files a
// ruling is `checked`, and a stylesheet cannot lie about that.
const radios = await page.$$eval('input[type="radio"]', (els) =>
  els.map((el) => ({
    name: el.name,
    value: el.value,
    checked: el.checked,
    label:
      (el.closest('label') ?? el.parentElement)?.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
  }))
)
// The decision group only. The gate puts three questions on a screen and the
// other two are text boxes, but a later choice question would otherwise be
// counted here and the "nothing is selected" assertion would be about it.
const decisionRadios = radios.filter((r) => /-decision$/u.test(r.name))

await page.screenshot({ path: 'screenshots/14-query-proposals.png', fullPage: true })
// And the phone, which is where a long corrected reading on an option label
// either wraps or pushes the page sideways.
await page.setViewportSize({ width: 430, height: 930 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'screenshots/14b-query-proposals-phone.png', fullPage: true })
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
await page.setViewportSize({ width: 1100, height: 1400 })

const values = decisionRadios.map((r) => r.value)
const offered = values.filter((v) => /^proposed-\d+$/u.test(v))
const plain = ['as-printed', 'corrected', 'noted'].filter((v) => values.includes(v))
const checked = decisionRadios.filter((r) => r.checked)

if (!/Decisions waiting/i.test(where)) {
  problems.push(`the link did not land on the query gate — it is at "${where}"`)
}
if (offered.length !== 2) {
  problems.push(`${offered.length} proposals are offered, not 2 (${values.join(', ')})`)
}
if (plain.length !== 3) {
  problems.push(
    `the three plain decisions are not all offered — only ${plain.join(', ') || 'none'}`
  )
}
// The one that matters. A proposal arriving selected is the forbidden thing
// wearing a menu's clothes, and it files on the next press of Next.
if (scanAsked) {
  problems.push('the scan was fetched — a link to the query gate must take the light route')
}
if (checked.length > 0) {
  problems.push(
    `${checked.length} option(s) arrived selected: ${checked.map((c) => c.value).join(', ')}`
  )
}
if (!decisionRadios.some((r) => /the spirits of heaven/u.test(r.label))) {
  problems.push('no option says what it would make the page read')
}
if (overflow > 1) {
  problems.push(`the page scrolls sideways by ${overflow}px at 430px wide`)
}

console.log(`landed at : ${where}`)
console.log(`offered   : ${values.join(', ')}`)
console.log(`scan asked: ${scanAsked}`)
console.log(`selected  : ${checked.length}`)
console.log(`overflow  : ${overflow}px at 430px`)
console.log('→ screenshots/14-query-proposals.png')

await browser.close()

if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nthe gate offers the reader\u2019s answers and chooses none of them.')
