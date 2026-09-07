#!/usr/bin/env node
/**
 * Does a mark made offline reach the shelf when the connection comes back?
 *
 * The one question Stage 3 exists to answer, and the one the unit tests cannot:
 * `mergeOutbox` and `entriesBetween` are pure and exhaustively covered, but what
 * they are covering is a rule, not a wire. Whether the app actually queues on
 * change, holds while offline, and empties on `online` is a property of three
 * React effects and an IndexedDB store, and the only honest way to know is to
 * cut the network and look.
 *
 *   npm run dev &                       # the app has to be served
 *   node scripts/check-outbox.mjs
 *
 * The shelf is stubbed in the page with `page.route`, the way `screenshot-flow`
 * stubs the model API: an in-memory `book.json` that answers GET and records
 * every PUT. Nothing leaves this machine and no real token is involved — the
 * one written into `localStorage` here is the literal string `stub`.
 *
 * Exits non-zero with what went wrong.
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'

const REPO = resolve(import.meta.dirname, '..')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const REPO_NAME = 'editor/shelf'

const fail = (why) => {
  console.error(`\n✗ ${why}`)
  process.exitCode = 1
}

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const context = await browser.newContext()
const page = await context.newPage()

/**
 * The stub shelf: a path-keyed store, and a log of what was written.
 *
 * Keyed by path rather than holding "the last thing written", which the first
 * version did and which made the check read the *voice card* as the book —
 * a shelf holds the scan, the catalogue card, two editorial sheets and the
 * voice beside the book, and every one of them is a PUT.
 */
const shelf = { files: new Map(), puts: [] }
const BOOK = /\/contents\/books\/[^/]+\/book\.json$/

await context.route('https://api.github.com/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  const json = (status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
    return json(200, { full_name: REPO_NAME, default_branch: 'main', private: true })
  }
  if (!url.pathname.includes('/contents/')) return json(200, {})

  const path = url.pathname.split('/contents/')[1] ?? ''
  if (request.method() === 'GET') {
    if (!shelf.files.has(path)) return json(404, { message: 'Not Found' })
    // `getText` asks for the raw media type; `shaOf` asks for the envelope.
    if ((request.headers()['accept'] ?? '').includes('raw')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: shelf.files.get(path) })
    }
    return json(200, { sha: 'stub-sha' })
  }
  if (request.method() === 'PUT') {
    const body = JSON.parse(request.postData() ?? '{}')
    shelf.files.set(path, Buffer.from(body.content, 'base64').toString('utf8'))
    shelf.puts.push({ path, message: body.message })
    return json(200, { content: { sha: 'stub-sha' } })
  }
  return json(200, {})
})

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.evaluate((repo) => {
  localStorage.setItem('pdbf.shelf', JSON.stringify({ repo, branch: 'main', token: 'stub' }))
  localStorage.setItem('pdbf.keepBookData', 'yes')
}, REPO_NAME)
await page.reload({ waitUntil: 'networkidle' })

// A transcription, written straight into the store — the same free stand-in
// `drive.mjs seed` uses, because the paid gate is the one thing a controller is
// never allowed to press through and this check is about what happens after it.
const scan = resolve(REPO, 'public/test-book.pdf')
const meta = await stat(scan)
await page.evaluate(
  async ([repo, file, count]) => {
    const project = await import(`/@fs${repo}/src/core/project/index.ts`)
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const key = project.fileKey(file)
    await runStore.saveRun(
      project.createSavedRun({
        key,
        fileName: file.name,
        pageCount: count,
        transcriptions: Array.from({ length: count }, (_, i) => ({
          pageIndex: i,
          role: i === 0 ? 'title-page' : 'body',
          blocks: [{ kind: 'paragraph', text: `Page ${i + 1}.` }],
          uncertain: [],
          furniture: {}
        })),
        failures: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        modelId: 'none',
        identityAnswers: { orthography: 'preserve' }
      })
    )
    const blob = await (await fetch(`/${file.name}`)).blob()
    await runStore.saveSourceFile(key, new File([blob], file.name, { type: blob.type }))
  },
  [REPO, { name: 'test-book.pdf', size: meta.size, lastModified: Math.floor(meta.mtimeMs) }, 9]
)

