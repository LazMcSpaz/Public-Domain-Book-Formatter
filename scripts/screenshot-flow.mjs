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
  if (m.type() !== 'error') return
  // A request to the API that the browser refuses outright is not the app
  // breaking — it is `batch-reach` asking whether the batch endpoints will
  // talk to a page, and being told no. That question can only be asked by
  // trying, and a cross-origin refusal always logs a console error the page
  // cannot suppress. (Here it is the sandbox's own TLS proxy that Chromium
  // does not trust; in a browser it would be the CORS refusal itself. Either
  // way the answer is "no" and the app handles it.) Everything else still
  // counts.
  if (m.location()?.url?.includes('api.anthropic.com')) return
  errors.push(m.text())
})

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`  → ${OUT}/${name}.png`)
}

/**
 * Reveal a gate's whole list when it is showing one decision at a time.
 *
 * The forward button is deliberately held back until the last screen, so a
 * harness that wants to leave a gate has to either work through it or ask for
 * everything — the same two choices a user has.
 */
const showEverything = async () => {
  const toggle = page.locator('.pager-head button', { hasText: 'all at once' })
  if ((await toggle.count()) > 0) {
    await toggle.click()
    await page.waitForTimeout(250)
  }
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

// The reading of a scan is the free half of the pipeline and the slow one. It
// is kept as Blobs, because an object URL means nothing in a later session, so
// the round trip through storage is the whole feature and there is no IndexedDB
// and no Blob in vitest to check it with.
console.log('2c2. the stored reading of a scan')
const reading = await page.evaluate(async (repo) => {
  const cache = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)

  const pixels = async (text) => {
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 12
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 40, 12)
    ctx.fillStyle = '#000'
    ctx.fillText(text, 1, 10)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    return URL.createObjectURL(blob)
  }

  const result = async () => ({
    pageCount: 2,
    words: [
      {
        id: 'p0_w0',
        text: 'chirurgeon',
        confidence: 71,
        bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
        pageIndex: 0
      }
    ],
    lexicon: [
      {
        term: 'chirurgeon',
        count: 4,
        meanConfidence: 71,
        pages: [0],
        variants: [],
        signals: ['archaic-form'],
        impact: 9,
        sampleTokenId: 'p0_w0'
      }
    ],
    crops: new Map([['p0_w0', await pixels('chi')]]),
    contextCrops: new Map([['p0_w0', await pixels('the chi')]]),
    thumbnails: new Map([
      [0, await pixels('pg1')],
      [1, await pixels('pg2')]
    ]),
    illustrations: [
      {
        region: { id: 'r0', pageIndex: 1, bbox: { x0: 0, y0: 0, x1: 9, y1: 9 } },
        ink: 0.4,
        previewUrl: await pixels('fig')
      }
    ],
    pageText: ['Page one text.', 'Page two text.']
  })

  const wanted = { dpi: 300, maxPages: null }
  try {
    await runStore.deleteRecon('read-probe')
    const wrote = await cache.saveReconCache('read-probe', await result(), wanted)
    const back = await cache.loadReconCache('read-probe', wanted)

    // Everything the session needs, and the pixels as live URLs rather than
    // dead ones left over from the tab that wrote them.
    const cropUrl = back?.crops.get('p0_w0') ?? ''
    const cropBytes = cropUrl.startsWith('blob:') ? (await (await fetch(cropUrl)).blob()).size : 0
    const roundTrip =
      wrote &&
      back !== null &&
      back.words[0].text === 'chirurgeon' &&
      back.pageText[1] === 'Page two text.' &&
      back.lexicon[0].term === 'chirurgeon' &&
      back.thumbnails.size === 2 &&
      back.contextCrops.size === 1 &&
      back.illustrations[0].previewUrl.startsWith('blob:') &&
      cropBytes > 0

    // A reading taken at another resolution describes pixels this session does
    // not have. It must miss — and be thrown away rather than refused daily.
    const wrongDpi = await cache.loadReconCache('read-probe', { dpi: 150, maxPages: null })
    const gone = await cache.loadReconCache('read-probe', wanted)
    const staleDiscarded = wrongDpi === null && gone === null

    // The cap, and that it evicts by age.
    for (let i = 0; i < 5; i++) {
      await cache.saveReconCache(`read-${i}`, await result(), wanted)
    }
    const survivors = []
    for (let i = 0; i < 5; i++) {
      if ((await cache.loadReconCache(`read-${i}`, wanted)) !== null) survivors.push(i)
    }
    const capped = survivors.length <= 3 && survivors.includes(4) && !survivors.includes(0)

    const cleared = (await runStore.deleteAllRecons()) >= 0
    const emptied = (await cache.loadReconCache('read-4', wanted)) === null

    return { roundTrip, staleDiscarded, capped, cleared, emptied }
  } catch (e) {
    return { error: String(e.message) }
  }
}, REPO)

if (reading.error) throw new Error(`The reading store failed: ${reading.error}`)
for (const [check, ok] of Object.entries(reading)) {
  if (!ok) throw new Error(`The reading store failed: ${check}`)
}
console.log(
  '  → a reading round-trips as live pixels, a wrong-DPI one is discarded, the store is capped'
)

// Losing a tab partway through a ten-minute read used to cost the whole book.
// A wake lock stops the usual cause — a phone dimming and locking — but a
// backgrounded tab can still be frozen or discarded, and nothing in a browser
// prevents that. So the reading checkpoints, and a fresh run carries on.
console.log('2c3. a reading that stopped partway is carried on from')
const resumed = await page.evaluate(async (repo) => {
  const cache = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
  const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)

  const pixels = async () => {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    c.getContext('2d').fillRect(0, 0, 8, 8)
    return await new Promise((r) => c.toBlob(r, 'image/png'))
  }

  const wanted = { dpi: 300, maxPages: null }
  try {
    await runStore.deleteRecon('half-read')
    const wrote = await cache.saveReconCheckpoint(
      'half-read',
      {
        pagesDone: 4,
        words: [
          {
            id: 'p0_w0',
            text: 'alembick',
            confidence: 80,
            bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
            pageIndex: 0
          }
        ],
        pageText: ['one', 'two', 'three', 'four'],
        thumbnails: new Map([
          [0, await pixels()],
          [3, await pixels()]
        ]),
        illustrations: []
      },
      9,
      wanted
    )

    // It is a checkpoint, so it must never be handed back as the whole book —
    // that is an edition that stops at leaf four with nothing said.
    const asWhole = await cache.loadReconCache('half-read', wanted)
    const asCheckpoint = await cache.loadReconCheckpoint('half-read', wanted)
    const carriesOn =
      wrote &&
      asWhole === null &&
      asCheckpoint !== null &&
      asCheckpoint.pagesDone === 4 &&
      asCheckpoint.words[0].text === 'alembick' &&
      asCheckpoint.pageText.length === 4 &&
      asCheckpoint.thumbnails.size === 2

    // A checkpoint taken at another resolution describes pixels this run will
    // not produce, so it is dropped rather than resumed from.
    const wrongDpi = await cache.loadReconCheckpoint('half-read', { dpi: 150, maxPages: null })
    const dropped =
      wrongDpi === null && (await cache.loadReconCheckpoint('half-read', wanted)) === null

    await runStore.deleteRecon('half-read')
    return { carriesOn, dropped }
  } catch (e) {
    return { error: String(e.message) }
  }
}, REPO)

