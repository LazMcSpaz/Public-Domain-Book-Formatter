/**
 * The intake screen with a shelf on it, screenshotted.
 *
 * The shelf is stubbed with one card at each stage a book can be at — not
 * started, part read, read with decisions waiting, done, and a card from
 * before queries were counted — so the tints and the sentences can be looked
 * at side by side. Nothing here asserts; it is the picture the CLAUDE.md rule
 * asks for before shipping UI. Needs the dev server up.
 *
 *   node scripts/screenshot-shelf.mjs            → screenshots/shelf.png
 *   node scripts/screenshot-shelf.mjs --open 2   → with the third card open
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const openIndex = process.argv.includes('--open')
  ? Number(process.argv[process.argv.indexOf('--open') + 1])
  : -1

const cards = [
  { dir: 'a', fileName: 'the-human-aura.pdf', pageCount: 96, complete: false, read: 0 },
  {
    dir: 'b',
    fileName: 'isis-unveiled-vol1.pdf',
    pageCount: 720,
    complete: false,
    read: 344,
    corrections: 120
  },
  {
    dir: 'c',
    fileName: 'blavatsky-secret-doctrine-vol1-tup.pdf',
    pageCount: 720,
    complete: true,
    read: 720,
    corrections: 477,
    queries: { raised: 563, waiting: 130, held: 81 },
    scanPath: 'scans/x.pdf'
  },
  {
    dir: 'd',
    fileName: 'clairvoyance.pdf',
    pageCount: 140,
    complete: true,
    read: 140,
    corrections: 40,
    notes: 23,
    queries: { raised: 12, waiting: 0, held: 0 }
  },
  { dir: 'e', fileName: 'thought-vibration.pdf', pageCount: 110, complete: true, marked: 30 }
]

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
await page.addInitScript(() => {
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
})
await page.route('https://api.github.com/**', async (route) => {
  const url = route.request().url()
  if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ full_name: 'LazMcSpaz/Test-Shelf', default_branch: 'main' })
    })
  }
  const path = decodeURIComponent(/\/contents\/([^?]+)/.exec(url)?.[1] ?? '')
  if (path === 'books') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cards.map((c) => ({ name: c.dir, type: 'dir' })))
    })
  }
  const m = /^books\/([^/]+)\/about\.json$/.exec(path)
  const card = m && cards.find((c) => c.dir === m[1])
  if (!card) return route.fulfill({ status: 404, body: '{}' })
  const about = { ...card }
  delete about.dir
  const body = JSON.stringify({
    key: `${about.fileName}\u00001\u00001`,
    savedAt: '2026-09-20T12:00:00.000Z',
    notes: 0,
    corrections: 0,
    marked: 0,
    facts: 0,
    scanPath: null,
    ...about
  })
  return route.fulfill({
    status: 200,
    contentType: 'application/vnd.github.raw',
    body
  })
})

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.shelf-book', { timeout: 15000 })
if (openIndex >= 0) {
  await page.locator('.shelf-book-face').nth(openIndex).click()
  await page.waitForSelector('.shelf-book-more')
}
mkdirSync(resolve(import.meta.dirname, '..', 'screenshots'), { recursive: true })
const out = resolve(
  import.meta.dirname,
  '..',
  'screenshots',
  `shelf${openIndex >= 0 ? '-open' : ''}.png`
)
await page.locator('.shelf').screenshot({ path: out })
console.log(`wrote ${out}`)
await browser.close()
