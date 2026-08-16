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
              : []),
            // A table, so the columns are driven through assembly, the proof
            // step, the layout engine and pdf-lib rather than only asserted on
            // in the unit tests.
            ...(i === 3
              ? [
                  {
                    kind: 'table',
                    text: '',
                    headerRow: true,
                    cells: [
                      ['Year', 'Barrels', 'Port'],
                      ['1665', '1,204', 'Bristol'],
                      ['1666', '987', 'Hull'],
                      ['1667', '1,310', 'Whitby']
                    ]
                  }
                ]
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

// The uncertainty gate has to show the scan *and* what was read off it: a
// thumbnail of a page of dense type cannot be proofread on its own.
const gateScans = await page.locator('.q-evidence.readable img').count()
const gateText = await page
  .locator('.q-evidence.readable pre')
  .first()
  .innerText()
  .catch(() => '')
await shot('08c-uncertainty-gate-side-by-side')

// A verdict clicked here must survive a refresh. It costs time rather than
// money, which is why it used to be thrown away while the pages it applied to
// were carefully kept.
const verdicts = page.locator('.q').filter({ hasText: 'Page ' }).first()
if ((await verdicts.count()) > 0) {
  await verdicts.locator('.opt', { hasText: 'Leave this page out' }).click()
  await page.waitForTimeout(900)
}
const verdictBefore = await page.evaluate(() =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith('pdbf.review.'))
    .map((k) => localStorage.getItem(k) ?? '')
    .join('')
)
const verdictSaved = /"skip"/.test(verdictBefore)

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
// The title page is a source of metadata rather than a leaf to proof, so the
// first leaf here is page two of the scan and the seeded table on page four is
// two steps along.
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(400)
await page.locator('.proof-bar button', { hasText: 'Next ›' }).click()
await page.waitForTimeout(400)

// This leaf carries the seeded table. A table is edited as its rows rather
// than as prose, so this is also where the columns can be seen going in.
const tableBoxes = await page.locator('.proof-block textarea.proof-table').count()
const tableRetyped = await page
  .locator('.proof-block')
  .filter({ has: page.locator('textarea.proof-table') })
  .locator('select')
  .first()
  .inputValue()
  .catch(() => '')
await shot('05c2f-proof-table')

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

// --- the editor's own notes -------------------------------------------------
// The first thing the app *writes* rather than recovers. The API is stubbed
// here, so this exercises the gate, the review screen and the path from an
// approved note to the printed page without a key and without spending.
console.log('5c4. notes and an introduction of the editor’s own')

await page.evaluate(() => localStorage.setItem('pdbf.apiKey', 'sk-ant-harness'))

await page.route('https://api.anthropic.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}')
  const wantsIntroduction = Boolean(body.output_config?.format?.schema?.properties?.paragraphs)
  const prompt = body.messages?.[0]?.content?.[0]?.text ?? ''

  // Anchor the note to a block the app actually sent, read out of the prompt
  // rather than assumed here — a harness that reimplements the thing it tests
  // passes when the two drift apart.
  const match = /\[(p\d+b\d+)\](?: \[[^\]]+\])? (.+)/.exec(prompt)
  const blockId = match?.[1] ?? ''
  const word =
    (match?.[2] ?? '')
      .split(/\s+/)
      .find((w) => w.length > 5)
      ?.replace(/[.,]$/, '') ?? ''

  // The harvest rides this same reply, which is the whole point of it — and is
  // also what a standalone harvest asks for on its own.
  const facts =
    blockId && word
      ? [
          {
            blockId,
            title: 'The wet way of digestion',
            body: 'Matter left in a sealed vessel over gentle heat for weeks at a time rather than driven hard. The author treats the period as settled and does not argue for it, which suggests it was already conventional by 1662.',
            footing: 'stated',
            category: 'method',
            tags: ['distillation', 'apparatus'],
            quote: word
          }
        ]
      : []

  const payload = wantsIntroduction
    ? {
        title: 'Introduction',
        paragraphs: [
          'This treatise was printed in 1662, when chymistry was still arguing with alchemy.',
          'What follows is set afresh, with the spelling of the original kept.'
        ]
      }
    : {
        notes:
          blockId && word
            ? [
                {
                  blockId,
                  anchorText: word,
                  kind: 'obsolete-science',
                  text: 'A term of art from the older chymistry, which Boyle was in the middle of dismantling.',
                  reason: 'the reader is assumed to know it'
                }
              ]
            : [],
        facts
      }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0 }
    })
  })
})