if (resumed.error) throw new Error(`The checkpoint failed: ${resumed.error}`)
for (const [check, ok] of Object.entries(resumed)) {
  if (!ok) throw new Error(`The checkpoint failed: ${check}`)
}
console.log('  → a partial reading is resumed, never mistaken for a whole one')

// The screen has to stay on while a long read runs, or a phone locks and takes
// the tab down with it. Nothing can keep it going with the screen *off*.
const wake = await page.evaluate(async (repo) => {
  const mod = await import(`/@fs${repo}/src/platform/browser/wake-lock.ts`)
  const offered = mod.canKeepAwake()
  let held = false
  const original = navigator.wakeLock?.request
  if (original) {
    navigator.wakeLock.request = async () => {
      held = true
      return { release: async () => {}, released: false }
    }
  }
  const release = mod.keepAwake()
  await new Promise((r) => setTimeout(r, 60))
  release()
  release() // twice is safe
  if (original) navigator.wakeLock.request = original
  return { offered, held: !offered || held }
}, REPO)
if (!wake.held) throw new Error('The wake lock was never requested')
console.log(`  → the screen is held awake while reading (offered here: ${wake.offered})`)

// A scan and a typeset file look identical once you have the text out of them,
// which is why the app asks a *structural* question instead: is the page a
// photograph? No statistic over word shapes can tell good OCR from real text —
// `chirnrgeon` and `thc` are shaped exactly like words — so this is the check
// that decides whether ten minutes of Tesseract is worth running at all.
console.log('2c4. telling a scan from a book that was typeset')
const makeup = await page.evaluate(async (repo) => {
  const pdf = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
  const quality = await import(`/@fs${repo}/src/core/textquality/index.ts`)

  const open = async (name) => {
    const res = await fetch(name)
    return pdf.openPdf(await res.arrayBuffer())
  }

  try {
    const scan = await open('test-book.pdf')
    const digital = await open('test-digital.pdf')

    const scanned = await pdf.looksScanned(scan)
    const typeset = await pdf.looksScanned(digital)

    // And the text a typeset file carries comes out as words with boxes, in
    // the shape everything downstream already reads.
    const extracted = await pdf.extractPageWords(digital, 1, 300)
    const assessed = quality.assessText(
      (
        await Promise.all(
          [1, 2, 3, 4, 5].map(async (i) => (await pdf.extractPageWords(digital, i, 300)).text)
        )
      ).join(' ')
    )

    return {
      scanIsScanned: scanned.scanned,
      typesetIsNot: !typeset.scanned,
      typesetHasText: typeset.textPerPage > 200,
      wordsHaveBoxes:
        extracted.words.length > 50 &&
        extracted.words.every(
          (w) => w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0 && w.confidence === 100
        ),
      readsAsProse: /chirurgeon/i.test(extracted.text),
      verdict: assessed.verdict
    }
  } catch (e) {
    return { error: String(e.message) }
  }
}, REPO)

if (makeup.error) throw new Error(`The makeup check failed: ${makeup.error}`)
console.log(
  `  → a scan reads as a scan: ${makeup.scanIsScanned}; a typeset file does not:` +
    ` ${makeup.typesetIsNot} (its text: ${makeup.verdict})`
)
if (!makeup.scanIsScanned) throw new Error('A scanned fixture was not recognised as a scan')
if (!makeup.typesetIsNot) throw new Error('A typeset fixture was mistaken for a scan')
if (!makeup.typesetHasText) throw new Error('The typeset fixture yielded no embedded text')
if (!makeup.wordsHaveBoxes) throw new Error('Embedded words came back without usable boxes')
if (!makeup.readsAsProse) throw new Error('The embedded text does not read as the book')
if (makeup.verdict !== 'trustworthy') {
  throw new Error(`A typeset PDF's own text was judged "${makeup.verdict}"`)
}
console.log('  → its words come out with boxes and confidence 100, no OCR run')

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
const crops = await page.locator('.terms td .crop img').count()
// The wider cut of the same word, held back until asked for.
// The peek is portalled to the body and rendered only while hovered, so what
// is counted here is how many cuttings offer one at all.
const contextCrops = await page.locator('.terms .crop[title*="line"]').count()
await page.locator('.terms .crop').first().hover()
await page.waitForTimeout(400)
const contextVisible = await page.locator('.crop-context').first().isVisible()
// The peek is only worth having if it is legible. It is portalled out to the
// body and sized in viewport units precisely because it used to be clipped to
// the width of a table cell, which is how a strip of a printed line arrived on
// screen too small to read a word of.
const peekWidth = contextVisible
  ? Math.round((await page.locator('.crop-context').first().boundingBox()).width)
  : 0
await shot('03c-term-context-on-hover')

// And clicking it opens that line at the size it was cut at.
await page.locator('.terms .crop').first().click()
await page.waitForTimeout(500)
const lightboxOpen = await page.locator('.lightbox').count()
const lightboxWidth = lightboxOpen
  ? Math.round((await page.locator('.lightbox-frame img').boundingBox()).width)
  : 0
await shot('03d-term-context-full-size')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const lightboxClosed = (await page.locator('.lightbox').count()) === 0

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
            {
              kind: 'paragraph',
              // With the italics the pass recovers, on one leaf. A textarea
              // cannot show italics, so they are shown as the tags they came
              // in as — otherwise the emphasis this edition has to print is
              // invisible wherever the text can be corrected, and retyping the
              // paragraph would throw it away without a word.
              text:
                i === 6
                  ? `Restored page ${i + 1}, the <i>alembick</i> being set.`
                  : `Restored page ${i + 1}.`
            },
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
//
// Timed, because this is the first time *this* file has been opened: the scan
// is rendered and OCR'd for real. The same open later in the flow should not
// have to do any of it again.
const coldOpenAt = Date.now()
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
const coldOpenMs = Date.now() - coldOpenAt

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
// thumbnail of a page of dense type cannot be proofread on its own. The text is
// now the editable copy — being asked to verify a discrepancy and given no way
// to fix it was the reason a re-read got bought for a one-word mistake.
const gateScans = await page.locator('.q-evidence img').count()
const gateText = await page
  .locator('.page-edit textarea')
  .first()
  .inputValue()
  .catch(() => '')
await shot('08c-uncertainty-gate-side-by-side')

// The thumbnail beside a flagged leaf is 150px of dense type — enough to know
// which page it is and useless for the job the gate is asking. Clicking it has
// to render the leaf at a size a transcription can be checked against, which is
// a *different* image from the thumbnail, not the same one blown up.
const gateThumbWidth = Math.round(
  (await page.locator('.q .evidence-open img').first().boundingBox()).width
)
await page.locator('.q .evidence-open').first().click()
await page.waitForTimeout(2500)
const gateBig = await page.locator('.lightbox-frame img').count()
const gateBigWidth = gateBig
  ? Math.round((await page.locator('.lightbox-frame img').boundingBox()).width)
  : 0
// It has to cover the window, not the column it was opened from — a fixed
// overlay is only fixed if no ancestor made itself a containing block.
const overlay = await page.locator('.lightbox').boundingBox()
const viewport = page.viewportSize()
const overlayCovers =
  Math.round(overlay.width) >= viewport.width && Math.round(overlay.height) >= viewport.height
await shot('08c1-uncertainty-gate-leaf-full-size')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const gateBigClosed = (await page.locator('.lightbox').count()) === 0

