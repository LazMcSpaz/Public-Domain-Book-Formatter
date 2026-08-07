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
      // No version: the store's own schema decides it. Naming a stale version
      // here raises VersionError and this promise would never settle.
      const req = indexedDB.open('pdbf')
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

// Banked looks live in the same database as runs but under opposite rules, and
// the upgrade that added them has to leave the runs alone — which is the one
// thing no unit test can check, because there is no IndexedDB in vitest.
console.log('2d. the banked-look store')
const looks = await page.evaluate(async (repo) => {
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
  const style = await import(`/@fs${repo}/src/core/style/index.ts`)

  try {
    const first = style.newSavedProfile({
      name: 'Blackthorn',
      style: { ...style.defaultStyleProfile(), bodyFont: 'Cardo', bodyFontSize: 12.5 },
      imprint: { imprint: 'Blackthorn Press', copyrightHolder: 'A. Editor' }
    })
    await runStore.saveProfile(first)
    const back = await runStore.loadProfile(first.id)
    const roundTrip =
      back !== null &&
      back.style.bodyFontSize === 12.5 &&
      back.imprint.imprint === 'Blackthorn Press'

    // Topping up the imprint must overwrite, not bank a second look.
    await runStore.saveProfile(
      style.newSavedProfile({
        id: first.id,
        name: first.name,
        style: first.style,
        imprint: { ...first.imprint, copyrightHolder: 'Someone Else' }
      })
    )
    const listed = await runStore.listProfiles()
    const overwrote =
      listed.filter((p) => p.id === first.id).length === 1 &&
      listed.find((p) => p.id === first.id).imprint.copyrightHolder === 'Someone Else'

    // The v2 upgrade must not have disturbed the runs store beside it.
    const runsIntact = Array.isArray(await runStore.listRuns())

    await runStore.deleteProfile(first.id)
    const deleted = (await runStore.loadProfile(first.id)) === null

    return { roundTrip, overwrote, runsIntact, deleted }
  } catch (e) {
    return { error: String(e.message) }
  }
}, REPO)

if (looks.error) throw new Error(`Banked-look store failed: ${looks.error}`)
for (const [check, ok] of Object.entries(looks)) {
  if (!ok) throw new Error(`Banked-look store failed: ${check}`)
}
console.log(
  '  → looks round-trip, a top-up overwrites rather than duplicating, runs survive the upgrade'
)

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

// An introduction — the differentiation route that is actually *writing*, and
// the one that needed a real change to the engine: a section is not a block.
await page.locator('.proof-sections-bar button', { hasText: 'Add an introduction' }).click()
await page
  .locator('.proof-section textarea')
  .first()
  .fill(
    'The author of this treatise is unknown to us.\n\n' +
      'What follows is a reprint of the 1662 text, set afresh for this edition.'
  )
await page.waitForTimeout(300)
const sectionsWritten = await page.locator('.proof-section').count()
await shot('05c2d-proof-introduction')

// The image-editing mode: SPEC §6's "real instrument". The controls have to
// reach the pixels that get embedded, or they are decoration.
const editors = await page.locator('.editor').count()
const beforeDpi = await page
  .locator('.editor-hint')
  .first()
  .innerText()
  .catch(() => '')

// Levels and a threshold on the first picture, which is the pair that rescues
// an engraving printed on foxed paper.
const blackPoint = page.locator('.editor-controls label', { hasText: 'Black point' })
await blackPoint.locator('input[type=range]').fill('60')
await page
  .locator('.editor-toggles label', { hasText: 'Pure black and white' })
  .locator('input')
  .first()
  .check()
await page.waitForTimeout(1200)
const retouchedPicture = await page.locator('.editor-reset').count()
await shot('05c2e-image-editing')

// A picture cut from the scan is edited on the leaf it came from — which is
// also the case that matters, since the detector's crop is a first guess.
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(400)
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(400)
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(400)
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(1500)

const cutEditor = await page.locator('.proof-picture .editor').count()
const cutHintBefore = await page
  .locator('.proof-picture .editor-hint')
  .first()
  .innerText()
  .catch(() => '')

// Crop it by dragging across the middle of the preview, and check the book's
// share of pixels actually falls.
const canvas = page.locator('.proof-picture .editor-canvas').first()
const box = await canvas.boundingBox()
let cutHintAfter = cutHintBefore
if (box) {
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  cutHintAfter = await page
    .locator('.proof-picture .editor-hint')
    .first()
    .innerText()
    .catch(() => '')
}
await shot('05c2f-image-crop')

const pixelsOf = (hint) => {
  const m = /(\d+)×(\d+)/.exec(hint.replace(/\s+/g, ' '))
  return m ? Number(m[1]) * Number(m[2]) : 0
}
const cropShrankIt = pixelsOf(cutHintAfter) > 0 && pixelsOf(cutHintAfter) < pixelsOf(cutHintBefore)

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