await page.locator('.actions button.primary').first().click()
await page.waitForSelector('.q', { timeout: 30000 })

const annotateStep = await page.locator('.rail li.active .label').innerText()
const asksPenName = await page.locator('.q').filter({ hasText: 'name do the notes' }).count()
const asksHarvest = await page.locator('.q').filter({ hasText: 'worth remembering' }).count()
await page
  .locator('.q')
  .filter({ hasText: 'name do the notes' })
  .locator('input')
  .fill('Etsu T. Dhent')
await shot('05c4-annotate-gate')

// The cost approval, which must appear before anything is spent.
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(600)
const notesCost = await page
  .locator('.q')
  .filter({ hasText: 'Ready to write the notes' })
  .innerText()
  .catch(() => '')
await shot('05c4b-annotate-cost')

await page.locator('button.primary', { hasText: 'Start' }).click()
await page.waitForSelector('.notes', { timeout: 60000 })
await page.waitForTimeout(800)

const proposedNotes = await page.locator('.note').count()
const notePassages = await page.locator('.note-passage b').count()
const claimsMarked = await page.locator('.note mark.claim').count()
const introDrafted = await page.locator('.notes-intro textarea').count()
await shot('05c4c-note-review')

await page.locator('.notes .actions button.primary').click()
await page.waitForTimeout(2000)

// The voice is banked on the device, so book two does not ask again.
const bankedVoice = await page.evaluate(() => localStorage.getItem('pdbf.voice') ?? '')

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
// The interview does the bulk of the work; this is the rest of it, on the book
// in front of you rather than on a saved look. A tweak has to reach the pages —
// the preview is the PDF, so a changed page here is a changed page in the file.
// Undone again afterwards, so the rest of this run sees the book it expects.
console.log('5d3. anything you would change?')
// Every leaf, not just the first: the first is a near-blank half-title, and a
// paragraph indent would leave it untouched while changing every page of prose
// behind it.
const leafHash = () =>
  page.evaluate(async () => {
    let h = 0
    for (const img of document.querySelectorAll('.leaf img')) {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = 120
      c.height = 180
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      for (let i = 0; i < data.length; i += 4) h = (h * 31 + data[i]) >>> 0
    }
    return String(h)
  })

await page.locator('.tweaks > summary').click()
await page.waitForTimeout(300)
const tweakCount = await page.locator('.tweaks .q').count()
const beforeTweak = await leafHash()
// The paragraph indent is the plainest visible change and the one that was a
// constant in the paginator until now.
await page
  .locator('.tweaks .q')
  .filter({ hasText: 'Paragraph indent' })
  .locator('label')
  .filter({ hasText: /^2 em$/ })
  .click()
await page.waitForTimeout(5000)
const afterTweak = await leafHash()
await shot('05d3-design-tweaks')

await page.locator('.tweaks button', { hasText: 'Undo my changes' }).click()
await page.waitForTimeout(5000)
const undoneTweak = await leafHash()

if (tweakCount < 20) throw new Error(`Only ${tweakCount} detailed controls at the design gate`)
if (beforeTweak === afterTweak) throw new Error('A tweak did not reach the previewed pages')
if (undoneTweak !== beforeTweak) throw new Error('Undoing the tweaks did not restore the book')
console.log(`  → ${tweakCount} controls; a change re-set the book and undo put it back`)

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