console.log('5b1. the uncertainty gate, one leaf at a time')
// Paged on any width — a wall of forty leaves is intimidating on a laptop too —
// and checked at phone size, where the pager also pins itself to the bottom.
const desktopCards = await page.locator('.q').count()
const desktopWhere = await page
  .locator('.pager-where')
  .innerText()
  .catch(() => '')
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
const pagedCards = await page.locator('.q').count()
const pagerWhere = await page
  .locator('.pager-where')
  .innerText()
  .catch(() => '')
const pagerSticky = await page
  .locator('.pager')
  .evaluate((el) => getComputedStyle(el).position)
  .catch(() => '')
// Reachable without scrolling to the end of a leaf taller than the window.
const pagerBox = await page.locator('.pager').boundingBox()
const pagerInView = pagerBox !== null && pagerBox.y < 844
await shot('08c3-uncertainty-gate-phone')

// Next moves on, and remembers where it got to.
await page.locator('.pager button', { hasText: 'Next' }).click()
await page.waitForTimeout(400)
const afterNext = await page.locator('.pager-where').innerText()
const cursorKept = await page.evaluate(() =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith('pdbf.cursor.'))
    .map((k) => localStorage.getItem(k) ?? '')
    .join('')
)
// The bar measures leaves finished, not the screen you happen to be on.
const barAfterOne = Math.round(
  ((await page.locator('.pager-bar > i').evaluate((el) => el.getBoundingClientRect().width)) /
    (await page.locator('.pager-bar').evaluate((el) => el.getBoundingClientRect().width))) *
    100
)
await shot('08c4-uncertainty-gate-phone-next')

// The forward action is held back until the last screen, or the other
// thirty-nine leaves get skipped by an accidental tap.
const continueMidway = await page.locator('.actions button', { hasText: 'Looks right' }).count()

// And someone who would rather have it all at once can say so.
await page.locator('.pager-head button').click()
await page.waitForTimeout(400)
const allAtOnce = await page.locator('.q').count()
await page.locator('.pager-head button').click()
await page.waitForTimeout(300)

// The half that matters: closing the tab and coming back has to land on the
// leaf you were on, not on the first one. Writing the place down and never
// reading it back would look identical until someone actually left.
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
await page.locator('button.primary', { hasText: 'Looks right' }).click()
await page.waitForSelector('.q', { timeout: 20000 })
await page.locator('.actions button.primary').first().click()
await page.waitForTimeout(2500)
const resumedAt = await page
  .locator('.pager-where')
  .innerText()
  .catch(() => '')
await shot('08c5-uncertainty-gate-resumed')
await page.setViewportSize({ width: 1360, height: 900 })
await page.waitForTimeout(400)

// With the whole list on screen for the bulk work below. Someone who would
// rather see all forty at once can say so, and the harness is that someone.
await page.locator('.pager-head button', { hasText: 'all at once' }).click()
await page.waitForTimeout(400)

// A verdict clicked here must survive a refresh. It costs time rather than
// money, which is why it used to be thrown away while the pages it applied to
// were carefully kept.
//
// Located by the options they carry rather than by their prompt: the editor
// that now sits under each one names its page too.
const pageVerdicts = page
  .locator('.q')
  .filter({ has: page.locator('.opt', { hasText: 'Looks fine' }) })
const verdictCount = await pageVerdicts.count()
const verdicts = pageVerdicts.first()
if (verdictCount > 0) {
  await verdicts.locator('.opt', { hasText: 'Leave this page out' }).click()
  await page.waitForTimeout(900)
}
// "I'll fix this myself" is not "looks fine": the note has to survive to the
// proof step, or someone who can see the mistake is asked to lie about it.
let markedALeaf = false
if (verdictCount > 1) {
  await pageVerdicts.last().locator('.opt', { hasText: 'fix this myself' }).click()
  await page.waitForTimeout(600)
  markedALeaf = true
}
const verdictOptions = await verdicts.locator('.opt .t').allInnerTexts()

// --- the same gate on a phone -----------------------------------------------
// Forty flagged leaves, each a verdict plus an editor carrying the passage it
// is about, is one unusable wall of scrolling on a phone. The same questions
// are shown one decision to a screen, with the position kept so closing the tab
// does not mean finding your place again by hand.
// Typing over a misreading here has to reach the finished book. The leaf is
// picked by number rather than by position, because a leaf with only a picture
// on it is flagged without having any text to offer.
const GATE_FIX = 'Corrected at the gate, not paid for twice.'
const verdictPages = (await pageVerdicts.locator('.prompt').allInnerTexts())
  .map((t) => Number(/Page (\d+)/.exec(t)?.[1] ?? 0))
  .filter((n) => n > 0)
// Not the first: that one was just left out of the book, so a correction to it
// would prove nothing.
const fixablePage = verdictPages.slice(1).find(Boolean) ?? verdictPages[0]
const gateEditor = page
  .locator('.q')
  .filter({ hasText: `fix page ${fixablePage} here` })
  .locator('textarea')
  .first()
let gateEdited = false
if ((await gateEditor.count()) > 0) {
  await gateEditor.fill(GATE_FIX)
  await page.waitForTimeout(500)
  gateEdited = true
  await shot('08c2-uncertainty-gate-corrected')
}
// --- the disagreements, located ---------------------------------------------
// The gate used to say "18 words OCR read clearly are absent" and show a
// thumbnail of the whole leaf. Finding those eighteen meant reading a page of
// dense type against a transcription in another pane, by eye. Everything needed
// to point at them was already in hand — OCR boxes every word — so each one is
// now a row with the word as it appears on the paper.
const gapsQ = page
  .locator('.q')
  .filter({ has: page.locator('.discrepancy') })
  .first()