// Through the wizard to the workbench, the way the driver does it.
await page.setInputFiles('input[type=file]', resolve(REPO, 'public/test-book.pdf'))
await page.waitForFunction(() => Boolean(window.__pdbfAgent), { timeout: 20000 })
for (let i = 0; i < 8; i += 1) {
  const step = await page.evaluate(
    async () => (await window.__pdbfAgent.run({ op: 'state' })).view?.step
  )
  if (step === 'proof') break
  await page.evaluate(async () => window.__pdbfAgent.run({ op: 'advance' }))
  await page.waitForTimeout(2500)
}
const step = await page.evaluate(
  async () => (await window.__pdbfAgent.run({ op: 'state' })).view?.step
)
if (step !== 'proof') {
  fail(`never reached the workbench (stopped at ${step})`)
  await browser.close()
  process.exit(1)
}

// The book itself has to be on the shelf before a reading can be flushed into
// it — the queue is edits, not a book, and says so when the book is missing.
await page.getByRole('tab', { name: 'Read the book' }).click()
await page.waitForTimeout(400)

/** Drag over words in a passage, as `drive.mjs select` does. */
async function mark(blockId, words, button) {
  await page.evaluate(
    ([blockId, words]) => {
      const host = document.querySelector(`[data-passage="${CSS.escape(blockId)}"]`)
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
    },
    [blockId, words]
  )
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: button }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Done' }).click()
}

const bookOnShelf = () => {
  for (const [path, text] of shelf.files) if (BOOK.test(`/contents/${path}`)) return text
  return null
}
const marksOnShelf = () => {
  const text = bookOnShelf()
  if (text === null) return 0
  return (JSON.parse(text).run?.edits ?? []).filter((e) => e.kind === 'highlight').length
}

// 1. Online. The book is not on the shelf yet, so the queue says so rather than
//    dropping anything — the count must appear and stay.
await mark('p2b0', 'Page 3', 'Needs a note')
await page.waitForTimeout(3000)
const waitingBeforeBook = await page
  .locator('.proof-outbox')
  .innerText()
  .catch(() => '')
if (!/1 change on this device only/.test(waitingBeforeBook)) {
  fail(`no queue shown for a book the shelf has not got: ${JSON.stringify(waitingBeforeBook)}`)
}

// 2. Put the book on the shelf, then let the queue drain into it.
await page.getByRole('button', { name: 'Save to the shelf' }).click()
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'Send to the shelf' }).click()
await page.waitForTimeout(2500)
if (marksOnShelf() !== 1) fail(`the first mark did not reach the shelf (${marksOnShelf()} there)`)

// 3. Offline. A second mark must be held, counted, and not sent.
const putsBefore = shelf.puts.length
await context.setOffline(true)
await mark('p3b0', 'Page 4', 'For the introduction')
await page.waitForTimeout(3000)
const heldText = await page
  .locator('.proof-outbox')
  .innerText()
  .catch(() => '')
if (!/on this device only/.test(heldText)) {
  fail(`a mark made offline was not reported as held: ${JSON.stringify(heldText)}`)
}
if (shelf.puts.length !== putsBefore) fail('something was written to the shelf while offline')
if (marksOnShelf() !== 1) fail('the offline mark reached the shelf anyway')

// 4. Back online. The `online` event is what empties the queue.
await context.setOffline(false)
await page.evaluate(() => window.dispatchEvent(new Event('online')))
await page.waitForTimeout(3500)
if (marksOnShelf() !== 2) {
  fail(`the offline mark did not go up when the connection came back (${marksOnShelf()} on shelf)`)
}
const settled = await page.locator('.proof-outbox').count()
if (settled !== 0) fail('the queue still reports changes waiting after a successful flush')

// One write per flush, and no more. Overlapping flushes both read a non-empty
// queue and both write the file: two identical writes are a commit that says
// nothing, and two different ones are a lost update, since each reads the blob
// sha before the other has written. This caught exactly that, three writes for
// two flushes, when the automatic flush and the button overlapped.
const flushWrites = shelf.puts.filter((p) => /marked while reading/.test(p.message))
if (flushWrites.length !== 2) {
  fail(`${flushWrites.length} writes of the book file for two flushes — they are overlapping`)
}

console.log(
  JSON.stringify(
    {
      marksOnShelf: marksOnShelf(),
      writes: shelf.puts.map((p) => `${p.path} — ${p.message}`),
      queueAfter: settled
    },
    null,
    2
  )
)
if (process.exitCode) console.error('\nThe outbox did not behave.')
else console.log('\nA mark made offline reaches the shelf when the connection returns.')

await browser.close()
