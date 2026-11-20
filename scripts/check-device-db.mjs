/**
 * The device's databases, in a real browser: the app's main database (`pdbf`,
 * `run-store.ts`: the owner's runs, kept scans, readings and the outbox of
 * rulings and marks not yet sent) and the Workroom's own (`pdbf-workroom`,
 * `note-store.ts`: a copy of the status notes that costs nothing to lose).
 * The main database is seeded as `main` builds it, a made-up record in every
 * store (`lib/device-db.mjs`). It asks:
 *
 * - does the app from this branch open the main database at main's version
 *   and change nothing in it, through the shelf screen, the Workroom and
 *   Settings' Forget, which empties only the Workroom's database? Does a
 *   Workroom open in another tab drop its copy too?
 * - does a browser that ran this branch's first version (the main database
 *   at version 8, with a store for the notes) still open, read and keep it?
 * - when an open is held up by another tab ("blocked") and goes through
 *   later, is that late connection closed, so it cannot hold up the next?
 * - when a newer version of the app opens the main database in another tab,
 *   does this page let go and tell the owner to reload?
 *
 *   node scripts/check-device-db.mjs   (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import {
  MAIN_DB,
  MAIN_STORES,
  MAIN_VERSION,
  WORKROOM_DB,
  changesIn,
  countsOf,
  deviceSnapshot,
  madeUpRecords,
  seedMainDatabase
} from './lib/device-db.mjs'
import { madeUpNotes, stubShelf } from './lib/workroom-fixture.mjs'

const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
/** A page of the app's own origin with nothing on it: the databases are seeded there first. */
const BLANK = `${URL_BASE}/check-device-db-blank`
/** The main database's code at the address the app's own screens import it from. */
const RUN_STORE = `/@fs${resolve(import.meta.dirname, '..')}/src/platform/browser/run-store.ts`

const problems = []
function check(ok, what) {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) problems.push(what)
}

const browser = await chromium.launch({ executablePath: CHROME })

/** A fresh device: its own context, with the made-up shelf and its token. */
async function device() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  await context.route(BLANK, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>blank</title>'
    })
  )
  await context.addInitScript(() =>
    localStorage.setItem(
      'pdbf.shelf',
      JSON.stringify({ repo: 'Someone/Made-Up-Shelf', branch: 'main', token: 'github_pat_harness' })
    )
  )
  const shelf = { notes: madeUpNotes(), books: [], files: new Map() }
  const page = async () => {
    const p = await context.newPage()
    if (process.env.PDBF_TRACE)
      p.on('console', (m) => console.log('  page:', m.text().slice(0, 160)))
    const seen = await stubShelf(p, shelf)
    await p.goto(BLANK)
    return { page: p, seen }
  }
  return { context, shelf, page }
}

/** How many notes the Workroom's database keeps (-1: none), read without creating it. */
const workroomNotes = (page) =>
  page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return -1
    return new Promise((resolve) => {
      const open = indexedDB.open(name)
      open.onerror = () => resolve(-1)
      open.onsuccess = () => {
        const db = open.result
        const count = db.transaction('notes').objectStore('notes').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => resolve(-1)
        db.close()
      }
    })
  }, WORKROOM_DB)

async function notesReach(page, n) {
  let held = -1
  for (let i = 0; i < 50 && held !== n; i++) {
    held = await workroomNotes(page)
    if (held !== n) await page.waitForTimeout(200)
  }
  return held
}

/** The Workroom, Settings' Forget, and back: what Settings said. */
async function forgetInSettings(page) {
  await page.evaluate(() => (window.location.hash = '#settings'))
  const line = page.locator('[data-storage="workroom-notes"]')
  await line.waitFor({ timeout: 10000 })
  await line.locator('button:not([disabled])').waitFor({ timeout: 10000 })
  await line.locator('button').click()
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('[data-storage="workroom-notes"]')
          ?.textContent?.includes('no notes'),
      null,
      { timeout: 10000 }
    )
    .catch(() => null)
}