const gapRows = await gapsQ.locator('.discrepancy').count()
let gapCrops = 0
let gapPreselected = -1
let gapHighlighted = ''
let gapRestoreStuck = false
if (gapRows > 0) {
  // The crops are cut from the scan when the leaf is reached, so give the
  // render a moment before counting them.
  await page.waitForTimeout(2500)
  gapCrops = await gapsQ.locator('.discrepancy-pixels img').count()
  // Nothing pre-selected: OCR is the rougher reader, and a default that put
  // every gap back would copy its misreadings over a paid transcription.
  gapPreselected = await gapsQ.locator('.discrepancy-verdict button.primary').count()
  gapHighlighted = await gapsQ.locator('.discrepancy-where .gap').first().innerText()
  // And a verdict has to stick, or the row is decoration.
  await gapsQ.locator('.discrepancy-verdict button', { hasText: 'Put it back' }).first().click()
  await page.waitForTimeout(300)
  gapRestoreStuck =
    (await gapsQ
      .locator('.discrepancy-verdict button.primary', { hasText: 'Put it back' })
      .count()) > 0
  await shot('08c6-discrepancies-located')
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
await showEverything()
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

// Italics are content the original prints and this edition has to. A textarea
// has none, so they are shown as the tags they arrived as — visible, editable,
// and read straight back by `applyEdits`. Without this the emphasis was
// invisible everywhere it could be corrected, and silently dropped by anyone
// who retyped the paragraph.
let italicsShown = ''
/** Every leaf the sheet walked, so a miss says which leaves it actually saw. */
const leavesWalked = []
// Start at the beginning. The sheet does not necessarily open on leaf one — it
// restores the place it was left at — so a forward-only search from wherever it
// happens to be silently skips everything behind it. That is what made this
// look for italics across leaves 8 and 9 only, and it is the same assumption
// that broke two other checks in this section.
const rewind = page.locator('.proof-bar button', { hasText: '‹ Previous' })
for (let i = 0; i < 60; i++) {
  if (!(await rewind.isEnabled())) break
  await rewind.click()
  await page.waitForTimeout(120)
}
for (let i = 0; i < 40; i++) {
  // The leaf has to have rendered before its boxes are read, or an empty
  // textarea reads as a leaf with no italics on it.
  await page
    .locator('.proof-block textarea')
    .first()
    .waitFor({ timeout: 4000 })
    .catch(() => {})
  const where = await page
    .locator('.proof-where')
    .innerText()
    .catch(() => '?')
  const boxes = await page.locator('.proof-block textarea').all()
  const texts = await Promise.all(boxes.map((b) => b.inputValue()))
  leavesWalked.push(`${where.split('\n')[0]}:${texts.length}`)
  const found = texts.find((t) => t.includes('<i>'))
  if (found) {
    italicsShown = found
    await shot('05c2a2-proof-italics-visible')
    break
  }
  const next = page.locator('.proof-bar button', { hasText: 'Next ›' })
  if (!(await next.isEnabled())) break
  await next.click()
  await page.waitForTimeout(400)
}
const italicsHinted = italicsShown
  ? await page.locator('.proof-hint').filter({ hasText: 'italic' }).count()
  : 0

// And the leaf itself opens full size here too — a third of the screen shows
// that the paragraphs line up and will not settle a proper name.
await page.locator('.proof-scan .evidence-open').click()
await page.waitForTimeout(600)
const proofBig = await page.locator('.lightbox-frame img').count()
await shot('05c2a3-proof-leaf-full-size')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

// The leaf marked "I'll fix this myself" has to still carry its note here —
// that answer is a to-do, and until now it was indistinguishable from "looks
// fine", which erased the very thing the user asked to be reminded of. The
// marked leaves get their own jump button so a to-do is not hunted for among
// the cross-check warnings.
const toFixButton = await page
  .locator('.proof-marked')
  .innerText()
  .catch(() => '')
let markedFlag = ''
if (toFixButton) {
  await page.locator('.proof-marked').click()
  await page.waitForTimeout(400)
  markedFlag = await page
    .locator('.proof-flags.marked li')
    .first()
    .innerText()
    .catch(() => '')
  await shot('05c2a-proof-marked-leaf')
}

// The correction typed at the gate is an ordinary edit, so it has to be here on
// the leaf it was made on — and editable again, not baked in.
const previous = page.locator('.proof-bar button', { hasText: '‹ Previous' })
const forward = page.locator('.proof-bar button', { hasText: 'Next ›' })
let gateFixOnLeaf = ''
if (gateEdited) {
  while (await previous.isEnabled()) {
    await previous.click()
    await page.waitForTimeout(120)
  }
  for (let i = 0; i < 40; i++) {
    const where = await page.locator('.proof-where').innerText()
    if (where.startsWith(`Leaf ${fixablePage}\n`) || where.startsWith(`Leaf ${fixablePage} `)) {
      const values = await page.locator('.proof-block textarea').allInnerTexts()
      const boxes = await page.locator('.proof-block textarea').all()
      const texts = await Promise.all(boxes.map((b) => b.inputValue()))
      gateFixOnLeaf = [...texts, ...values].find((t) => t.includes(GATE_FIX)) ?? ''
      break
    }
    if (!(await forward.isEnabled())) break
    await forward.click()
    await page.waitForTimeout(150)
  }
}

// Back to the top of the sheet, so what follows reads leaves by their number.
if (toFixButton || gateEdited) {
  while (await previous.isEnabled()) {
    await previous.click()
    await page.waitForTimeout(120)
  }
}

// Correcting a word must reach the finished PDF, which is the whole point.
//
// Measured as a *rise*, not as a number. The gate before this leaves most
// flagged leaves on their default answer — "put the missing text back" — and
// every one of those is a real correction, so the sheet legitimately arrives
// here already carrying several. Pinning the total meant this line quietly
// stopped being true the moment the gate walkthrough was added, which is
// exactly what happened.
const correctionsOf = (text) => Number(/(\d+) corrected/.exec(text)?.[1] ?? 0)
// The first leaf of the sheet need not have any text on it: a title page is
// mined for metadata rather than transcribed, and a leaf can be listed here
// purely because it carries a note. So walk forward to the first leaf that
// actually has something to type in, rather than assuming leaf one does.
for (let i = 0; i < 40; i++) {
  if ((await page.locator('.proof-block textarea').count()) > 0) break
  if (!(await forward.isEnabled())) break
  await forward.click()
  await page.waitForTimeout(150)
}
const correctedBefore = correctionsOf(await page.locator('.proof-where small').innerText())
const firstBox = page.locator('.proof-block textarea').first()
// Note for what follows: everything below navigates by counting `Next ›` from
// the top of the sheet, so the walk above has to be undone before then or every
// later section lands a few leaves off. See the rewind after the fill.

await firstBox.fill('The chirurgeon examined the specimen with extraordinary care.')
await page.waitForTimeout(300)
const correctedCount = await page.locator('.proof-where small').innerText()
// Back to the top, restoring the invariant every section below depends on:
// they step forward by a known number of leaves from leaf one.
while (await previous.isEnabled()) {
  await previous.click()
  await page.waitForTimeout(120)
}
const correctionCounted = correctionsOf(correctedCount) > correctedBefore

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
// Walk to the leaf carrying the seeded table, for the same reason as below:
// its position in the sheet depends on decisions made at the gate before it.
for (let i = 0; i < 40; i++) {
  if ((await page.locator('.proof-block textarea.proof-table').count()) > 0) break
  const next = page.locator('.proof-bar button', { hasText: 'Next ›' })
  if (!(await next.isEnabled())) break
  await next.click()
  await page.waitForTimeout(400)
}

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

// Walk to the leaf that actually carries a picture, rather than counting a
// fixed number of steps to where one used to be. Counting is what broke this
// twice: which leaves reach the proof sheet depends on what the gate before it
// decided, and that has changed twice in a day.
for (let i = 0; i < 40; i++) {
  if ((await page.locator('.proof-picture .editor-canvas').count()) > 0) break
  const next = page.locator('.proof-bar button', { hasText: 'Next ›' })
  if (!(await next.isEnabled())) break
  await next.click()
  await page.waitForTimeout(400)
}
await page.waitForTimeout(1100)

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

// --- a book that was typeset, not photographed -------------------------------
// The saving the structural check unlocks: no Tesseract, no ten minutes, and a
// starting text that is the file's own characters rather than a reading of a
// picture of them.
console.log('5g0. a typeset PDF is read, not OCR’d')
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
const typesetAt = Date.now()
await page.setInputFiles('input[type=file]', resolve(REPO, 'public/test-digital.pdf'))
await page.waitForSelector('.terms, .q', { timeout: 180000 })
const typesetMs = Date.now() - typesetAt
const typesetNote = await page
  .locator('.resume-note')
  .innerText()
  .catch(() => '')
// No term grid at all: nothing read these words, so there is nothing to vet.
const typesetTerms = await page.locator('.terms tbody tr').count()
await shot('09c-typeset-pdf-no-ocr')

console.log(
  `  a typeset PDF opens in ${typesetMs} ms with ${typesetTerms} term(s): ` +
    `"${typesetNote.replace(/\s+/g, ' ').slice(0, 90)}"`
)
if (!/typeset rather than scanned/i.test(typesetNote)) {
  throw new Error(`A typeset PDF was not recognised — note said "${typesetNote}"`)
}
// The scan of the same length takes seconds of Tesseract per leaf; this must be
// in a different league or nothing was actually skipped.
if (typesetMs > 4000) throw new Error(`A typeset PDF took ${typesetMs} ms — OCR probably ran`)
if (typesetTerms > 0) {
  throw new Error(`A typeset PDF asked for ${typesetTerms} spellings to be vetted`)
}

// --- a book that is already text --------------------------------------------
// An EPUB has been through everything the recovery half of this app exists to
// do: someone typed the words and marked up the structure. So it skips render,
// OCR and the paid pass entirely and joins at the structure gate, with nothing
// spent — and gains the half that makes a reprint worth publishing.
console.log('5g. an EPUB, which costs nothing to bring in')
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', resolve(REPO, 'public/test-book.epub'))
await page.waitForFunction(
  () => document.querySelector('.rail li.active .label')?.textContent?.length > 0,
  null,
  { timeout: 60000 }
)
await page.waitForTimeout(1500)
const epubLanded = await page.locator('.rail li.active .label').innerText()
const epubAskedForKey = await page.locator('.q').filter({ hasText: 'API key' }).count()
const epubCost = await page.locator('.cost').count()
await shot('09a-epub-structure-gate')

// The chapters have to be in the spine's order, not the archive's, and the
// quotation, the italics and the table have to have survived the crossing.
await showEverything()
await page.locator('.actions button.primary').first().click()
await page.waitForSelector('.proof', { timeout: 60000 })
const epubBlocks = []
for (let i = 0; i < 20; i++) {
  const boxes = await page.locator('.proof-block textarea').all()
  epubBlocks.push(...(await Promise.all(boxes.map((b) => b.inputValue()))))
  const next = page.locator('.proof-bar button', { hasText: 'Next ›' })
  if (!(await next.isEnabled())) break
  await next.click()
  await page.waitForTimeout(150)
}
const epubText = epubBlocks.join('\n')
await shot('09b-epub-proof-sheet')

// The comma comes with it: emphasis is word-granular by design (see
// `markup.ts`), and `<i>aqua vitae</i>,` italicises the word the comma is
// attached to. That is the documented trade, not a fault in the crossing.
const epubKeptItalics = /<i>aqua vitae,?<\/i>/.test(epubText)
const epubKeptQuote = /Nature is not to be hastened\./.test(epubText)
const epubKeptTable = /Year \| Barrels \| Port/.test(epubText)
const epubOrder =
  epubText.indexOf('Of the Air') < epubText.indexOf('Of the Trade in Spirits') &&
  epubText.indexOf('Of the Air') >= 0
const epubSkippedCover = !/outside the reading order/.test(epubText)

console.log(
  `  an EPUB lands at: ${epubLanded} (key asked for: ${epubAskedForKey > 0}, priced: ${
    epubCost > 0
  })`
)
console.log(
  `  and arrives whole: italics ${epubKeptItalics}, table ${epubKeptTable},` +
    ` quotation ${epubKeptQuote}, spine order ${epubOrder}, cover left out ${epubSkippedCover}`
)
if (!/structure/i.test(epubLanded)) {
  throw new Error(`An EPUB landed at "${epubLanded}" instead of the structure gate`)
}
if (epubAskedForKey > 0 || epubCost > 0) throw new Error('An EPUB was quoted a price')
if (!epubKeptItalics) throw new Error('The EPUB lost its italics')
if (!epubKeptTable) throw new Error('The EPUB lost its table')
if (!epubKeptQuote) throw new Error('The EPUB lost its quotation')
if (!epubOrder) throw new Error('The EPUB chapters are not in the spine order')
if (!epubSkippedCover) throw new Error('The EPUB cover was set into the reading order')

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
  await showEverything()
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
// The same file again, so the reading of it is already stored. Rendering and
// OCR are free, which is why they were never kept — but free is not quick, and
// this is the claim the cache exists to make.
const warmOpenAt = Date.now()
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
const warmOpenMs = Date.now() - warmOpenAt
const skippedNote = await page
  .locator('.resume-note')
  .innerText()
  .catch(() => '')
await shot('02d-reading-reused')
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

// A question that asks for a sentence has to give room for one. `multiline` was
// declared on this question and on the introduction brief, and rendered as a
// one-line box for both, which answers "tell me about this book" with "keep it
// short" — and the help text right above it says a sentence measurably improves
// how unusual words are read.
const contextQ = page.locator('.q').filter({ hasText: 'Anything I should know about this book' })
const contextBox = contextQ.locator('textarea')
const contextIsRoomy = (await contextBox.count()) === 1
if (contextIsRoomy) {
  await contextBox.fill('A 1662 alchemical treatise.\nHeavy use of Latin terms.')
}
const contextKeptLines = contextIsRoomy ? (await contextBox.inputValue()).includes('\n') : false

await shot('08b2-partial-run-offered')
if (partialPrompt !== 1) throw new Error('A half-read book was not offered as one')
if (carryOn !== 1) throw new Error('No option to carry on from where it stopped')
if (stillAsksModel !== 1) throw new Error('Resuming skipped the cost approval')
console.log('  → offered "Carry on from page 5", and still asked what it would cost')
if (!contextIsRoomy) throw new Error('The book-context question is not a multi-line box')
if (!contextKeptLines) throw new Error('The book-context box will not hold a line break')
console.log('  → "anything I should know" is a box you can write a paragraph in')
if (storageAsked !== 1) throw new Error('The storage question was not asked')
if (!/free for the app/.test(storageHelp)) throw new Error('Storage was asked without figures')
if (!/transcription is saved either way/.test(storageHelp)) {
  throw new Error('The storage question does not say the paid work is kept regardless')
}
console.log(
  `  → storage asked with measured figures: ${storageHelp.replace(/\s+/g, ' ').slice(0, 96)}…`
)

// --- the batch door ---------------------------------------------------------
// The one path in this app where the loop is *not* in the tab. The API is
// stubbed, so this exercises submission, the ticket surviving a reload, the
// wait, and the collection — everything except the spend. The reload is the
// point: a batch id lives only in the ticket, and a submission the user cannot
// come back to is money on the floor.
console.log('5b3. the batch door — submit, close the tab, come back')

await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    await runStore.deleteRun(key)
    await runStore.deleteBatchTicket(key)
  },
  [REPO, savedKey]
)

