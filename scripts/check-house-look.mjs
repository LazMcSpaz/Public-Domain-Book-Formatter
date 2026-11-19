/**
 * One question: does the app's design gate open a book with no design of its
 * own in the house look from the shelf, and leave a book with one alone?
 *
 * Three made-up books on a stubbed shelf that holds a made-up house look
 * (`design/house-look.json`). A long one must open at 7x10 with the house
 * margins and say where its look came from; a short one (under 100 pages at
 * 7x10) at 6x9; one with design answers of its own in its own look, with no
 * word about the house look. The answers it opens with must be the book's
 * from then on, so they are read back from the device's review record.
 *
 * Its own page and its own stub, for the reason `check-query-crop.mjs` gives.
 *
 *   node scripts/check-house-look.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const HOUSE = {
  version: 1,
  name: 'Check house look',
  design: {
    kind: 'nonfiction',
    period: 'victorian',
    chapterOpener: 'ornamented',
    runningHeads: 'chapter',
    font: 'libre-caslon',
    runningHeadVerso: 'author',
    trimSize: '7x10',
    bodyFontSize: '11',
    ornamentChapter: 'chapter-vine',
    marginInner: '1.125',
    marginOuter: '0.75',
    folioMirrorsHead: true,
    avoidShortLastLines: true
  },
  shortBook: { underPages: 100, design: { trimSize: '6x9' } }
}

const browser = await chromium.launch({ executablePath: CHROME })
const problems = []

/** One book on its own page and stub; what the design gate said and kept. */
async function openAtDesign(name, paragraphs, design) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
  if (process.env.PDBF_TRACE) {
    page.on('console', (m) => console.log('  page:', m.text().slice(0, 160)))
    page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 200)))
  }
  await page.addInitScript(() => {
    localStorage.setItem(
      'pdbf.shelf',
      JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
    )
  })
  const files = new Map([['design/house-look.json', JSON.stringify(HOUSE)]])
  let slug = null
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
    if (request.method() !== 'GET') return json(200, { content: { sha: 'stub-sha' } })
    if (path === 'books') return json(200, slug ? [{ name: slug, type: 'dir' }] : [])
    if (!files.has(path)) return json(404, { message: 'Not Found' })
    if ((request.headers()['accept'] ?? '').includes('raw')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: files.get(path) })
    }
    return json(200, { type: 'file', sha: 'stub-sha', path })
  })
  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  const built = await page.evaluate(
    async ([repo, name, paragraphs, design]) => {
      const project = await import(`/@fs${repo}/src/core/project/index.ts`)
      const sync = await import(`/@fs${repo}/src/core/sync/index.ts`)
      const key = project.fileKey({ name: `${name}.pdf`, size: 4000 + paragraphs, lastModified: 7 })
      const words = 'the keeper walked the long hall each night and counted the doors twice'
      const blocks = [{ kind: 'heading', level: 1, text: 'The First Walk' }]
      for (let i = 0; i < paragraphs; i++) {
        blocks.push({ kind: 'paragraph', text: `${words} ${words} ${words} ${words}.` })
      }
      const run = project.createSavedRun({
        key,
        pageCount: 1,
        fileName: `${name}.pdf`,
        transcriptions: [
          {
            pageIndex: 0,
            role: 'body',
            blocks,
            uncertain: [],
            furniture: {},
            metadata: { title: name }
          }
        ],
        failures: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        modelId: 'claude-opus-5',
        identityAnswers: {},
        complete: true
      })
      return {
        key,
        // The notes gate is declined in advance, so the walk to the design
        // gate asks nothing that costs money.
        json: project.serializeBookFile({
          run,
          answers: {
            annotate: { annotateBook: 'no', writeIntroduction: 'none', harvestFacts: 'none' },
            ...(design ? { design } : {})
          },
          voice: null
        }),
        slug: sync.shelfSlug(key),
        bookPath: sync.bookPath(key),
        aboutPath: sync.aboutPath(key)
      }
    },
    [REPO, name, paragraphs, design]
  )
  files.set(built.bookPath, built.json)
  files.set(
    built.aboutPath,
    JSON.stringify({
      key: built.key,
      fileName: `${name}.pdf`,
      savedAt: new Date().toISOString(),
      pageCount: 1,
      complete: true,
      scanPath: null
    })
  )
  slug = built.slug
  // A book with no scan opens at the proof step; walk on to the design gate
  // the way a person does: past the proof and the declined notes gate.
  await page.goto(`${URL_BASE}/#book=${built.slug}&at=design`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const onStep = () =>
    page
      .locator('.step-head h2')
      .innerText()
      .catch(() => '')
  for (let i = 0; i < 20 && !(await onStep()).startsWith('Design'); i++) {
    const go = page.getByRole('button', { name: /Looks right — continue/ })
    if (await go.isVisible().catch(() => false)) await go.click()
    else
      await page
        .getByRole('button', { name: /Next ›/ })
        .first()
        .click()
        .catch(() => {})
    await page.waitForTimeout(1500)
  }
  // The house look is measured on the book before it is filled in.
  await page.waitForTimeout(8000)
  for (let i = 0; i < 12; i++) {
    if (
      await page
        .getByText(/Your edition will be set as/iu)
        .isVisible()
        .catch(() => false)
    )
      break
    await page
      .getByRole('button', { name: /Next ›/ })
      .first()
      .click()
      .catch(() => {})
    await page.waitForTimeout(800)
  }
  await page.waitForTimeout(1500)
  const body = await page.locator('body').innerText()
  const summary = /Your edition will be set as\s*\n?\s*(.+)/iu.exec(body)?.[1]?.trim() ?? null
  const note = body.split('\n').find((l) => l.includes('house look')) ?? null
  const kept = await page.evaluate((key) => {
    const raw = localStorage.getItem(`pdbf.review.${key}`)
    return raw ? (JSON.parse(raw).design ?? null) : null
  }, built.key)
  await page.close()
  return { summary, note, kept }
}

const long = await openAtDesign('long-book', 900, null)
const short = await openAtDesign('short-book', 12, null)
const own = await openAtDesign('own-book', 12, { kind: 'novel', period: 'modern', trimSize: '6x9' })

for (const [label, r] of Object.entries({ long, short, own })) {
  console.log(`${label.padEnd(6)}: ${r.summary}`)
  console.log(`        note: ${r.note}`)
  console.log(`        kept: ${JSON.stringify(r.kept)}`)
}
if (!long.summary?.startsWith('7x10in') || !long.summary.includes('1.125in inner margin')) {
  problems.push(`the long book did not open in the house look: ${long.summary}`)
}
if (!long.note?.includes('7x10'))
  problems.push(`the long book said nothing of the house look: ${long.note}`)
if (long.kept?.marginInner !== '1.125' || long.kept?.profile !== 'fresh') {
  problems.push(`the long book's answers were not kept as its own: ${JSON.stringify(long.kept)}`)
}
if (!short.summary?.startsWith('6x9in') || !short.summary.includes('Libre Caslon')) {
  problems.push(`the short book was not set 6x9 in the house look: ${short.summary}`)
}
if (!short.note?.includes('a short book')) problems.push(`the short book's note: ${short.note}`)
if (own.note !== null)
  problems.push(`a book with its own design was told of the house look: ${own.note}`)
if (own.summary?.includes('Libre Caslon') || own.summary?.includes('1.125in')) {
  problems.push(`a book with its own design was given the house look: ${own.summary}`)
}

await browser.close()
if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nA book with no design opens in the house look; a book with one keeps its own.')