// --- 1. main's database, through the app's screens and Settings' Forget ---
{
  const { context, shelf, page } = await device()
  const one = await page()
  await seedMainDatabase(one.page)
  const before = await deviceSnapshot(one.page)
  const other = await page()
  await other.page.goto(`${URL_BASE}/#workroom`, { waitUntil: 'networkidle' })
  await other.page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
  await one.page.goto(`${URL_BASE}/`, { waitUntil: 'networkidle' })
  await one.page.waitForSelector('#root *', { timeout: 15000 })
  await one.page.evaluate(() => (window.location.hash = '#workroom'))
  await one.page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
  const kept = await notesReach(one.page, shelf.notes.size)
  check(kept === shelf.notes.size, `the Workroom keeps its notes in ${WORKROOM_DB} (${kept})`)
  await forgetInSettings(one.page)
  check((await workroomNotes(one.page)) === 0, "Settings' Forget empties the Workroom's database")
  const after = await deviceSnapshot(one.page)
  const changed = changesIn(MAIN_DB, before, after)
  check(
    before[MAIN_DB]?.version === MAIN_VERSION && changed.length === 0,
    `the main database is as main left it: version, stores and every record (${countsOf(after, MAIN_DB)}` +
      `${changed.length ? `; ${changed.join('; ')}` : ''})`
  )
  check(
    Object.keys(after).sort().join(' ') === [MAIN_DB, WORKROOM_DB].sort().join(' '),
    `no other database is made (${Object.keys(after).join(', ')})`
  )
  check(
    (await one.page.locator('[data-newer-version]').count()) === 0,
    'and nothing tells the owner to reload: no newer version is open'
  )
  const blobs = other.seen.blobs
  await other.page.click('.wr-refresh')
  for (let i = 0; i < 50 && other.seen.blobs - blobs < shelf.notes.size; i++) {
    await other.page.waitForTimeout(200)
  }
  check(
    other.seen.blobs - blobs === shelf.notes.size,
    `a Workroom open in another tab drops its copy too, and reads every note again (${other.seen.blobs - blobs})`
  )
  await context.close()
}

// --- 2. a browser that ran this branch's first version: the main database at 8 ---
{
  const { context, page } = await device()
  const one = await page()
  const records = { ...madeUpRecords(), 'workroom-notes': [{ sha: 'a'.repeat(40), text: '{}' }] }
  await seedMainDatabase(one.page, {
    version: 8,
    stores: { ...MAIN_STORES, 'workroom-notes': { keyPath: 'sha', indexes: {} } },
    records
  })
  const before = await deviceSnapshot(one.page)
  await one.page.goto(`${URL_BASE}/`, { waitUntil: 'networkidle' })
  await one.page.waitForSelector('#root *', { timeout: 15000 })
  const read = await one.page.evaluate(async (path) => {
    const store = await import(path)
    const outbox = await store.outboxAll()
    return { files: await store.storedFileKeys(), outbox: outbox.map((e) => e.id) }
  }, RUN_STORE)
  const want = madeUpRecords()
  check(
    read.files.join() === want.files[0].key && read.outbox.join() === want.outbox[0].id,
    `the app still opens and reads it (${read.files.length} kept scan, ${read.outbox.length} waiting change)`
  )
  await one.page.evaluate(() => (window.location.hash = '#workroom'))
  await one.page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
  await forgetInSettings(one.page)
  const after = await deviceSnapshot(one.page)
  const changed = changesIn(MAIN_DB, before, after)
  check(
    changed.length === 0,
    `and leaves it as it was, at version 8 (${countsOf(after, MAIN_DB)}${changed.length ? `; ${changed.join('; ')}` : ''})`
  )
  check(
    (await one.page.locator('[data-newer-version]').count()) === 0,
    'without telling the owner to reload: nothing newer is open'
  )
  await context.close()
}

// --- 3. an open held up by another tab, and its late connection ---
{
  const { context, page } = await device()
  const one = await page()
  const older = { ...MAIN_STORES }
  delete older.outbox
  await seedMainDatabase(one.page, { version: 6, stores: older })
  const other = await page()
  // The other tab holds the database at 6 and never lets go until told.
  await other.page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const open = indexedDB.open(name, 6)
        open.onsuccess = () => {
          window.held = open.result
          resolve()
        }
      }),
    MAIN_DB
  )
  const blocked = await one.page.evaluate(
    async (path) => (await import(path)).storedFileKeys(),
    RUN_STORE
  )
  check(blocked.length === 0, 'an open held up by another tab answers at once, with nothing')
  await other.page.evaluate(() => window.held.close())
  await one.page.waitForTimeout(800)
  const next = await other.page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const open = indexedDB.open(name, 8)
        open.onblocked = () => resolve('blocked')
        open.onsuccess = () => {
          open.result.close()
          resolve('opened')
        }
        open.onerror = () => resolve(`refused (${open.error?.name})`)
        setTimeout(() => resolve('no answer'), 5000)
      }),
    MAIN_DB
  )
  check(
    next === 'opened',
    `when it goes through later, that connection is closed: a newer version opens at once (${next})`
  )
  const after = await deviceSnapshot(other.page)
  const records = madeUpRecords()
  check(
    'outbox' in (after[MAIN_DB]?.stores ?? {}) &&
      Object.keys(older).every(
        (s) => after[MAIN_DB].stores[s].records.length === records[s].length
      ),
    `the late upgrade added the outbox and kept every record (${countsOf(after, MAIN_DB)})`
  )
  const again = await one.page.evaluate(
    async (path) => (await import(path)).storedFileKeys(),
    RUN_STORE
  )
  check(
    again.join() === records.files[0].key,
    `and the page reads the database a newer version raised, at its version (${again.length})`
  )
  await context.close()
}