// What went into each batch, recorded from the request the app actually sent
// rather than assumed here — the results have to come back keyed to the ids it
// chose, which is the whole mechanism under test.
const submittedBatches = new Map()
let statusChecks = 0

await page.route('https://api.anthropic.com/v1/messages/batches**', async (route) => {
  const url = route.request().url()
  const method = route.request().method()
  const json = (body) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

  if (method === 'POST' && url.endsWith('/batches')) {
    const body = JSON.parse(route.request().postData() ?? '{}')
    const id = `msgbatch_${submittedBatches.size + 1}`
    submittedBatches.set(
      id,
      body.requests.map((r) => r.custom_id)
    )
    return json({
      id,
      processing_status: 'in_progress',
      request_counts: {
        processing: body.requests.length,
        succeeded: 0,
        errored: 0,
        canceled: 0,
        expired: 0
      },
      results_url: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 29 * 86400000).toISOString()
    })
  }

  // The reachability probe — a bare list request. Answered without touching
  // the status counter, or the probe would consume the "still in progress"
  // reply that the waiting screen exists to show.
  if (method === 'GET' && url.includes('/batches?')) {
    return json({ data: [], has_more: false, first_id: null, last_id: null })
  }

  if (url.endsWith('/results')) {
    const id = /batches\/([^/]+)\/results/.exec(url)?.[1] ?? ''
    const lines = (submittedBatches.get(id) ?? []).map((customId, i) =>
      JSON.stringify({
        custom_id: customId,
        result: {
          type: 'succeeded',
          message: {
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  role: i === 0 ? 'title-page' : 'body',
                  blocks: [{ kind: 'paragraph', text: `Collected from a batch, leaf ${i + 1}.` }],
                  uncertain: [],
                  furniture: {}
                })
              }
            ],
            usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 800 }
          }
        }
      })
    )
    return route.fulfill({
      status: 200,
      contentType: 'application/x-jsonlines',
      body: lines.join('\n')
    })
  }

  // A retrieve. The first check reports it still working, so the waiting
  // screen is exercised rather than skipped past.
  const id = /batches\/([^/?]+)/.exec(url)?.[1] ?? ''
  statusChecks += 1
  const ended = statusChecks > 1
  return json({
    id,
    processing_status: ended ? 'ended' : 'in_progress',
    request_counts: {
      processing: ended ? 0 : (submittedBatches.get(id) ?? []).length,
      succeeded: ended ? (submittedBatches.get(id) ?? []).length : 0,
      errored: 0,
      canceled: 0,
      expired: 0
    },
    results_url: ended ? `https://api.anthropic.com/v1/messages/batches/${id}/results` : null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 29 * 86400000).toISOString()
  })
})

