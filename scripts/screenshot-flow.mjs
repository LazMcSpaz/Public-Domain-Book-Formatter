/**
 * Drives the wizard in a real browser and screenshots each screen.
 *
 * This is how UI work gets verified now: the app runs headless here, so a
 * change can be seen rather than shipped blind.
 *
 * Usage: node scripts/screenshot-flow.mjs [outDir]
 */
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

/**
 * A real PNG, written here rather than checked in as a fixture.
 *
 * The picture has to *decode* — the point of the assertion is that a file the
 * editor picks goes through `createImageBitmap`, a canvas and pdf-lib and comes
 * out in the book, and a malformed byte string would only test the error path.
 */
function grayscalePng(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(body))
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) {
      raw[y * (width + 1) + 1 + x] = (x + y) % 16 < 8 ? 0 : 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

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

// The saved-run store is the only thing standing between a paid transcription
// and a closed tab, and IndexedDB exists in no unit test — so it is exercised
// here, against the real thing.
console.log('2c. the saved-run store')
const store = await page.evaluate(async (repo) => {
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)

  const make = (key, pages, savedAt) =>
    project.createSavedRun({
      key,
      fileName: `${key}.pdf`,
      pageCount: pages,
      transcriptions: Array.from({ length: pages }, (_, i) => ({
        pageIndex: i,
        role: 'body',
        blocks: [{ kind: 'paragraph', text: `Page ${i}` }],
        uncertain: [],
        furniture: {}
      })),
      failures: [],
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 },
      modelId: 'claude-opus-5',
      identityAnswers: { orthography: 'preserve' },
      savedAt
    })

  try {
    // A run survives a round-trip through storage with its pages intact.
    const saved = await runStore.saveRun(make('probe', 3, new Date().toISOString()))
    const back = await runStore.loadRun('probe')
    const roundTrip =
      saved && back !== null && back.transcriptions.length === 3 && back.modelId === 'claude-opus-5'

    // The store is capped, and evicts by age rather than at random.
    for (let i = 0; i < 12; i++) {
      await runStore.saveRun(make(`evict-${i}`, 1, new Date(2020, 0, i + 1).toISOString()))
    }
    const listed = await runStore.listRuns()
    const capped = listed.length <= 10
    const keptNewest = listed.some((r) => r.key === 'evict-11')
    const droppedOldest = !listed.some((r) => r.key === 'evict-0')

    // A record this version cannot read is discarded, not offered forever.
    await new Promise((resolve) => {
      const req = indexedDB.open('pdbf', 1)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('runs', 'readwrite')
        tx.objectStore('runs').put({ key: 'stale', schemaVersion: 4, savedAt: 'x' })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
    const stale = await runStore.loadRun('stale')
    const staleDropped = stale === null && (await runStore.loadRun('stale')) === null

    for (const key of ['probe', ...Array.from({ length: 12 }, (_, i) => `evict-${i}`)]) {
      await runStore.deleteRun(key)
    }

    return { roundTrip, capped, keptNewest, droppedOldest, staleDropped }
  } catch (e) {
    return { error: String(e.message) }
  }
}, REPO)

if (store.error) throw new Error(`Saved-run store failed: ${store.error}`)
for (const [check, ok] of Object.entries(store)) {
  if (!ok) throw new Error(`Saved-run store failed: ${check}`)
}
console.log('  → runs round-trip, the store is capped and evicts oldest, stale records are dropped')

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

// The one step in this app that costs money is the one worth not repeating.
// A run stored under this file's key should be *offered* rather than silently
// used or silently ignored, and choosing it should skip every question that
// exists only to approve a charge.
console.log('5b. a paid run is offered back, not re-spent')
const bookPath = resolve(REPO, 'public/test-book.pdf')
const bookStat = await stat(bookPath)

// The key comes from the app's own `fileKey`, never from a copy of its format
// here — a harness that reimplements the thing it is testing passes when the
// two drift apart, which is exactly what happened the first time this was
// written. Playwright preserves the file's real modification time when it is
// given a path, so the key it produces on load matches this one.
const savedKey = await page.evaluate(
  async ([repo, meta]) => {
    const project = await import(`/@fs${repo}/src/core/project/index.ts`)
    return project.fileKey(meta)
  },
  [REPO, { name: 'test-book.pdf', size: bookStat.size, lastModified: Math.floor(bookStat.mtimeMs) }]
)

const seeded = await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const project = await import(`/@fs${repo}/src/core/project/index.ts`)
    await runStore.deleteRun(key)
    return runStore.saveRun(
      project.createSavedRun({
        key,
        fileName: 'test-book.pdf',
        pageCount: 9,
        transcriptions: Array.from({ length: 9 }, (_, i) => ({
          pageIndex: i,
          role: i === 0 ? 'title-page' : 'body',
          blocks: [
            { kind: 'paragraph', text: `Restored page ${i + 1}.` },
            // The fixture prints a figure with a caption on this leaf. The
            // caption has to be in the transcription for assembly to have
            // anything to take out of the flow and give to the picture.
            ...(i === 5
              ? [{ kind: 'caption', text: 'Fig. 1. The alembick and its receiver.' }]
              : [])
          ],
          uncertain: [],
          furniture: {}
        })),
        failures: [],
        usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0 },
        modelId: 'claude-opus-5',
        identityAnswers: { orthography: 'preserve' }
      })
    )
  },
  [REPO, savedKey]
)
if (!seeded) throw new Error('Could not seed a saved run')

