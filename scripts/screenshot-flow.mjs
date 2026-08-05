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

const OUT = process.argv[2] ?? 'screenshots'
const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
// The sandbox pins an older Chromium than the installed playwright expects.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

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
await pick('What kind of book', 'Poetry')
await pick('How should chapters open', 'Drop capital')
await page.waitForTimeout(200)
const after = await summary()
await shot('07-gate-design-answered')

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth)
await shot('08-gate-design-mobile')

console.log('\nresult:')
console.log(`  term rows: ${rows}`)
console.log(`  word crops rendered: ${crops}`)
console.log(`  design summary: ${after}`)
console.log(`  summary responds to answers: ${before !== after}`)
console.log(`  mobile horizontal overflow: ${overflow}px`)
console.log(`  page errors: ${errors.length ? errors.join(' | ') : 'none'}`)

await browser.close()
process.exit(errors.length === 0 && rows > 0 && before !== after && overflow <= 0 ? 0 : 1)