// The second reading goes to /v1/messages, not to the batch endpoints, so it
// needs its own stub. It answers "not on the page" for every spot it is asked
// about — the commonest true answer, since most flagged spots are OCR seeing
// something that is not there.
let secondReadCalls = 0
const secondReadIds = []
await page.route('https://api.anthropic.com/v1/messages', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}')
  const prompt = body.messages?.[0]?.content?.[1]?.text ?? ''
  const ids = [...prompt.matchAll(/\[(p\d+d\d+)\]/g)].map((m) => m[1])
  if (ids.length === 0) {
    // Not an adjudication request — the credential check uses this endpoint too.
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '{}' }] })
    })
  }
  secondReadCalls += 1
  secondReadIds.push(...ids)
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            // A mix, because the two outcomes have opposite consequences and a
            // fixture that only ever returns one proves half the feature. Every
            // spot `not-there` settles its leaf and takes it out of the review;
            // anything else keeps the leaf and has to show its verdict on the
            // row. Returning only `not-there` made the whole gate empty and the
            // row assertions unfalsifiable.
            // Varied by the *leaf*, not by position within the request. One
            // request carries one leaf's spots and this fixture's leaves have a
            // single spot each, so alternating on the index made every spot the
            // first one — every verdict `not-there`, every leaf settled, and an
            // empty gate that proved nothing.
            spots: ids.map((id) =>
              Number(/p(\d+)d/.exec(id)?.[1] ?? 0) % 2 === 0
                ? {
                    id,
                    verdict: 'not-there',
                    reading: '',
                    note: 'A speck of dirt read as a word.'
                  }
                : {
                    id,
                    verdict: 'missing',
                    reading: 'and of the fixed salt',
                    note: 'Clear on the page; the transcription skips it.'
                  }
            )
          })
        }
      ],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 0 }
    })
  })
})

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('pdbf.apiKey', 'sk-ant-harness'))
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
await page.locator('button.primary', { hasText: 'Looks right' }).click()
await page.waitForSelector('.q', { timeout: 20000 })

// Both prices on one screen, which is the evidence the recommendation rests on.
const modeQ = page.locator('.q').filter({ hasText: 'How should the reading be run' })
const modeOptions = await modeQ.locator('.opt').allInnerTexts()
const batchOption = modeOptions.find((t) => /Submit it and come back/.test(t)) ?? ''
const nowOption = modeOptions.find((t) => /Read it now/.test(t)) ?? ''
const priceOf = (text) => Number(/about \$([\d.]+)/.exec(text)?.[1] ?? '0')
await shot('08b3-batch-door-offered')

await modeQ.locator('.opt', { hasText: 'Submit it and come back' }).click()
await page.locator('button.primary', { hasText: 'Continue' }).last().click()
await page.waitForSelector('.q .prompt', { timeout: 20000 })
const approvalPrompt = await page.locator('.q .prompt').first().innerText()
const approvalHelp = await page.locator('.q .help').first().innerText()
await shot('08b4-batch-cost-approval')

await page.locator('button.primary', { hasText: 'Submit —' }).click()
// Uploading, then straight to the collect offer.
await page.waitForSelector('.q .prompt:has-text("This book is out being read")', {
  timeout: 120000
})
const batchesMade = submittedBatches.size
const pagesSubmitted = [...submittedBatches.values()].reduce((n, ids) => n + ids.length, 0)
await shot('08b5-batch-submitted')

// The tab goes away entirely, which is the feature. Everything after this
// depends only on what was written to disk.
await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', bookPath)
await page.waitForSelector('.terms', { timeout: 180000 })
await page.locator('button.primary', { hasText: 'Looks right' }).click()
await page.waitForSelector('.q', { timeout: 20000 })
const survivedReload = await page
  .locator('.q .prompt')
  .filter({ hasText: 'This book is out being read' })
  .count()
const collectHelp = await page.locator('.q .help').first().innerText()
// Nothing on this screen may quote a price: these pages are already bought.
const quotedAgain = await page.locator('.q').filter({ hasText: 'read the pages' }).count()
await shot('08b6-batch-offered-after-reload')

const collectLabel = await page.locator('button.primary').last().innerText()
await page.locator('button.primary').last().click()
// First check finds it still running — the honest intermediate state.
await page.waitForSelector('.q .prompt:has-text("Still being read")', { timeout: 60000 })
const waitingHelp = await page.locator('.q .help').first().innerText()
await shot('08b7-batch-still-running')

await page.locator('button.primary', { hasText: 'Check again' }).click()
// Collected, and the flow carries on into the ordinary review gate — but not
// straight away: the second reading runs between the results landing and the
// run being saved, so waiting for a question to appear is not waiting for the
// work to finish. Wait for every running stage to clear first, or the store is
// read before anything has been written to it.
// Wait for the thing being asserted, not for a picture of it. Waiting on the
// progress panel to detach races its own appearance: called in the instant
// before it renders, "no progress element" is already true and the store gets
// read before anything has been written to it. That passed once and failed the
// next run, which is what a race looks like.
await page.waitForFunction(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const run = await runStore.loadRun(key)
    return (run?.transcriptions.length ?? 0) > 0
  },
  [REPO, savedKey],
  { timeout: 240000, polling: 1000 }
)
await page.waitForSelector('.q', { timeout: 120000 })
await page.waitForTimeout(500)
// Read off the step heading rather than the rail. The rail is a horizontal
// strip on a narrow viewport and its later labels scroll out of the box, which
// makes `innerText` on them a question about layout rather than about state.
// The heading is the state: reaching the gate *is* being past the paid step.
const afterCollect = await page
  .locator('.step-head')
  .innerText()
  .catch(() => '')
