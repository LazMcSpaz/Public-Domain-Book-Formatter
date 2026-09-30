/**
 * One question: does "Approve all" at the query gate file what it approves?
 *
 * The button used to fill the held answers in and stop, leaving the filing to
 * the next press of Next. The editor approved 68 held queries on Isis Vol. II,
 * saw nothing change, left the book, and not one of them reached the shelf —
 * a button that says "approve" had been read, reasonably, as having approved.
 * So the approval is filed the moment it is made, exactly as a press of Next
 * files a ruling, and this asserts it against the shelf rather than against
 * the screen: the rulings have to arrive in a written book file, with no Next
 * pressed at all.
 *
 * And it asserts the other half, because a fix that filed everything on the
 * gate would pass the first: the one query no standing ruling holds must stay
 * unruled.
 *
 * Its own page and its own stub, for the reason `check-query-crop.mjs` gives.
 *
 *   node scripts/check-held.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
if (process.env.PDBF_TRACE) {
  page.on('console', (m) => console.log('  page:', m.text().slice(0, 160)))
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 200)))
}
const problems = []

await page.addInitScript(() => {
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
})

// A path-keyed store and a log of writes, as `check-outbox.mjs` keeps one.
const files = new Map()
const puts = []
let slug = null
await page.route('https://api.github.com/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  const json = (status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
    return json(200, { full_name: 'LazMcSpaz/Test-Shelf', default_branch: 'main', private: true })
  }
  if (!url.pathname.includes('/contents/')) return json(200, {})
  const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '')
  if (request.method() === 'GET') {
    if (path === 'books') return json(200, slug ? [{ name: slug, type: 'dir' }] : [])
    if (!files.has(path)) return json(404, { message: 'Not Found' })
    if ((request.headers()['accept'] ?? '').includes('raw')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: files.get(path) })
    }
    return json(200, { type: 'file', sha: 'stub-sha', path })
  }
  if (request.method() === 'PUT') {
    const body = JSON.parse(request.postData() ?? '{}')
    files.set(path, Buffer.from(body.content, 'base64').toString('utf8'))
    puts.push({ path, message: body.message })
    return json(200, { content: { sha: 'stub-sha' } })
  }
  return json(200, {})
})

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
const built = await page.evaluate(async (repo) => {
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  const sync = await import(`/@fs${repo}/src/core/sync/index.ts`)
  const key = project.fileKey({ name: 'held.pdf', size: 4343, lastModified: 9 })
  const block = (text) => ({ kind: 'paragraph', text })
  const run = project.createSavedRun({
    key,
    pageCount: 3,
    fileName: 'held.pdf',
    transcriptions: [
      {
        pageIndex: 0,
        role: 'body',
        blocks: [block('He wrote of the Sekten of the gods.')],
        uncertain: [],
        furniture: {},
        queries: [
          { kind: 'inconsistent', quote: 'the Sekten of the gods', why: 'Spelled two ways.' }
        ]
      },
      {
        pageIndex: 1,
        role: 'body',
        blocks: [block('A quotation “that never closes.')],
        uncertain: [],
        furniture: {},
        queries: [{ kind: 'inconsistent', quote: '“that never closes.', why: 'An unpaired mark.' }]
      },
      {
        pageIndex: 2,
        role: 'body',
        blocks: [block('A sentence that does not construe well.')],
        uncertain: [],
        furniture: {},
        queries: [
          { kind: 'unclear', quote: 'does not construe', why: 'No standing ruling reaches this.' }
        ]
      }
    ],
    failures: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    modelId: 'claude-opus-5',
    identityAnswers: {},
    complete: true,
    rulings: [
      {
        pageIndex: null,
        quote: 'Sekten → Sekhem',
        kind: 'inconsistent',
        decision: 'corrected',
        correction: 'Sekhem',
        covers: ['Sekten'],
        decidedOn: '2026-09-30'
      },
      {
        pageIndex: null,
        quote: 'Unpaired quotation marks',
        kind: 'inconsistent',
        decision: 'as-printed',
        covers: ['“that never closes.'],
        decidedOn: '2026-09-30'
      }
    ]
  })
  return {
    key,
    json: project.serializeBookFile({ run, answers: {}, voice: null }),
    slug: sync.shelfSlug(key),
    bookPath: sync.bookPath(key),
    aboutPath: sync.aboutPath(key)
  }
}, REPO)

files.set(built.bookPath, built.json)
files.set(
  built.aboutPath,
  JSON.stringify({
    key: built.key,
    fileName: 'held.pdf',
    savedAt: new Date().toISOString(),
    pageCount: 3,
    notes: 0,
    corrections: 0,
    marked: 0,
    facts: 0,
    complete: true,
    scanPath: null
  })
)
slug = built.slug

await page.goto(`${URL_BASE}/#book=${built.slug}&at=review`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const button = page.getByRole('button', { name: /Approve all/ })
const label = await button.innerText().catch(() => null)
if (!label) problems.push('no "Approve all" button on the gate')
else {
  await button.click()
  // Long enough for the device write, the queue and one flush. Nothing else
  // is pressed: no Next, no leaving the gate.
  await page.waitForTimeout(6000)
}

const written = files.get(built.bookPath)
const rulings = JSON.parse(written).run.rulings ?? []
const onLeaf = (leaf) => rulings.filter((r) => r.pageIndex === leaf)
const bookPuts = puts.filter((p) => p.path === built.bookPath)

if (bookPuts.length === 0)
  problems.push('the book file was never written — the approval stayed on the screen')
if (onLeaf(0).length !== 1 || onLeaf(0)[0]?.correction !== 'Sekhem') {
  problems.push(`leaf 0 was not filed as its standing ruling says (${JSON.stringify(onLeaf(0))})`)
}
if (onLeaf(1).length !== 1 || onLeaf(1)[0]?.decision !== 'as-printed') {
  problems.push(`leaf 1 was not filed as printed (${JSON.stringify(onLeaf(1))})`)
}
// And the card the shelf lists the book by. It carries the query counts the
// intake shows, and a flush that files rulings without it leaves the book
// listed as waiting on decisions that were made: Isis Vol. II said "96
// waiting" for two days after every one of them was ruled.
const card = JSON.parse(files.get(built.aboutPath) ?? '{}')
if (puts.filter((p) => p.path === built.aboutPath).length === 0) {
  problems.push('the shelf card was never rewritten, so the shelf still lists the old count')
} else if (card.queries?.waiting !== 1 || card.queries?.held !== 0) {
  problems.push(`the shelf card counts ${JSON.stringify(card.queries)}, not 1 waiting and 0 held`)
}
if (onLeaf(2).length !== 0) {
  problems.push('the query no standing ruling holds was filed — only what was approved may be')
}

console.log(`button    : ${label}`)
console.log(`book puts : ${bookPuts.map((p) => p.message).join(' | ') || 'none'}`)
console.log(`filed     : ${rulings.filter((r) => r.pageIndex !== null).length} leaf rulings`)
console.log(`card      : ${JSON.stringify(JSON.parse(files.get(built.aboutPath) ?? '{}').queries ?? null)}`)

await browser.close()
if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\n"Approve all" files what it approves, and nothing else.')