// --- 4. a newer version of the app opened in another tab ---
{
  const { context, page } = await device()
  const one = await page()
  const records = madeUpRecords()
  await seedMainDatabase(one.page, { records })
  // A slow device, made on purpose: once `window.askNewer` is set, the app's
  // next open of the main database tells the other tab to open a newer
  // version, and the first read on that connection hands its answer over
  // 1.5 s late, so this page still holds the connection when the other tab
  // asks. Nothing in the app's own code is changed.
  await one.page.addInitScript(() => {
    const open = IDBFactory.prototype.open
    const channel = new BroadcastChannel('check-device-db')
    IDBFactory.prototype.open = function (name, ...rest) {
      const request = open.call(this, name, ...rest)
      if (name === 'pdbf' && window.askNewer) {
        window.askNewer = false
        request.addEventListener('success', () => {
          window.slowDb = request.result
          channel.postMessage('now')
        })
      }
      return request
    }
    for (const method of ['get', 'getAll', 'getAllKeys', 'count']) {
      const real = IDBObjectStore.prototype[method]
      IDBObjectStore.prototype[method] = function (...args) {
        const request = real.apply(this, args)
        if (!window.slowDb || this.transaction.db !== window.slowDb) return request
        window.slowDb = null
        let handler = null
        Object.defineProperty(request, 'onsuccess', {
          get: () => handler,
          set: (fn) => {
            handler = fn
          }
        })
        request.addEventListener('success', (event) =>
          setTimeout(() => handler?.call(request, event), 1500)
        )
        return request
      }
    }
  })
  await one.page.goto(`${URL_BASE}/`, { waitUntil: 'networkidle' })
  await one.page.waitForSelector('#root *', { timeout: 15000 })
  const other = await page()
  await other.page.evaluate(
    ({ name, version }) => {
      window.newer = new Promise((resolve) => {
        new BroadcastChannel('check-device-db').onmessage = () => {
          const asked = performance.now()
          const open = indexedDB.open(name, version)
          open.onsuccess = () => {
            open.result.close()
            resolve(`opened in ${Math.round(performance.now() - asked)} ms`)
          }
          open.onerror = () => resolve(`refused (${open.error?.name})`)
        }
      })
    },
    { name: MAIN_DB, version: MAIN_VERSION + 1 }
  )
  // Settings reads the main database as it opens: the app's own read.
  await one.page.evaluate(() => {
    window.askNewer = true
    window.location.hash = '#settings'
  })
  const opened = await Promise.race([
    other.page.evaluate(() => window.newer),
    new Promise((resolve) => setTimeout(() => resolve('no answer'), 10000))
  ])
  // Let go at once: well before this page's own read hands its answer over.
  const took = Number(/opened in (\d+) ms/u.exec(opened)?.[1] ?? Infinity)
  check(took < 1000, `this page lets go at once, and the newer version opens (${opened})`)
  const notice = one.page.locator('[data-newer-version]')
  await notice.waitFor({ timeout: 5000 }).catch(() => null)
  const words = (await notice.textContent({ timeout: 1000 }).catch(() => '')) ?? ''
  check(
    /newer version of the app/u.test(words) && /Reload this page/u.test(words),
    `and the owner is told plainly to reload (${words.trim().slice(0, 70)}…)`
  )
  const loaded = one.page.waitForEvent('load')
  if (words) await notice.locator('button').click()
  else await one.page.reload()
  await loaded
  await one.page.waitForSelector('#root *', { timeout: 15000 })
  const reloaded = await one.page.evaluate(
    async (path) => (await import(path)).storedFileKeys(),
    RUN_STORE
  )
  check(
    (await notice.count()) === 0 && reloaded.join() === records.files[0].key,
    `the button reloads the page, which reads the database at its new version (${reloaded.length})`
  )
  await context.close()
}

await browser.close()
if (problems.length > 0) {
  console.error(`\nFAILED (${problems.length}):`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nThe main database is left as it was, and the Workroom keeps to its own.')