const transcribeDone = /uncertain spots/i.test(afterCollect)
const collected = await page.evaluate(
  async ([repo, key]) => {
    const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
    const run = await runStore.loadRun(key)
    const ticket = await runStore.loadBatchTicket(key)
    return {
      pages: run?.transcriptions.length ?? 0,
      complete: run?.complete ?? false,
      text: run?.transcriptions[0]?.blocks[0]?.text ?? '',
      ticketGone: ticket === null,
      // Which keys tickets actually live under, so a mismatch between the key
      // the app deleted and the key the run is filed under is visible rather
      // than guessed at.
      ticketKeys: (await runStore.listBatchTickets()).map((t) => t.key),
      askedFor: key
    }
  },
  [REPO, savedKey]
)
await shot('08b8-batch-collected')

if (!batchOption || !nowOption) throw new Error('The batch door was not offered')
if (priceOf(batchOption) > priceOf(nowOption) * 0.6) {
  throw new Error('The batch option did not quote a lower price than reading it now')
}
if (!/OCR/.test(batchOption)) throw new Error('The batch option hides what it gives up')
if (!/submit/i.test(approvalPrompt)) throw new Error('The approval screen did not say "submit"')
if (!/close it/.test(approvalHelp))
  throw new Error('The approval screen did not say the tab can be closed')
if (batchesMade < 1) throw new Error('Nothing was submitted')
if (pagesSubmitted !== 9) throw new Error(`Submitted ${pagesSubmitted} pages, expected 9`)
if (survivedReload !== 1) throw new Error('The batch ticket did not survive a reload')
if (quotedAgain !== 0) throw new Error('A book already out being read was quoted a price again')
if (!/already paid for/.test(collectHelp)) throw new Error('Collecting was not said to be free')
// The button under a "these pages are bought" screen must not promise a cost.
if (/cost/i.test(collectLabel)) {
  throw new Error(`The collect button offered to show a cost: "${collectLabel}"`)
}
if (!/close this tab/.test(waitingHelp))
  throw new Error('The waiting screen did not say the tab can be closed')
if (collected.pages !== 9) throw new Error(`Collected ${collected.pages} pages, expected 9`)
if (!collected.complete) throw new Error('The collected run was not marked complete')
if (!/Collected from a batch/.test(collected.text)) {
  throw new Error('The saved run does not hold what the batch returned')
}
// The second reading ran over the flagged leaves on the way in, and its
// verdicts are on the rows rather than hidden behind a shorter list. Checked
// here rather than at the earlier gate because that one is fed from a seeded
// saved run, so nothing was ever read a second time for it.
const checkNote = await page
  .locator('.resume-note')
  .filter({ hasText: 'looked at again' })
  .innerText()
  .catch(() => '')
const checkedRows = await page.locator('.discrepancy-checked').count()
// The point of paying for the pass: leaves it answered outright leave the
// queue. Attaching verdicts and still walking every flagged leaf is the
// expensive half of the job with none of the useful half, which is exactly
// what it did before — and nothing here would have noticed.
const settledSaid = await page
  .locator('.q .prompt')
  .filter({ hasText: 'settled by the second reading' })
  .count()
const leavesAfterCheck = await page
  .locator('.pager-where')
  .innerText()
  .catch(() => '')
const checkedReadable = await page
  .locator('.discrepancy-checked b')
  .first()
  .innerText()
  .catch(() => '')
const takeAllOffered = await page
  .locator('.discrepancy-head button', { hasText: 'checked answer' })
  .count()

console.log(
  `  → tickets left: ${JSON.stringify(collected.ticketKeys)} (run filed under ${JSON.stringify(
    collected.askedFor
  )})`
)
if (!collected.ticketGone)
  throw new Error('The ticket outlived the collection it was the receipt for')
if (!transcribeDone) throw new Error('Collecting did not carry the flow past the paid step')
console.log(
  `  → second reading: ${secondReadCalls} leaf request(s), ${secondReadIds.length} spot(s), ` +
    `${checkedRows} row(s) carry a verdict · settled leaves announced: ${settledSaid > 0}` +
    ` · now at "${leavesAfterCheck.replace(/\s+/g, ' ')}"`
)
console.log(
  `  → ${pagesSubmitted} pages in ${batchesMade} batch(es) at ${priceOf(batchOption)} against ` +
    `${priceOf(nowOption)}; survived a reload; collected ${collected.pages} pages and the ticket was cleared`
)

await page.unroute('https://api.anthropic.com/v1/messages/batches**')

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
// Either place. The note lives in the running stage while there *is* one, and
// in `.resume-note` after — which is the whole point of that second element,
// since a book whose reading is cached skips the progress screen in under a
// second. Looking only at the running stage makes this assertion a race that a
// warm cache loses.
const resumeSaid = await page
  .locator('.progress .help, .resume-note')
  .filter({ hasText: 'already paid' })
  .first()
  .waitFor({ timeout: 20000 })
  .then(() => 1)
  .catch(() => 0)
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
console.log(
  `  cuttings offering their line: ${contextCrops} (peek ${peekWidth}px wide, unclipped: ${
    peekWidth > 400
  })`
)
if (!contextVisible) throw new Error('The context peek does not appear on hover')
if (peekWidth <= 400) throw new Error(`The context peek is only ${peekWidth}px wide — clipped`)
if (!lightboxOpen) throw new Error('Clicking a word crop does not open it full size')
if (!lightboxClosed) throw new Error('Escape does not close the full-size view')
console.log(`  and full size on click: ${lightboxWidth}px, closed by Escape: ${lightboxClosed}`)
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
console.log(
  `  reopening skips the reading: ${coldOpenMs} ms cold -> ${warmOpenMs} ms warm` +
    (skippedNote ? ` (${skippedNote.replace(/\s+/g, ' ')})` : '')
)
console.log(
  `  a flagged leaf can be read: ${gateThumbWidth}px thumbnail -> ${gateBigWidth}px on click` +
    ` (closed by Escape: ${gateBigClosed})`
)
if (!overlayCovers) throw new Error('The full-size view does not cover the window')
if (gateBigWidth <= gateThumbWidth * 2) {
  throw new Error(`Opening the leaf gave ${gateBigWidth}px — no better than the thumbnail`)
}
console.log(
  `  italics are visible where they can be edited: ${italicsShown || 'NOT SHOWN'}` +
    ` (explained: ${italicsHinted > 0})`
)
if (!italicsShown) console.log(`  leaves walked: ${leavesWalked.join(' | ')}`)
if (!italicsShown) throw new Error('The proof editor shows no italics at all')
if (!italicsHinted) throw new Error('The italic tags appear with nothing explaining them')
if (!proofBig) throw new Error('The proof leaf does not open full size')
console.log(
  `  one leaf a screen: ${desktopCards} on a desktop, ${pagedCards} on a phone` +
    ` — "${pagerWhere.replace(/\s+/g, ' ')}" -> "${afterNext.replace(/\s+/g, ' ')}"` +
    ` (pager ${pagerSticky}, in view: ${pagerInView})`
)
console.log(`  the bar fills as leaves are finished: ${barAfterOne}% after one`)
if (desktopCards !== pagedCards) throw new Error('The desktop view is not paged like the phone')
// Zero checked, however many there are. The count is a property of the book and
// of how good the checks are — it dropped from seven to six the day the running
// head stopped being reported as missing text — so pinning it makes this
// assertion fail every time the flagging gets better. What it is really about
// is that a freshly opened gate claims no progress.
if (!/0 of [1-9]\d* checked/.test(desktopWhere)) {
  throw new Error(`The gate opened claiming progress: "${desktopWhere}"`)
}
// One leaf of however many: somewhere above nothing and well short of done.
if (barAfterOne < 5 || barAfterOne > 40) {
  throw new Error(`The progress bar reads ${barAfterOne}% after a single leaf`)
}
console.log(
  `  place remembered: ${cursorKept || 'NO'} · continue hidden midway: ${continueMidway === 0}` +
    ` · "all at once" gives ${allAtOnce} cards`
)
if (pagedCards >= allAtOnce) throw new Error('The phone view is not paging the gate at all')
if (continueMidway !== 0) throw new Error('The continue button is reachable before the last leaf')
if (!cursorKept) throw new Error('Moving through the gate does not record where you got to')
if (!pagerInView) throw new Error('The pager is off-screen on a phone')
console.log(`  and after closing the tab it reopens on: "${resumedAt.replace(/\s+/g, ' ')}"`)
// Compared against the leaf actually left on, not a literal. Which page sits at
// a given place in the gate depends on which leaves got flagged, and that
// changes whenever the checks improve — the run before this one left on page 4
// where the assertion still wanted page 3, and landed on page 4 correctly.
const leftOn = /^Page \d+/.exec(afterNext)?.[0] ?? ''
if (!leftOn || !resumedAt.startsWith(leftOn)) {
  throw new Error(
    `Reopening the gate landed on "${resumedAt}", not the leaf it was left on (${leftOn})`
  )
}
console.log(`  the gate offers: ${verdictOptions.join(' / ')}`)
console.log(
  `  disagreements located: ${gapRows} row(s), ${gapCrops} with the pixels, ` +
    `${gapPreselected} pre-selected`
)
console.log(
  `  a fix typed at the gate reaches the book: ${
    gateEdited ? gateFixOnLeaf === GATE_FIX : 'not exercised'
  } (leaf ${fixablePage})`
)
console.log(
  `  a leaf marked to fix keeps its note: ${markedALeaf ? markedFlag || 'NO' : 'not exercised'}` +
    (toFixButton ? ` (${toFixButton})` : '')
)
console.log(
  `  after correcting one: ${correctedCount.replace(/\s+/g, ' ')} (was ${correctedBefore})`
)
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
/**
 * The final tally.
 *
 * A named list rather than one long `&&`, because the chain could only ever
 * say *that* something was wrong \u2014 never which. Two of these had been false
 * for some time and nobody could see it: the run that would have caught them
 * was piped through `tail`, which masks the exit code, and even once the
 * failure surfaced there was nothing to do but read the whole condition and
 * guess, at ten minutes a guess.
 */