// Book one banks its look here (SPEC §7). Nothing has been banked yet, so the
// gate is still the five-question interview — with one extra box at the bottom.
console.log('5d2. banking the look for the next book')
const bankedName = 'The Blackthorn Press look'
const looksOfferedToBookOne = await page.locator('.q').filter({ hasText: 'already set up' }).count()
await page
  .locator('.q')
  .filter({ hasText: 'Save this look' })
  .locator('input[type=text]')
  .fill(bankedName)

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

// The publisher's details are asked here, one gate after the look was named.
// They are facts about the imprint, so they get written back onto it.
const imprintBlankOnBookOne = await page
  .locator('.q')
  .filter({ hasText: 'Who is publishing' })
  .locator('input[type=text]')
  .inputValue()
await fill('Who is publishing', 'Blackthorn Press')
await fill('Who holds the copyright', 'A. Editor')

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
const contentsNote = await page
  .locator('.notes li')
  .filter({ hasText: 'contents' })
  .first()
  .innerText()
  .catch(() => '')

// The publisher's details were just written back onto the banked look, and the
// screen has to say so — changing saved state silently is how a user discovers
// on book three that something has been following them around.
const savedBackNote = await page
  .locator('.result .help')
  .filter({ hasText: 'next book' })
  .first()
  .innerText()
  .catch(() => '')

// --- book two ---------------------------------------------------------------
// The whole feature only exists across two books, so it is verified across two.
// A full reload is the point: the look has to come back off the disk, not out
// of a variable this tab still happens to be holding.
console.log('5f. book two — the look comes back')
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })

/** Click the gate's primary button and wait for the rail to land on `label`. */
const advanceTo = async (label) => {
  await page.locator('.actions button.primary').first().click()
  await page.waitForFunction(
    (want) => document.querySelector('.rail li.active .label')?.textContent?.includes(want),
    label,
    { timeout: 120000 }
  )
}

await advanceTo('Transcribing')
await advanceTo('Check the uncertain spots')
await advanceTo('Confirm the structure')
await advanceTo('Read it through')
await advanceTo('Design the edition')
await page.waitForTimeout(1500)
await shot('05f-design-gate-book-two')

// One question, not five: everything the interview would ask was answered for
// book one and banked.
const bookTwoQuestions = await page.locator('.q .prompt').allInnerTexts()
const looksOfferedToBookTwo = await page
  .locator('.q')
  .filter({ hasText: 'already set up' })
  .locator('.opt')
  .filter({ hasText: bankedName })
  .count()

// And the imprint arrives filled in rather than retyped.
await advanceTo('Publish the edition')
await page.waitForTimeout(500)
const imprintOnBookTwo = await page
  .locator('.q')
  .filter({ hasText: 'Who is publishing' })
  .locator('input[type=text]')
  .inputValue()
const isbnOnBookTwo = await page
  .locator('.q')
  .filter({ hasText: 'ISBN' })
  .locator('input[type=text]')
  .inputValue()
await shot('05f2-export-gate-book-two')

await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    await runStore.deleteRun(key)
    for (const p of await runStore.listProfiles()) await runStore.deleteProfile(p.id)
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

// Junicode is the one face this repo ships itself, the only one that is CFF
// rather than TrueType, and the only one loaded by fetch instead of bundled. So
// it is the only one whose absence looks exactly like success — the app
// substitutes EB Garamond and prints a notice nobody reads. Picking it here is
// the check that it is really there and really embeddable.
console.log('6d. Junicode, the vendored face')
await pick('Typeface', 'Junicode')
await page.waitForTimeout(4000)
await page.waitForSelector('.leaf img', { timeout: 60000 })
const junicodeSummary = await summary()
const substituted = await page.locator('.help').filter({ hasText: 'isn’t installed here' }).count()
const junicodeInk = await page.evaluate(async () => {
  const img = document.querySelector('.leaf img')
  if (!img) return 0
  await img.decode()
  const c = document.createElement('canvas')
  c.width = 120
  c.height = 180
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  let dark = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
  return dark / (c.width * c.height)
})
await shot('08c-junicode')

// Real small capitals, on a face that has them. IM FELL — the interview's
// recommendation for the 17th century — has none, so this switches to EB
// Garamond, which is also the honest demonstration that the two faces are
// treated differently rather than both being upper-cased.
console.log('6e. small capitals')
await pick('Typeface', 'EB Garamond')
await page.waitForTimeout(4000)
await page.waitForSelector('.leaf img', { timeout: 60000 })
await shot('08d-small-caps')

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

