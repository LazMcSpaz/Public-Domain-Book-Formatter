/**
 * When the shelf will not take a write: is the change named, kept, shown and
 * sent again?
 *
 * The owner's phone and tablet said "Could not reach the shelf (Load failed)"
 * for a ruling and "1 change on this device only" for a mark, and after a
 * refresh the mark was gone from the page. This plays that through on his
 * path (a book opened from the shelf to read, with no scan) against a faked
 * shelf whose book-file writes get no answer at all, which is what "Load
 * failed" means:
 *
 *  1. A ruling at the query gate: the note names the write, its size, the wait
 *     and the browser's words, says reading still works, and offers "Send to
 *     the shelf". With writes working again, that button files it.
 *  2. A mark in the reading view: counted as waiting, still drawn after a
 *     refresh and a fresh open from the shelf, and sent by the button.
 *
 * Its own page and its own stub, for the reason `check-query-crop.mjs` gives.
 * Nothing leaves this machine; the token is a made-up string.
 *
 *   node scripts/check-save-failure.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
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

// The faked shelf. While `failWrites` is set, a write of the book file gets no
// answer: the request is dropped, and `fetch` rejects as it does on the phone.
const files = new Map()
const puts = []
let slug = null
let failWrites = true
let refusedWrites = 0
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
    return json(200, { type: 'file', sha: `sha-${files.get(path).length}`, path })
  }
  if (request.method() === 'PUT') {
    if (failWrites && path.endsWith('/book.json')) {
      refusedWrites += 1
      return route.abort('failed')
    }
    const body = JSON.parse(request.postData() ?? '{}')
    files.set(path, Buffer.from(body.content, 'base64').toString('utf8'))
    puts.push({ path, message: body.message })
    return json(200, { content: { sha: 'new' } })
  }
  return json(200, {})
})

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
const built = await page.evaluate(async (repo) => {
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  const sync = await import(`/@fs${repo}/src/core/sync/index.ts`)
  const key = project.fileKey({ name: 'saves.pdf', size: 5151, lastModified: 3 })
  const block = (text) => ({ kind: 'paragraph', text })
  const leaf = (pageIndex, text, quote) => ({
    pageIndex,
    role: 'body',
    blocks: [block(text)],
    uncertain: [],
    furniture: {},
    queries: [{ kind: 'unclear', quote, why: 'A made-up question.' }]
  })
  const run = project.createSavedRun({
    key,
    pageCount: 2,
    fileName: 'saves.pdf',
    transcriptions: [
      leaf(0, 'The lamp was lit at dusk and burned till dawn.', 'lit at dusk'),
      leaf(1, 'A second leaf of made-up words for a second query.', 'second query')
    ],
    failures: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    modelId: 'none',
    identityAnswers: {},
    complete: true
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
    fileName: 'saves.pdf',
    savedAt: new Date().toISOString(),
    pageCount: 2,
    notes: 0,
    corrections: 0,
    marked: 0,
    facts: 0,
    complete: true,
    scanPath: null
  })
)
slug = built.slug
const onShelf = () => JSON.parse(files.get(built.bookPath))

// --- 1. a ruling the shelf would not take -----------------------------------
await page.goto(`${URL_BASE}/#book=${slug}&at=review`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
// Keep it as printed, and press Next: the press that files a ruling.
await page.locator('.opt', { hasText: 'Keep it as printed' }).first().click()
await page.locator('.pager button', { hasText: /next/i }).first().click()
await page.waitForTimeout(4000)
const gateNote = await page
  .locator('.gate-outbox')
  .innerText()
  .catch(() => '')
console.log(`gate note : ${gateNote.replace(/\s+/g, ' ')}`)
await page.screenshot({ path: 'screenshots/15-save-failure-gate.png', fullPage: true })
for (const [what, pattern] of [
  ['the ruling saved on the device', /1 ruling saved on this device/],
  ['which request failed', /Writing the book file \(\d+ (KB|bytes)\) got no answer/],
  ['how long the browser waited', /gave up after \d+\.\d seconds/],
  ['the browser’s own words', /said “Failed to fetch”/],
  ['that reading still works', /Reading from the shelf still works/],
  ['a way to try again', /Send to the shelf \(1 waiting\)/]
]) {
  if (!pattern.test(gateNote)) problems.push(`the gate's note does not say ${what}`)
}
if (refusedWrites === 0) problems.push('no write of the book file was attempted for the ruling')
if ((onShelf().run.rulings ?? []).length !== 0)
  problems.push('a ruling reached a shelf that refused it')

failWrites = false
await page.getByRole('button', { name: /Send to the shelf/ }).click()
await page.waitForTimeout(3000)
const filed = onShelf().run.rulings ?? []
if (filed.length !== 1 || filed[0].decision !== 'as-printed') {
  problems.push(`"Send to the shelf" did not file the ruling (${JSON.stringify(filed)})`)
}
const afterSend = await page
  .locator('.gate-outbox')
  .innerText()
  .catch(() => '')
if (/waiting\)/.test(afterSend)) problems.push('the gate still counts the ruling as waiting')

// --- 2. a mark the shelf would not take, and a refresh -----------------------
failWrites = true
await page.goto(`${URL_BASE}/#book=${slug}`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const readTab = page.getByRole('tab', { name: 'Read the book' })
if (await readTab.count()) await readTab.click()
await page.waitForTimeout(500)

/** Drag over words in a passage, as `check-outbox.mjs` does. */
async function mark(words, button) {
  await page.evaluate((words) => {
    const host = [...document.querySelectorAll('[data-passage]')].find((el) =>
      (el.textContent ?? '').includes(words)
    )
    const text = host.textContent ?? ''
    const from = text.indexOf(words)
    const point = (at) => {
      let seen = 0
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const length = node.nodeValue?.length ?? 0
        if (seen + length >= at) return { node, offset: at - seen }
        seen += length
        node = walker.nextNode()
      }
      return null
    }
    const range = document.createRange()
    const a = point(from)
    const b = point(from + words.length)
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, words)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: button }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Done' }).click()
}