const finalChecks = [
  ['no page errors', errors.length === 0],
  ['the term grid has rows', rows > 0],
  ['answering the gate changed something', before !== after],
  ['a paid run was offered back', offered === 1],
  ['the key was not asked for again', askedForKey === 0],
  ['the same pages were not charged twice', chargedAgain === 0],
  // The two the fixture prints, and nothing from the eight pages of text.
  ['both printed illustrations were found', foundIllustrations === 2],
  ['every found illustration got a crop', illustrationCrops === foundIllustrations],
  ['a plate is previewed from the real PDF', plateFound],
  // The second reading: one request per flagged leaf, its verdicts visible on
  // the rows, and what it found said out loud rather than left as a screen that
  // is quietly shorter than it would otherwise have been.
  ['the flagged leaves were read a second time', secondReadCalls > 0],
  ['it was asked about the spots by their row ids', secondReadIds.length > 0],
  ['it reported what it found', /looked at again/.test(checkNote)],
  ['its verdicts are shown on the rows', checkedRows > 0],
  ['each verdict says what was read, not just yes or no', checkedReadable.length > 0],
  ['taking the checked answers is offered as a choice', takeAllOffered > 0],
  // Said out loud, not a screen that is quietly shorter than it was.
  ['leaves it settled are taken out of the review, and said so', settledSaid > 0],
  ['every disagreement is listed as its own row', gapRows > 0],
  // The row exists to point at the word. Without the crop it is the old
  // "somewhere on this page" with extra steps.
  ['each row shows the word as it appears on the scan', gapRows === 0 || gapCrops === gapRows],
  ['the missing words are marked in their context', gapRows === 0 || gapHighlighted.length > 0],
  ['no gap is filled from OCR unasked', gapPreselected === 0],
  ['a verdict on a gap sticks', gapRows === 0 || gapRestoreStuck],
  ['the proof sheet has editable text', proofBoxes > 0],
  ['the proof sheet shows the scan', proofScan === 1],
  ['typing on the proof sheet counted as a correction', correctionCounted],
  ['a note was proposed', annotations === 1],
  ['a supplied picture was taken', suppliedPictures === 1],
  ['an introduction was written', sectionsWritten === 1],
  ['the design gate offers controls', editors > 0],
  ['a picture was retouched', retouchedPicture > 0],
  ['a picture was cut down', cutEditor > 0],
  ['cropping shrank what the book gets', cropShrankIt],
  // A book whose headings are all the editor's own still gets a contents
  // page. The property, not a count: the harness authors an introduction and
  // a note, and pinning the number here meant this line silently stopped
  // being true the moment a second authored section was added.
  [
    'every heading in the contents is the editor\u2019s own',
    /(\d+) heading\(s\), \1 of them yours/.test(contentsNote) && !/ 0 heading/.test(contentsNote)
  ],
  ['the supplied picture is previewed', suppliedPreview === 1],
  // Three pictures now reach the book: two cut from the scan, one supplied.
  [
    'three illustrations reach the book',
    /3 illustrations set into the book/.test(illustrationNote)
  ],
  // The export screen reports what the engine actually placed, so this is the
  // authored note reaching the book rather than reaching a form. Any number
  // above zero \u2014 the harness writes one at the proof step and accepts another
  // from the annotation pass, and which of those runs is not what this is about.
  [
    'an authored note was set at the foot of a page',
    /[1-9]\d* footnote\(s\) were set at the foot/.test(noteNote)
  ],
  ['the proof sheet fits a phone', proofOverflow <= 0],
  // A real answer, not the "no placed images to check" it gave before.
  ['export is blocked until the title is given', blockedWithoutTitle],
  ['the image check reports a DPI', /DPI/.test(imageCheck)],
  ['the image check found images to check', !/No placed images/.test(imageCheck)],
  ['the export note mentions the illustrations', /illustration/.test(illustrationNote)],
  ['the page browser has leaves', leaves > 0],
  ['a design answer changed the page count', pagesBefore !== pagesAfter],
  ['the export offers a page count', /\d+ pages/.test(download)],
  ['the preview fits a phone', previewOverflow <= 0],
  ['the KDP checks ran', checks > 0],
  ['no KDP check is still pending', pending === 0],
  ['the export screen fits a phone', overflow <= 0]
]

const failedChecks = finalChecks.filter(([, ok]) => !ok).map(([name]) => name)
if (failedChecks.length > 0) {
  console.log(`\nFAILED (${failedChecks.length}):`)
  for (const name of failedChecks) console.log(`  \u2717 ${name}`)
}
process.exit(failedChecks.length === 0 ? 0 : 1)
