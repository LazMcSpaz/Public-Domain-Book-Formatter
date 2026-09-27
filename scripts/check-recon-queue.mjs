/**
 * Does one click read every unread scan on the shelf and put each reading
 * beside its book — and does a stopped queue survive a reload?
 *
 * The shelf is stubbed in the page: two books with scans and no reading
 * (the scanned fixture and the born-digital one, so both sources go through),
 * and every PUT is caught and its gzip opened here. Asserted on the bytes that
 * reach the shelf, because a reading that fails to upload looks exactly like
 * one still running. Needs the dev server up.
 *
 *   node scripts/check-recon-queue.mjs
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const books = [
  { dir: 'Anon-TheScannedBook-aaa111', fileName: 'test-book.pdf', scan: 'public/test-book.pdf' },
  {
    dir: 'Anon-TheTypesetBook-bbb222',
    fileName: 'test-digital.pdf',
    scan: 'public/test-digital.pdf'
  }
].map((b, i) => ({
  ...b,
  key: `${b.fileName}\u0000${readFileSync(b.scan).length}\u00001`,
  scanPath: `scans/${i}.pdf`,
  bytes: readFileSync(b.scan)
}))

const uploads = new Map()
let failed = false
const fail = (msg) => {
  failed = true
  console.error(`FAIL: ${msg}`)
}

async function stub(page) {
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    const url = req.url()
    const raw = /vnd\.github\.raw/.test(req.headers()['accept'] ?? '')
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ full_name: 'LazMcSpaz/Test-Shelf', default_branch: 'main' })
      })
    }
    const path = decodeURIComponent(/\/contents\/([^?]+)/.exec(url)?.[1] ?? '')
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData())
      uploads.set(path, Buffer.from(body.content, 'base64'))
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    }
    if (path === 'books') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(books.map((b) => ({ name: b.dir, type: 'dir' })))
      })
    }
    const card = /^books\/([^/]+)\/about\.json$/.exec(path)
    if (card) {
      const b = books.find((x) => x.dir === card[1])
      if (!b) return route.fulfill({ status: 404, body: '{}' })
      if (!raw)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sha: 'c' })
        })
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.github.raw',
        body: JSON.stringify({
          key: b.key,
          fileName: b.fileName,
          savedAt: '2026-09-20T12:00:00.000Z',
          pageCount: 8,
          notes: 0,
          corrections: 0,
          marked: 0,
          facts: 0,
          complete: false,
          read: 0,
          scanPath: b.scanPath
        })
      })
    }
    if (/recon\.json\.gz$/.test(path)) {
      return uploads.has(path)
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ sha: 'r' })
          })
        : route.fulfill({ status: 404, body: '{}' })
    }
    const scan = books.find((b) => b.scanPath === path)
    if (scan)
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: scan.bytes
      })
    return route.fulfill({ status: 404, body: '{}' })
  })
}

const browser = await chromium.launch({ executablePath: CHROME })
const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } })
await context.addInitScript(() => {
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
})
const page = await context.newPage()
await stub(page)
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.deck-card', { timeout: 15000 })

const readAll = page.locator('.shelf-read-all')
const label = await readAll.textContent()
if (!/Read 2 unread scans/.test(label ?? '')) fail(`the button says "${label}"`)

// Stop after the first book is on the shelf, reload, and carry on.
await readAll.click()
const t0 = Date.now()
while (uploads.size < 1 && Date.now() - t0 < 240_000) await page.waitForTimeout(500)
if (uploads.size < 1) fail('no reading reached the shelf within four minutes')
await page.locator('.queue-actions button', { hasText: 'Stop' }).click()
await page.waitForSelector('.queue-actions button:has-text("Carry on")', { timeout: 60_000 })
const stored = await page.evaluate(() => localStorage.getItem('pdbf.reconQueue'))
if (!stored) fail('a stopped queue was not written down')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.queue-panel', { timeout: 15000 })
const left = await page.locator('.queue-count').textContent()
console.log(`  after a reload the panel says: ${left}`)
await page.locator('.queue-actions button', { hasText: 'Carry on' }).click()
const t1 = Date.now()
while (uploads.size < 2 && Date.now() - t1 < 240_000) await page.waitForTimeout(500)
await page.waitForSelector('.queue-eyebrow:has-text("Reading finished")', { timeout: 60_000 })
await page.screenshot({ path: 'screenshots/recon-queue-done.png' })

for (const b of books) {
  const path = `books/${b.dir}/recon.json.gz`
  const bytes = uploads.get(path)
  if (!bytes) {
    fail(`no reading was put at ${path}`)
    continue
  }
  if (process.env.RECON_QUEUE_KEEP) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${process.env.RECON_QUEUE_KEEP}/${b.fileName}.recon.json.gz`, bytes)
  }
  const r = JSON.parse(gunzipSync(bytes).toString('utf8'))
  const ok =
    r.format === 'pdbf-recon' &&
    r.key === b.key &&
    r.pagesDone === r.pageCount &&
    r.pageText.length === r.pageCount &&
    r.words.length > 0
  console.log(
    `  ${path}: ${bytes.length} bytes gzipped, ${r.pageCount} leaves, ${r.words.length} words, source ${r.source}`
  )
  if (!ok) fail(`the reading at ${path} is not a whole reading of ${b.fileName}`)
}

const notes = await page.locator('.deck-scan-note').allTextContents()
if (!notes.some((n) => /ready to transcribe/.test(n))) fail('no card says its scan was read')
if (await page.locator('.shelf-read-all').count())
  fail('the button still offers to read scans already read')

await browser.close()
if (failed) process.exit(1)
console.log('ok — every unread scan was read, handed on, and a stopped queue survived a reload')