// Loaded from the path rather than a buffer: Playwright keeps the file's real
// modification time that way, which is what the key is built from.
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })

// Nothing to fill in here. This gate asks how the book's own language should be
// read, and every question arrives with a recommended answer — the title, the
// author and the year are asked at the export gate, where the pass has read
// them off the title page and the boxes come up already filled.
const identityAsks = await page.locator('.q').filter({ hasText: 'Book title' }).count()
if (identityAsks > 0) throw new Error('Gate 1 is asking for the title again')

await page.locator('button.primary', { hasText: 'Looks right' }).click()
await page.waitForSelector('.q', { timeout: 20000 })

const offered = await page.locator('.q').filter({ hasText: 'already had this book read' }).count()
const askedForKey = await page.locator('.q').filter({ hasText: 'API key' }).count()
await shot('08b-saved-run-offered')

// Taking the offer must reach the next gate without a cost approval appearing.
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(2000)
const resumedTo = await page.locator('.rail li.active .label').innerText()
const chargedAgain = await page.locator('.cost').count()

// --- the illustration review ------------------------------------------------
// The fixture prints an alembick in the text of one leaf and a full-page plate
// on another, so recon should have found two candidates and no others: the
// eight pages of plain text must produce nothing, or the gate is unusable.
console.log('5c. illustrations found in the scan')
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(1500)

const illustrationQuestion = page.locator('.q').filter({ hasText: 'illustrations' })
const foundIllustrations = await illustrationQuestion.locator('.opt').count()
const illustrationCrops = await illustrationQuestion.locator('img').count()
await shot('05c-gate-structure-illustrations')

// Continuing cuts the accepted regions out of the scan, which is the step that
// re-renders those pages — so reaching the next gate at all proves the crop ran.
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(4000)
const afterStructure = await page.locator('.rail li.active .label').innerText()

// --- proofreading -----------------------------------------------------------
// The one step with no questions: the scan on one side, what was read off it on
// the other. This is also the only place a wrong word can be fixed at all.
console.log('5c2. the proof sheet')
await page.waitForSelector('.proof', { timeout: 60000 })
await shot('05c2-proof-sheet')

const proofBoxes = await page.locator('.proof-block textarea').count()
const proofScan = await page.locator('.proof-scan img').count()

// Correcting a word must reach the finished PDF, which is the whole point.
const firstBox = page.locator('.proof-block textarea').first()
await firstBox.fill('The chirurgeon examined the specimen with extraordinary care.')
await page.waitForTimeout(300)
const correctedCount = await page.locator('.proof-where small').innerText()

// An editor's note — the differentiation route that costs nothing but writing.
// It has to reach the foot of the printed page, or it is decoration.
await page.locator('.proof-split button', { hasText: 'Add a note here' }).first().click()
await page
  .locator('.proof-annotation textarea')
  .first()
  .fill('Paracelsus, whom the author follows throughout this chapter.')
await page.waitForTimeout(300)
const annotations = await page.locator('.proof-annotation').count()
await shot('05c2b-proof-note')

// A picture of the editor's own — the other differentiation route, and the one
// the app could not do at all before: every image came out of the scan.
const png = grayscalePng(64, 48)
await page.locator('.proof-add-image input[type=file]').first().setInputFiles({
  name: 'portrait.png',
  mimeType: 'image/png',
  buffer: png
})
await page.waitForTimeout(600)
await page.locator('.proof-picture input[type=text]').first().fill('The author, from life.')
await page.waitForTimeout(300)
const suppliedPictures = await page.locator('.proof-picture').count()
const suppliedPreview = await page.locator('.proof-picture img').count()
await shot('05c2c-proof-added-picture')

// The phone viewport: the scan stacks above the text rather than beside it.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await shot('05c3-proof-sheet-mobile')
const proofOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
await page.setViewportSize({ width: 1360, height: 900 })
await page.waitForTimeout(300)

await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(1500)

// The design gate now previews the *real* book, pictures and all. This is the
// end of the path: detected from the OCR boxes, judged by the pixels, reviewed,
// cropped, laid out, embedded, and rasterized back — so a leaf here with a
// picture on it means every one of those steps worked.
console.log('5d. the pictures reach the page')
await page.waitForSelector('.leaf img', { timeout: 120000 })
await page.waitForTimeout(1500)
await shot('05d-design-preview-with-plate')

