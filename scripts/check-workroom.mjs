/**
 * The Workroom, in a real browser, against a made-up shelf of status notes
 * (`scripts/lib/workroom-fixture.mjs`; every book invented, nothing read from
 * a real shelf). It asks what the owner would:
 *
 * - do the three views hold the right jobs, longest waiting first, a stale
 *   run shown as stale, tools work under its role, a hand-off nobody took?
 * - does a job's detail show its timeline, and a linked file open readably?
 * - is a refresh one request when nothing changed, does a new note arrive
 *   when the page is shown again, fetched alone, and does a reopened app
 *   fetch nothing it already has?
 * - at phone width, do the columns stack?
 * - is a malformed note listed as unreadable, with its reason?
 * - does a questions link land on that book's question screen?
 * - does an empty shelf say so plainly?
 *
 * Its own page and stub, as the other browser checks have.
 *
 *   node scripts/check-workroom.mjs [--shots <folder>]   (needs the dev server on :5173)
 *
 * With `--shots`, saves workroom-tablet.png, workroom-phone.png and
 * workroom-detail.png there (deviceScaleFactor 2).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BAD_NOTE, BOOKS, lateNote, madeUpNotes, stubShelf } from './lib/workroom-fixture.mjs'

const REPO = resolve(import.meta.dirname, '..')
const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const at = process.argv.indexOf('--shots')
const SHOTS = at > -1 ? resolve(process.argv[at + 1] ?? '.') : null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const problems = []
function check(ok, what) {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) problems.push(what)
}

const browser = await chromium.launch({ executablePath: CHROME })
const context = await browser.newContext({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: SHOTS ? 2 : 1
})
const page = await context.newPage()
if (process.env.PDBF_TRACE) {
  page.on('console', (m) => console.log('  page:', m.text().slice(0, 160)))
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 200)))
}
await page.addInitScript(() => {
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'Someone/Made-Up-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
})

const shelf = { notes: madeUpNotes(), books: [], files: new Map() }
const seen = await stubShelf(page, shelf)
const lantern = (name) => `books/${BOOKS.lantern}/${name}`
shelf.files.set(
  lantern('readiness.md'),
  '# Readiness report\n\nMade up for the check.\n\n| Check | Result |\n|---|---|\n| C1 | passed |\n| R4 | NOT CHECKED |\n'
)
shelf.files.set(`books/${BOOKS.doors}/about.json`, JSON.stringify({ pages: 148, complete: true }))

await page.goto(`${URL_BASE}/#workroom`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
const texts = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent ?? ''))
const runsIn = (sel) => page.$$eval(sel, (els) => els.map((e) => e.getAttribute('data-run')))

// --- the three views and the counts ---
check(
  seen.blobs === shelf.notes.size,
  `each note fetched once on open (${seen.blobs} of ${shelf.notes.size})`
)
const waiting = await runsIn('[data-view="waiting"] .wr-ask')
check(
  JSON.stringify(waiting) === JSON.stringify(['scout001', 'checkr01', 'managr01']),
  `waiting on you, longest first, the forty-day-old one included (${waiting.join(', ')})`
)
const stats = await texts('.wr-stat b')
check(
  stats.join(' ') === '3 4 5 4',
  `counts: 3 waiting, 4 at work, 5 books, 4 done this week (${stats.join(' ')})`
)
check((await texts('.wr-stat'))[1].includes('1 stale'), 'the counts say one run is stale')
const books = await page.$$eval('[data-view="books"] [data-book]', (els) =>
  els.map((e) => e.getAttribute('data-book'))
)
check(books.length === 5 && books.includes(BOOKS.lantern), `five books listed (${books.length})`)
const strip = await page.$$eval(`[data-book="${BOOKS.lantern}"] .wr-steps i`, (els) =>
  els.map((e) => e.className)
)
check(
  strip.join(' ') ===
    'wr-step-past wr-step-past wr-step-now wr-step-ahead wr-step-later wr-step-later wr-step-later wr-step-later',
  `the lantern's strip stands at checking, with writing begun (${strip.join(' ')})`
)
check(
  (await texts(`[data-book="${BOOKS.lantern}"] .wr-m`))[0].includes('checking'),
  "the lantern's stage reads checking"
)
const lanes = await page.$$eval('[data-view="roles"] [data-role]', (els) =>
  els.map((e) => e.getAttribute('data-role'))
)
check(
  lanes.length === 9 && lanes[0] === 'managing-editor' && lanes[8] === 'reviewer',
  `nine role columns in order (${lanes.join(', ')})`
)
const stale = page.locator('[data-role="reader"] [data-run="stale001"]')
const staleText = (await stale.textContent()) ?? ''
check(
  (await stale.getAttribute('class')).includes('wr-card-stale') &&
    /stale/u.test(staleText) &&
    !/\bworking\b/u.test(staleText),
  'the quiet reader run shows as stale, never as working'
)
check(
  (
    (await page.locator('[data-role="builder"] [data-run="build001"]').textContent()) ?? ''
  ).includes('Tools and shelf work'),
  'tools work with no book sits under the builder'
)
check(
  (
    (await page.locator('[data-role="reviewer"] [data-run="build000"]').textContent()) ?? ''
  ).includes('waiting to be picked up'),
  'the hand-off to the reviewer is listed as not yet picked up'
)
const unreadable = (await texts('[data-view="unreadable"]'))[0] ?? ''
check(
  unreadable.includes(BAD_NOTE) && /not JSON/u.test(unreadable),
  'the malformed note is listed as unreadable, with its reason'
)

if (SHOTS) await page.screenshot({ path: join(SHOTS, 'workroom-tablet.png'), fullPage: true })

// --- a job's detail, and a file opened from it ---
await page.click('[data-role="checker"] [data-run="checkr01"]')
await page.waitForSelector('[data-detail="checkr01"]')
const events = await texts('[data-detail="checkr01"] .wr-event')
check(
  events.length === 3 &&
    events[1].includes('Text checks run') &&
    events[2].includes('Rule the four questions'),
  `the detail shows the run's timeline (${events.length} events)`
)
if (SHOTS) await page.screenshot({ path: join(SHOTS, 'workroom-detail.png') })
await page.click('[data-detail="checkr01"] .wr-link:has-text("Readiness report")')
await page.waitForSelector(`[data-file="${lantern('readiness.md')}"] .wr-md table`, {
  timeout: 10000
})
const sheet = (await texts(`[data-file="${lantern('readiness.md')}"] .wr-md`))[0] ?? ''
check(
  sheet.includes('NOT CHECKED') && !sheet.includes('|') && !sheet.includes('#'),
  'the readiness report opens as a readable sheet, not raw Markdown'
)
await page.click(`[data-file="${lantern('readiness.md')}"] .wr-close`)
await page.click('[data-detail="checkr01"] .wr-close')

// --- live, and read efficiently ---
const before = { ...seen }
await page.click('.wr-refresh')
await page.waitForFunction(() => !document.querySelector('.wr-refresh')?.hasAttribute('disabled'))
await page.waitForTimeout(300)
check(
  seen.trees === before.trees + 1 && seen.blobs === before.blobs,
  'a refresh with nothing changed is one request'
)
const [latePath, lateText] = lateNote()
shelf.notes.set(latePath, lateText)
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForSelector('[data-run="late0001"]', { timeout: 10000 })
check(
  seen.blobs === before.blobs + 1,
  `a new note arrives when the page is shown again, fetched alone (${seen.blobs - before.blobs})`
)
const reopened = seen.blobs
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('[data-run="late0001"]', { timeout: 10000 })
check(
  seen.blobs === reopened,
  `a reopened app fetches no note it already has (${seen.blobs - reopened})`
)

// --- the phone ---
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
const side = await page.locator('.wr-side').boundingBox()
const board = await page.locator('.wr-board').boundingBox()
const lefts = await page.$$eval('[data-view="roles"] [data-role]', (els) =>
  els.map((e) => Math.round(e.getBoundingClientRect().left))
)
check(
  side && board && board.y >= side.y + side.height - 1,
  'at phone width the books sit above the roles'
)
check(
  new Set(lefts).size === 1,
  `at phone width the role columns stack (${[...new Set(lefts)].join(', ')})`
)
const wide = await page.evaluate(() => document.documentElement.scrollWidth)
check(wide <= 390, `no sideways scrolling at phone width (${wide}px)`)
if (SHOTS) await page.screenshot({ path: join(SHOTS, 'workroom-phone.png'), fullPage: true })
await page.setViewportSize({ width: 1180, height: 820 })

// --- a questions link lands on that book's question screen ---
const built = await page.evaluate(async (repo) => {
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  const key = project.fileKey({ name: 'lantern.pdf', size: 2026, lastModified: 7 })
  const run = project.createSavedRun({
    key,
    pageCount: 1,
    fileName: 'lantern.pdf',
    transcriptions: [
      {
        pageIndex: 0,
        role: 'body',
        blocks: [
          { kind: 'paragraph', text: 'The lamp was lit against a dust that never settled.' }
        ],
        uncertain: [],
        furniture: {},
        queries: [
          { kind: 'unclear', quote: 'a dust that never settled', why: 'Made up for the check.' }
        ]
      }
    ],
    failures: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    modelId: 'claude-opus-5',
    identityAnswers: {},
    complete: true,
    rulings: []
  })
  return { key, json: project.serializeBookFile({ run, answers: {}, voice: null }) }
}, REPO)
shelf.books = [BOOKS.lantern]
shelf.files.set(lantern('book.json'), built.json)
shelf.files.set(
  lantern('about.json'),
  JSON.stringify({
    key: built.key,
    fileName: 'lantern.pdf',
    savedAt: new Date().toISOString(),
    pageCount: 1,
    notes: 0,
    corrections: 0,
    marked: 0,
    facts: 0,
    complete: true,
    scanPath: null
  })
)
await page.click('[data-view="waiting"] [data-run="checkr01"] .wr-link:has-text("Questions sheet")')
const landed = await page
  .waitForFunction(
    () => document.querySelector('.step-head h2')?.textContent === 'Decisions waiting on you',
    null,
    { timeout: 20000 }
  )
  .then(() => true)
  .catch(() => false)
const hash = await page.evaluate(() => window.location.hash)
check(
  landed && hash.startsWith(`#book=${BOOKS.lantern}&at=queries`),
  `the questions link opens the lantern's question screen (${hash})`
)

// --- an empty shelf ---
shelf.notes = new Map()
await page.evaluate(() => (window.location.hash = '#workroom'))
const empty = await page
  .waitForSelector('[data-empty="true"]', { timeout: 10000 })
  .catch(() => null)
check(
  ((await empty?.textContent()) ?? '').trim() ===
    'No agent has reported yet. Notes appear here as the team works.',
  'an empty shelf says so plainly'
)

await browser.close()
if (problems.length > 0) {
  console.error(`\nFAILED (${problems.length}):`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nThe Workroom shows the right work, live, on the tablet and the phone.')
