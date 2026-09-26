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
 *   node scripts/screenshot-shelf.mjs --at 2     → with the third card in the middle
 *   node scripts/screenshot-shelf.mjs --drag -90 → mid-swipe, the finger still down
 *   node scripts/screenshot-shelf.mjs --phone    → at a phone's width
 *   node scripts/screenshot-shelf.mjs --light    → on the paper ground
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const argOf = (name) =>
  process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : null
const at = argOf('--at')
const drag = argOf('--drag')
const phone = process.argv.includes('--phone')
const light = process.argv.includes('--light')

const cards = [
  {
    // A renamed directory over a file named by its digest, as most of the
    // real shelf is: the card is named from the directory.
    dir: 'Blavatsky-TheTheosophicalGlossary-1s37ewg',
    fileName: 'c77f699e62cfb22ddae9c6dc67b110d9187d107bdd7a65557690479df6aa62e1.pdf',
    pageCount: 390,
    complete: false,
    read: 0
  },
  {
    dir: 'b',
    fileName: 'isis-unveiled-vol1.pdf',
    pageCount: 720,
    complete: false,
    read: 344,
    corrections: 120
  },
  {
    dir: 'Blavatsky-TheSecretDoctrineVolI-tup',
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
const page = await browser.newPage({
  viewport: phone ? { width: 390, height: 844 } : { width: 1100, height: 960 },
  deviceScaleFactor: 2,
  hasTouch: phone
})
await page.addInitScript((light) => {
  localStorage.setItem('pdbf.theme', light ? 'light' : 'dark')
  localStorage.removeItem('pdbf.shelf.place')
  localStorage.setItem(
    'pdbf.shelf',
    JSON.stringify({ repo: 'LazMcSpaz/Test-Shelf', branch: 'main', token: 'github_pat_harness' })
  )
}, light)
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
await page.waitForSelector('.deck-card', { timeout: 15000 })
if (at !== null) {
  await page.locator('.deck-dot').nth(at).click()
}
await page.waitForTimeout(800)
if (drag !== null) {
  const box = await page.locator('.deck-stage').boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height * 0.8
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (drag * i) / 10, y)
  await page.waitForTimeout(100)
}
mkdirSync(resolve(import.meta.dirname, '..', 'screenshots'), { recursive: true })
const name = [
  'shelf',
  at !== null ? `at${at}` : '',
  drag !== null ? `drag${drag}` : '',
  phone ? 'phone' : '',
  light ? 'light' : ''
]
  .filter(Boolean)
  .join('-')
const out = resolve(import.meta.dirname, '..', 'screenshots', `${name}.png`)
await page.screenshot({ path: out, fullPage: true })
console.log(`wrote ${out}`)
await browser.close()