// The failure this guards against was reported from a real book: a refresh put
// an empty drop zone in front of someone whose paid run was in the database,
// with nothing on the screen to say so. `listRuns` had been written for exactly
// this and called by nothing.
console.log('11. a refresh does not look like a fresh start')
// The scan is kept with the run now, so a reload offers to reopen the book
// outright. Verified by storing the real fixture and pressing the button, which
// is the only way to know the rebuilt File keeps the identity its run is under.
const reopened = await page.evaluate(
  async ([repo, path]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const project = await import(`/@fs${repo}/src/core/project/index.ts`)
    const bytes = new Uint8Array(await (await fetch(path)).arrayBuffer())
    const file = new File([bytes], 'kept-book.pdf', {
      type: 'application/pdf',
      lastModified: 12345
    })
    const key = project.fileKey(file)
    await runStore.saveRun(
      project.createSavedRun({
        key,
        fileName: 'kept-book.pdf',
        pageCount: 9,
        transcriptions: [
          {
            pageIndex: 0,
            role: 'body',
            blocks: [{ kind: 'paragraph', text: 'x' }],
            uncertain: [],
            furniture: {}
          }
        ],
        failures: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        modelId: 'claude-opus-5',
        identityAnswers: {}
      })
    )
    const stored = await runStore.saveSourceFile(key, file)
    const back = await runStore.loadSourceFile(key)
    // The rebuilt file must key to the same run, or reopening loses the book.
    return { stored, sameKey: back !== null && project.fileKey(back) === key }
  },
  [REPO, '/test-book.pdf']
)
if (!reopened.stored) throw new Error('The scan could not be stored')
if (!reopened.sameKey) throw new Error('A reopened scan does not key to its own run')
console.log('  → the scan round-trips and keeps the identity its run is filed under')

// Seeded first: the store checks above clean up after themselves, so at this
// point there is genuinely nothing saved and an empty intake would be correct.
await page.evaluate(async (repo) => {
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  await runStore.saveRun(
    project.createSavedRun({
      key: project.fileKey({ name: 'a-paid-book.pdf', size: 999, lastModified: 1 }),
      fileName: 'a-paid-book.pdf',
      pageCount: 312,
      transcriptions: [
        {
          pageIndex: 0,
          role: 'body',
          blocks: [{ kind: 'paragraph', text: 'x' }],
          uncertain: [],
          furniture: {}
        }
      ],
      failures: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      modelId: 'claude-opus-5',
      identityAnswers: {}
    })
  )
}, REPO)
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const runsOnIntake = await page
  .locator('.q')
  .filter({ hasText: 'already paid to have read' })
  .count()
const namedOnIntake = await page.locator('.notes li').filter({ hasText: '.pdf' }).count()
await shot('02b-intake-saved-runs')
if (runsOnIntake !== 1) throw new Error('Intake does not mention the saved runs')
console.log(`  → intake names ${namedOnIntake} saved transcription(s) after a reload`)

// And the one that matters: press it, and the book opens with no file picker.
const reopenBtn = page.locator('.notes button', { hasText: 'Open this book again' })
const reopenOffered = await reopenBtn.count()
if (reopenOffered === 0) throw new Error('No way to reopen a book whose scan is stored')
await reopenBtn.first().click()
await page.waitForSelector('.progress', { timeout: 30000 })
const resumeSaid = await page.locator('.progress .help').filter({ hasText: 'already paid' }).count()
await shot('02c-reopened-from-storage')
console.log(
  `  → reopened from storage without the picker; said so during the re-read: ${resumeSaid === 1}`
)
if (resumeSaid !== 1) throw new Error('Nothing told the user their paid run was waiting')
await page.evaluate(async (repo) => {
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
  const project = await import(`/@fs${repo}/src/core/project/index.ts`)
  await runStore.deleteRun(project.fileKey({ name: 'a-paid-book.pdf', size: 999, lastModified: 1 }))
}, REPO)

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
console.log(`  divisions written: ${sectionsWritten}`)
console.log(`  image editors offered: ${editors} (${beforeDpi.replace(/\s+/g, ' ')})`)
console.log(`  retouching applied: ${retouchedPicture > 0}`)
console.log(`  editor on a scan-cut picture: ${cutEditor > 0}`)
console.log(`  dragging a crop shrinks what the book gets: ${cropShrankIt}`)
console.log(`    ${cutHintBefore.replace(/\s+/g, ' ')} -> ${cutHintAfter.replace(/\s+/g, ' ')}`)
console.log(`  the introduction reaches the contents: ${contentsNote.replace(/\s+/g, ' ')}`)
console.log(`  the note is set at the foot of a page: ${noteNote.replace(/\s+/g, ' ')}`)
console.log(`  proof sheet mobile overflow: ${proofOverflow}px`)
console.log(`  book one was offered no banked look: ${looksOfferedToBookOne === 0}`)
console.log(`  book one's imprint box started empty: ${imprintBlankOnBookOne === ''}`)
console.log(`  written back to the look, and said so: ${savedBackNote.replace(/\s+/g, ' ')}`)
console.log(`  book two is asked: ${bookTwoQuestions.join(' / ')}`)
console.log(`  and offered the banked look: ${looksOfferedToBookTwo === 1}`)
console.log(
  `  book two's imprint arrives as: "${imprintOnBookTwo}" (ISBN stays "${isbnOnBookTwo}")`
)
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
console.log(`  Junicode loads without substitution: ${substituted === 0}`)
console.log(`    ${junicodeSummary}`)
console.log(`    and puts ink on the page: ${(junicodeInk * 100).toFixed(1)}%`)
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
    sectionsWritten === 1 &&
    editors > 0 &&
    retouchedPicture > 0 &&
    cutEditor > 0 &&
    cropShrankIt &&
    // A book whose only heading is the editor's own still gets a contents page.
    /1 heading\(s\), 1 of them yours/.test(contentsNote) &&
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