await mark('burned till dawn', 'Needs a note')
await page.waitForTimeout(4000)
const held = await page
  .locator('.proof-outbox')
  .innerText()
  .catch(() => '')
const heldNote = await page
  .locator('.proof-outbox-note')
  .innerText()
  .catch(() => '')
console.log(`mark held : ${held.replace(/\s+/g, ' ')} | ${heldNote.replace(/\s+/g, ' ')}`)
if (!/1 change on this device only/.test(held)) problems.push('the mark was not counted as waiting')
if (!/Writing the book file .* got no answer/.test(heldNote)) {
  problems.push('the reading view does not say which request failed')
}

// The refresh the owner made, and the book opened again from the shelf.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
if (await readTab.count()) await readTab.click()
await page.waitForTimeout(800)
const drawn = await page.locator('.reading-mark').count()
const stillHeld = await page
  .locator('.proof-outbox')
  .innerText()
  .catch(() => '')
console.log(`after refresh: ${drawn} mark(s) drawn; ${stillHeld.replace(/\s+/g, ' ')}`)
await page.screenshot({ path: 'screenshots/15b-save-failure-mark-after-refresh.png' })
if (drawn !== 1)
  problems.push(`after a refresh the waiting mark is not on the page (${drawn} drawn)`)
if (!/1 change on this device only/.test(stillHeld)) {
  problems.push('after a refresh the mark is no longer counted as waiting')
}

failWrites = false
await page.getByRole('button', { name: 'Send to the shelf' }).click()
await page.waitForTimeout(3000)
const marks = (onShelf().run.edits ?? []).filter((e) => e.kind === 'highlight')
if (marks.length !== 1) problems.push(`"Send to the shelf" did not send the mark (${marks.length})`)
if ((await page.locator('.proof-outbox').count()) !== 0) {
  problems.push('the mark is still counted as waiting after it was sent')
}
// Sent once, not once per open: the reopen folded it in without queueing it again.
const markWrites = puts.filter(
  (p) => p.path === built.bookPath && /marked while reading/.test(p.message)
)
if (markWrites.length !== 1) problems.push(`${markWrites.length} writes for one mark`)

await browser.close()
if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log(
  '\nA write the shelf will not take is named, kept, shown after a refresh and sent again.'
)