// Any page of the finished book — the design gate shows four leaves, which
// never includes the one your note actually landed on.
await page.locator('.leafing summary').click()
await page.waitForSelector('.browser-leaf img', { timeout: 60000 })
const browserPages = await page.locator('.browser-bar').innerText()
// A leaf with body text on it, so the ink reading below means something —
// page four of this fixture is the copyright page and is nearly white.
await page.locator('.browser-bar input').fill('7')
await page.waitForTimeout(2500)
const leafedTo = await page.locator('.browser-leaf img').getAttribute('alt')
// Proof the leaf actually rasterized, rather than that an <img> tag exists.
const leafRendered = await page.evaluate(() => {
  const img = document.querySelector('.browser-leaf img')
  return img ? img.naturalWidth > 200 && img.naturalHeight > 200 : false
})
await shot('05e3-page-browser')
await page.locator('.leafing summary').click()

// The fact bank, offered below the PDF and never as part of it.
const bankPanel = await page
  .locator('.q')
  .filter({ hasText: 'worth remembering' })
  .innerText()
  .catch(() => '')
const bankDownloads = await page
  .locator('.q')
  .filter({ hasText: 'worth remembering' })
  .locator('button')
  .count()
await shot('05e2-fact-bank-offered')

// Read the file the button would hand over, rather than trusting the button.
const bankMarkdown = await page.evaluate(async () => {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Download the notes')
  )
  if (!button) return ''
  // Intercept the object URL the download creates and read the blob back.
  const realCreate = URL.createObjectURL.bind(URL)
  let captured = null
  URL.createObjectURL = (blob) => {
    captured = blob
    return realCreate(blob)
  }
  button.click()
  URL.createObjectURL = realCreate
  return captured ? await captured.text() : ''
})

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

// The notes gate on book two: the editor is the same person, so the pen name
// and the density come back off the disk exactly as the banked look does.
await advanceTo('Write the notes')
const penNameOnBookTwo = await page
  .locator('.q')
  .filter({ hasText: 'name do the notes' })
  .locator('input')
  .inputValue()

// Declining has to be free and instant — nobody should pay for a pass to say
// they want a plain reprint. Reaching the design gate with no cost screen in
// between is the proof.
await page.locator('.opt', { hasText: 'No, print it plain' }).click()
await page.locator('.opt', { hasText: 'No introduction' }).click()
await shot('05f0-annotate-declined')

// A book worth mining and not worth annotating — the standalone harvest, which
// pays to read the book itself and so must still quote a price.
await page.locator('.opt', { hasText: 'A useful amount' }).click()
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(600)
const harvestOnlyCost = await page
  .locator('.q')
  .filter({ hasText: 'Ready to write the notes' })
  .innerText()
  .catch(() => '')
await page.locator('button.primary', { hasText: 'Start' }).click()
await page.waitForFunction(
  () => document.querySelector('.rail li.active .label')?.textContent?.includes('Design'),
  undefined,
  { timeout: 120000 }
)
const harvestedWithoutNotes = true
const chargedForDeclining = 0
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

// A run that stopped partway is now a real state, and confusing it with a
// finished one costs money in one direction and prints a truncated book in the
// other. Seeded here and driven through the actual gate.
console.log('5b2. a half-read book offers to carry on, not to be reused')
await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const project = await import(`/@fs${repo}/src/core/project/index.ts`)
    await runStore.deleteRun(key)
    await runStore.saveRun(
      project.createSavedRun({
        key,
        fileName: 'test-book.pdf',
        pageCount: 4,
        complete: false,
        transcriptions: Array.from({ length: 4 }, (_, i) => ({
          pageIndex: i,
          role: 'body',
          blocks: [{ kind: 'paragraph', text: `Half-read page ${i + 1}.` }],
          uncertain: [],
          furniture: {}
        })),
        failures: [],
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 },
        modelId: 'claude-opus-5',
        identityAnswers: { orthography: 'preserve' }
      })
    )
  },
  [REPO, savedKey]
)
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
await page.locator('button.primary', { hasText: 'Looks right' }).click()
await page.waitForSelector('.q', { timeout: 20000 })
// Space is asked beside money, once per device, with this browser's real quota
// measured rather than guessed. Chromium reports one, so this is the figure a
// user would actually be shown.
const storageQ = page.locator('.q').filter({ hasText: 'Keep this book’s scan' })
const storageAsked = await storageQ.count()
const storageHelp = storageAsked ? await storageQ.locator('.help').first().innerText() : ''