// Is any previewed leaf mostly picture? A plate is a page given over to one
// illustration, so it is far darker than a page of type — which is a check on
// the pixels rather than on the app's own account of itself.
const leafInk = await page.evaluate(async () => {
  const out = []
  for (const img of document.querySelectorAll('.leaf img')) {
    const c = document.createElement('canvas')
    c.width = 60
    c.height = 90
    const ctx = c.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
    out.push(dark / (c.width * c.height))
  }
  return out
})

// A previewed page of type is around a per cent of ink at this scale; a leaf
// carrying a picture is several times that. The gap is wide enough that the
// threshold does not need to be precise — but it is printed below either way,
// so a change in it is visible rather than a silent pass.
const plateFound = leafInk.some((ink) => ink > 0.04)

// --- the export report, on a book that really has pictures in it -----------
// The image-DPI check used to say "No placed images to check" because nothing
// ever placed one. Now it has a measured answer, and this is where that shows.
console.log('5e. the export report accounts for the pictures')
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(1000)

// The seeded transcription carries no front-matter metadata, so the export
// gate's first two fields come up empty — and it refuses to build, which is the
// point of their being required. A real run arrives here prefilled.
const fill = (question, value) =>
  page.locator('.q').filter({ hasText: question }).locator('input[type=text]').fill(value)
const blockedWithoutTitle = await page.locator('.actions button.primary').isDisabled()
await fill('Book title', 'The Alchemist His Practise')
await fill('Author', 'Anonymous')

await page.locator('.actions button.primary').first().click()
await page.waitForSelector('.checks', { timeout: 120000 })
await page.waitForTimeout(1500)
await shot('05e-export-with-illustrations')

const imageCheck = await page
  .locator('.checks li')
  .filter({ hasText: 'Image DPI' })
  .innerText()
  .catch(() => '')
const illustrationNote = await page
  .locator('.notes li')
  .filter({ hasText: 'illustration' })
  .first()
  .innerText()
  .catch(() => '')
const noteNote = await page
  .locator('.notes li')
  .filter({ hasText: 'footnote' })
  .first()
  .innerText()
  .catch(() => '')

await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    await runStore.deleteRun(key)
  },
  [REPO, savedKey]
)

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
console.log(`  saved run offered: ${offered === 1}`)
console.log(`  no key asked for when reusing it: ${askedForKey === 0}`)
console.log(`  resumed to: ${resumedTo} (cost prompts: ${chargedAgain})`)
console.log(`  illustration candidates: ${foundIllustrations} (crops shown: ${illustrationCrops})`)
console.log(`  advanced past the structure gate to: ${afterStructure}`)
console.log(`  proof sheet: ${proofBoxes} editable block(s), ${proofScan} scan(s) beside them`)
console.log(`  after correcting one: ${correctedCount.replace(/\s+/g, ' ')}`)
console.log(`  editor's notes attached: ${annotations}`)
console.log(`  pictures the editor added: ${suppliedPictures} (previewed: ${suppliedPreview})`)
console.log(`  the note is set at the foot of a page: ${noteNote.replace(/\s+/g, ' ')}`)
console.log(`  proof sheet mobile overflow: ${proofOverflow}px`)
console.log(`  export blocked until the title is given: ${blockedWithoutTitle}`)
console.log(`  image DPI check: ${imageCheck.replace(/\s+/g, ' ')}`)
console.log(`  export note: ${illustrationNote.replace(/\s+/g, ' ')}`)
console.log(
  `  a plate is previewed from the real PDF: ${plateFound}` +
    ` (leaf ink: ${leafInk.map((i) => `${(i * 100).toFixed(1)}%`).join(', ')})`
)
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
    offered === 1 &&
    askedForKey === 0 &&
    chargedAgain === 0 &&
    // The two the fixture prints, and nothing from the eight pages of text.
    foundIllustrations === 2 &&
    illustrationCrops === foundIllustrations &&
    plateFound &&
    proofBoxes > 0 &&
    proofScan === 1 &&
    /1 corrected/.test(correctedCount) &&
    annotations === 1 &&
    suppliedPictures === 1 &&
    suppliedPreview === 1 &&
    // Three pictures now reach the book: two cut from the scan, one supplied.
    /3 illustrations set into the book/.test(illustrationNote) &&
    // The export screen reports what the engine actually placed, so this is
    // the authored note reaching the book rather than reaching a form.
    /1 footnote\(s\) were set at the foot/.test(noteNote) &&
    proofOverflow <= 0 &&
    // A real answer, not the "no placed images to check" it gave before.
    blockedWithoutTitle &&
    /DPI/.test(imageCheck) &&
    !/No placed images/.test(imageCheck) &&
    /illustration/.test(illustrationNote) &&
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
