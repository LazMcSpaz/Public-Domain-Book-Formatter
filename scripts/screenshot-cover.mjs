/**
 * Drive the cover studio headlessly and photograph it.
 *
 * The sibling of `screenshot-flow.mjs`, for the arm it does not reach. UI work
 * here is verifiable — Chromium and Playwright are installed — so a cover
 * change ships with a picture of the cover it produces rather than a hope.
 *
 * What it exercises, in order: an empty studio, a filled-in typographic cover,
 * and the picture path end to end — a plate uploaded, cropped to the frame,
 * embedded, and measured for DPI at the size it prints. The last one is the
 * whole point: everything before it is text, and the picture is where a cover
 * gets expensive to be wrong about.
 *
 *   npm run dev
 *   node scripts/screenshot-cover.mjs
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.argv[2] ?? 'screenshots'
const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
// The sandbox pins an older Chromium than the installed playwright expects.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

/**
 * A stand-in plate, at a resolution a real one would have.
 *
 * 2400 × 3000 is what a 300-DPI render of an 8 × 10 in page gives, which is the
 * size the illustration pipeline actually produces — so the DPI check in the
 * screenshot is reporting a number this app would really see.
 */
async function makePlate() {
  const width = 2400
  const height = 3000
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width / 2) / width
      const dy = (y - height / 2) / height
      const r = Math.hypot(dx, dy)
      const v = Math.max(
        20,
        Math.min(
          245,
          Math.round(
            235 - 120 * Math.abs(Math.sin(r * 38)) - 30 * Math.abs(Math.sin((dx + dy) * 60))
          )
        )
      )
      row[1 + x * 3] = v
      row[2 + x * 3] = v
      row[3 + x * 3] = v
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
  const path = join(tmpdir(), 'cover-plate.png')
  await writeFile(path, png)
  return path
}

await mkdir(OUT, { recursive: true })
const plate = await makePlate()

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const field = (label, kind = 'input') =>
  page.locator('.q', { hasText: label }).locator(kind).first()

await page.goto(`${URL_BASE}/#cover`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cover-preview img', { timeout: 60000 })
await page.screenshot({ path: `${OUT}/cover-studio.png`, fullPage: true })

await field('The title, as it prints').fill('A Treatise on the Keeping of Bees')
await field('The author').fill('Amos Ives Root')
await field('How many pages is the finished interior').fill('284')
// The refinements are behind `details` on purpose; open them to photograph them.
await page.evaluate(() =>
  document.querySelectorAll('details.q-group').forEach((d) => d.setAttribute('open', ''))
)
await field('The back cover', 'textarea').fill(
  'First published in 1877 and reset entire from the original edition.\n\n' +
    'The text follows the first printing; the notes and the setting are new.'
)
await field('The imprint').fill('Blackthorn Press')
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/cover-studio-filled.png`, fullPage: true })
await page.locator('.cover-preview').screenshot({ path: `${OUT}/cover-typographic.png` })

// The picture path: upload a plate, and watch it get cropped, placed and measured.
await page
  .locator('.q', { hasText: 'Where does the picture come from' })
  .getByText('A picture of your own')
  .click()
await page.setInputFiles('input[type=file]', plate)
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('.checks li')].some(
      (li) => li.textContent?.includes('DPI across') === true
    ),
  undefined,
  { timeout: 90000 }
)
await page.locator('.cover-preview').screenshot({ path: `${OUT}/cover-with-plate.png` })

const checks = await page.locator('.checks li').allTextContents()
console.log(checks.map((c) => `  ${c}`).join('\n'))

await browser.close()

if (errors.length > 0) {
  console.error(`\n${errors.length} console error(s):\n${errors.join('\n')}`)
  process.exit(1)
}
console.log('\nNo console errors.')