const partialPrompt = await page
  .locator('.q .prompt')
  .filter({ hasText: 'stopped partway' })
  .count()
const carryOn = await page.locator('.opt').filter({ hasText: 'Carry on from page 5' }).count()
// Carrying on spends money, so the cost questions must still be asked — the
// finished-run path returns before them and this one must not.
const stillAsksModel = await page.locator('.q').filter({ hasText: 'read the pages' }).count()
await shot('08b2-partial-run-offered')
if (partialPrompt !== 1) throw new Error('A half-read book was not offered as one')
if (carryOn !== 1) throw new Error('No option to carry on from where it stopped')
if (stillAsksModel !== 1) throw new Error('Resuming skipped the cost approval')
console.log('  → offered "Carry on from page 5", and still asked what it would cost')
if (storageAsked !== 1) throw new Error('The storage question was not asked')
if (!/free for the app/.test(storageHelp)) throw new Error('Storage was asked without figures')
if (!/transcription is saved either way/.test(storageHelp)) {
  throw new Error('The storage question does not say the paid work is kept regardless')
}
console.log(
  `  → storage asked with measured figures: ${storageHelp.replace(/\s+/g, ' ').slice(0, 96)}…`
)

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

// --- settings ---------------------------------------------------------------
// The other half of "design by interview": the detailed controls, the things
// that could not be undone, and what is taking up room.
console.log('12. settings')
await page.evaluate(async (repo) => {
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
  const style = await import(`/@fs${repo}/src/core/style/index.ts`)
  await runStore.saveProfile(
    style.newSavedProfile({
      name: 'A banked look',
      style: style.defaultStyleProfile(),
      imprint: { imprint: 'Blackthorn Press' }
    })
  )
}, REPO)
await page.goto(`${URL_BASE}#settings`, { waitUntil: 'networkidle' })
await page.waitForSelector('.settings', { timeout: 20000 })
await page.waitForTimeout(800)
await shot('11-settings')

const sections = await page.locator('.settings h2').allInnerTexts()
const storageLine = await page
  .locator('.settings .help')
  .filter({ hasText: 'this browser allows' })
  .first()
  .innerText()
  .catch(() => '')

