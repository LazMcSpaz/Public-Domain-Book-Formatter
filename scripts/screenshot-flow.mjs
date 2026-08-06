/**
 * Drives the wizard in a real browser and screenshots each screen.
 *
 * This is how UI work gets verified now: the app runs headless here, so a
 * change can be seen rather than shipped blind.
 *
 * Usage: node scripts/screenshot-flow.mjs [outDir]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT = process.argv[2] ?? 'screenshots'
const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
// The sandbox pins an older Chromium than the installed playwright expects.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const REPO = resolve(import.meta.dirname, '..')

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`  → ${OUT}/${name}.png`)
}

console.log('1. intake')
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.drop')
await shot('01-intake')

console.log('2. loading a book (drives the real PDF.js + Tesseract.js pipeline)')
const pdf = await fetch(`${URL_BASE}/test-book.pdf`).then((r) => r.arrayBuffer())
await page.setInputFiles('input[type=file]', {
  name: 'alchemist.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(pdf)
})

// Recon is a real OCR run; give it room.
await page.waitForSelector('.progress', { timeout: 30000 }).catch(() => {})
await shot('02-recon-progress')

// The book is opened once by recon and again by transcription. pdf.js transfers
// the ArrayBuffer it is handed, so a careless implementation leaves the second
// open with a detached buffer — which is invisible until a paid run starts.
console.log('2b. the book can be opened twice')
const reopen = await page.evaluate(async (repo) => {
  const mod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
  const res = await fetch('test-book.pdf')
  const file = new File([await res.arrayBuffer()], 'b.pdf', { type: 'application/pdf' })
  try {
    const a = await mod.openPdf(file)
    const b = await mod.openPdf(file)
    return { ok: a.numPages > 0 && b.numPages === a.numPages }
  } catch (e) {
    return { ok: false, error: String(e.message) }
  }
}, REPO)
if (!reopen.ok)
  throw new Error(`Reopening the PDF failed: ${reopen.error ?? 'page count mismatch'}`)
console.log('  → openPdf is re-entrant on the same file')

console.log('3. waiting for gate 1')
await page.waitForSelector('.terms', { timeout: 180000 })
await shot('03-gate-identity')

// Exercise the term grid: mark one row as needing a fix.
const fixButtons = page.locator('.terms .verdict button[title="Fix this reading"]')
if ((await fixButtons.count()) > 0) {
  await fixButtons.first().click()
  await shot('04-term-correction')
}

// Mobile check — the flow has to survive a phone viewport.
console.log('5. mobile viewport')
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await shot('05-gate-identity-mobile')
await page.setViewportSize({ width: 1360, height: 900 })

const rows = await page.locator('.terms tbody tr').count()
const crops = await page.locator('.terms img').count()

// The gates after this one sit behind a paid transcription run, so they are
// shot through the dev-only preview instead (see src/app/DevPreview.tsx) —
// otherwise looking at them would cost money on every UI change.
console.log('6. later gates (dev preview)')
await page.goto(`${URL_BASE}/#preview`, { waitUntil: 'networkidle' })
await page.waitForSelector('.summary', { timeout: 20000 })
await shot('06-gate-design')

// The design gate's whole point is that answers about the book produce the
// typography; check the summary actually moves when an answer does.
const summary = () => page.locator('.summary b').innerText()
const before = await summary()
const pick = (question, label) =>
  page.locator('.q').filter({ hasText: question }).locator('label', { hasText: label }).click()

// The preview is the PDF: these are real pages rendered from the bytes the
// export will produce. Waiting for one proves the whole path — fonts fetched,
// book laid out, PDF written, pdf.js rasterized it — inside a real browser,
// which is the part the unit tests cannot reach.
console.log('6b. the page preview')
await page.waitForSelector('.leaf img', { timeout: 60000 })
const leaves = await page.locator('.leaf img').count()

/**
 * A cheap fingerprint of the first previewed page.
 *
 * Comparing the image *src* would prove nothing: every regeneration mints a
 * new object URL whether or not a single pixel moved. Sampling the pixels is
 * what actually shows the preview responding to the answer.
 */
const previewFingerprint = () =>
  page.evaluate(async () => {
    const img = document.querySelector('.leaf img')
    if (!img) return 'none'
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let hash = 0
    for (let i = 0; i < data.length; i += 4) hash = (hash * 31 + data[i]) >>> 0
    return String(hash)
  })

const pagesBefore = await previewFingerprint()
await shot('06b-gate-design-preview')

await pick('What kind of book', 'Poetry')
await pick('How should chapters open', 'Drop capital')
await page.waitForTimeout(200)
const after = await summary()

// Regenerating means laying the book out again and rendering a fresh PDF.
await page.waitForTimeout(3000)
const pagesAfter = await previewFingerprint()
await shot('07-gate-design-answered')

// The preview is the widest thing in the app — a row of full page images. It
// has to scroll inside its own card, because a gate the user has to pan
// sideways to answer is a gate that fails on a phone.
console.log('6c. the preview on a phone')
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
const previewOverflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth)
await shot('08-gate-design-mobile')
await page.setViewportSize({ width: 1360, height: 900 })
await page.waitForTimeout(300)

console.log('7. the finished edition')
await page.locator('.rail li', { hasText: 'Publish the edition' }).click()
await page.waitForSelector('.result', { timeout: 20000 })
// The interior is built here, not handed to an external TeX engine, so the
// download and the page count are real and worth waiting for.
await page.waitForSelector('.result button.primary', { timeout: 60000 })
const download = await page.locator('.result button.primary').first().innerText()
await shot('09-export')
const checks = await page.locator('.checks li').count()
const pending = await page.locator('.checks li.pending').count()

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth)
await shot('10-export-mobile')

console.log('\nresult:')
console.log(`  term rows: ${rows}`)
console.log(`  word crops rendered: ${crops}`)
console.log(`  design summary: ${after}`)
console.log(`  summary responds to answers: ${before !== after}`)
console.log(`  preview pages rendered: ${leaves}`)
console.log(`  preview responds to answers: ${pagesBefore !== pagesAfter}`)
console.log(`  design gate mobile overflow: ${previewOverflow}px`)
console.log(`  export offers: ${download}`)
console.log(`  KDP checks shown: ${checks} (${pending} pending)`)
console.log(`  mobile horizontal overflow: ${overflow}px`)
console.log(`  page errors: ${errors.length ? errors.join(' | ') : 'none'}`)

await browser.close()
process.exit(
  errors.length === 0 &&
    rows > 0 &&
    before !== after &&
    leaves > 0 &&
    pagesBefore !== pagesAfter &&
    /\d+ pages/.test(download) &&
    previewOverflow <= 0 &&
    checks > 0 &&
    pending === 0 &&
    overflow <= 0
    ? 0
    : 1
)