// The API key can be changed and removed — impossible until now, since the
// gate only ever asked when none was stored. Seeded, then actually removed,
// because a button that exists is not the same as one that works.
await page.evaluate(() => localStorage.setItem('pdbf.apiKey', 'sk-ant-secret-0000-abcd'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.settings', { timeout: 20000 })
const maskedKey = await page.locator('.settings code').first().innerText()
if (maskedKey.includes('secret')) throw new Error('The settings screen printed the key in full')
await page.locator('button', { hasText: 'Remove key' }).click()
await page.waitForTimeout(300)
const keyGone = await page.evaluate(() => localStorage.getItem('pdbf.apiKey') === null)
if (!keyGone) throw new Error('Removing the key left it in storage')
const canRemoveKey = true

// Open the style editor and check the fields no question ever reached.
await page.locator('.settings .notes button', { hasText: 'Edit' }).first().click()
await page.waitForTimeout(400)
const styleFields = await page.locator('.q .prompt').allInnerTexts()
await shot('11b-settings-style')

// Change the gutter — reachable from nothing until now — and save it.
await page
  .locator('.q')
  .filter({ hasText: 'Extra gutter' })
  .locator('label', { hasText: '0.25 in' })
  .click()
await page.locator('button.primary', { hasText: 'Save this look' }).click()
await page.waitForTimeout(600)
const savedGutter = await page.evaluate(() => {
  const raw = localStorage.getItem('pdbf.defaultLook')
  return raw ? JSON.parse(raw).gutter : null
})
if (savedGutter !== 0.25) throw new Error(`The edited gutter did not persist (got ${savedGutter})`)
console.log(`  → sections: ${sections.join(' · ')}`)
console.log(`  → ${storageLine.replace(/\s+/g, ' ')}`)
console.log(`  → key shown as ${maskedKey} and removable: ${canRemoveKey && keyGone}`)
console.log(
  `  → style editor offers ${styleFields.length} controls, gutter saved as ${savedGutter}`
)
for (const want of ['Extra gutter for binding', 'Page numbers', 'Print a half-title leaf?']) {
  if (!styleFields.some((f) => f.includes(want))) {
    throw new Error(`The style editor is missing "${want}"`)
  }
}

console.log('\nresult:')
console.log(`  term rows: ${rows}`)
console.log(`  word crops rendered: ${crops}`)
console.log(`  design summary: ${after}`)
console.log(`  summary responds to answers: ${before !== after}`)
console.log(`  saved run offered: ${offered === 1}`)
console.log(`  no key asked for when reusing it: ${askedForKey === 0}`)
console.log(`  resumed to: ${resumedTo} (cost prompts: ${chargedAgain})`)
console.log(
  `  the gate shows scan and text: ${gateScans > 0} / ${gateText.replace(/\s+/g, ' ').slice(0, 48)}…`
)
console.log(`  a verdict is written to storage as it is made: ${verdictSaved}`)
console.log(`  illustration candidates: ${foundIllustrations} (crops shown: ${illustrationCrops})`)
console.log(`  advanced past the structure gate to: ${afterStructure}`)
console.log(`  proof sheet: ${proofBoxes} editable block(s), ${proofScan} scan(s) beside them`)
console.log(`  after correcting one: ${correctedCount.replace(/\s+/g, ' ')}`)
console.log(`  editor's notes attached: ${annotations}`)
console.log(`  pictures the editor added: ${suppliedPictures} (previewed: ${suppliedPreview})`)
console.log(`  divisions written: ${sectionsWritten}`)
console.log(`  the annotate gate: ${annotateStep} (asks the pen name: ${asksPenName === 1})`)
console.log(`  quoted a price first: ${/\$/.test(notesCost)}`)
console.log(
  `  notes proposed: ${proposedNotes} (passages shown: ${notePassages}, claims marked: ${claimsMarked}, introduction drafted: ${introDrafted === 1})`
)
console.log(`  voice banked for the next book: ${/Etsu T. Dhent/.test(bankedVoice)}`)
console.log(
  `  book two's notes gate arrives as: "${penNameOnBookTwo}" (charged to decline: ${chargedForDeclining > 0})`
)
console.log(`  the gate asks about the fact bank: ${asksHarvest === 1}`)
console.log(
  `  any leaf of the finished book is reachable: ${browserPages.replace(/\s+/g, ' ')} → ${leafedTo} (rasterized: ${leafRendered})`
)
console.log(`  the bank is offered as files: ${bankDownloads} — ${bankPanel.split('\n')[0] ?? ''}`)
console.log(
  `  and the file carries footing and provenance: ${/stated by the book/.test(bankMarkdown)} / ${/scan p\./.test(bankMarkdown)}`
)
console.log(
  `  a book with no notes still harvests: ${harvestedWithoutNotes} (priced: ${/\$/.test(harvestOnlyCost)})`
)
console.log(`  the table is edited as rows: ${tableBoxes} (typed as: ${tableRetyped})`)
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
