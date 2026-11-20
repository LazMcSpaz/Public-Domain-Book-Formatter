/**
 * The Workroom's manners, for `scripts/check-workroom.mjs`: the device copy of
 * the notes, the dialogs' keys, tap targets on a phone, links in a sheet that
 * must stay words, a long JSON file, a rejected token, and no reading while
 * the page is hidden. Each takes the check's page and its `check(ok, what)`.
 * Every book is made up (`workroom-fixture.mjs`).
 */
import { madeUpNotes, stubShelf } from './workroom-fixture.mjs'

/** The first version's key in `localStorage`, which must be gone after a start. */
export const OLD_NOTES_KEY = 'pdbf.workroom.notes'

/** How many notes the Workroom's own database keeps (-1: no such database or store). */
export function notesInDatabase(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('pdbf-workroom')
        // Never create it from here: a missing database is an answer.
        open.onupgradeneeded = () => open.transaction.abort()
        open.onerror = () => resolve(-1)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('notes')) {
            db.close()
            return resolve(-1)
          }
          const count = db.transaction('notes').objectStore('notes').count()
          count.onsuccess = () => {
            db.close()
            resolve(count.result)
          }
          count.onerror = () => resolve(-1)
        }
      })
  )
}

/** Wait (up to ten seconds) for the database to hold `n` notes; what it holds. */
async function databaseReaches(page, n) {
  let held = -1
  for (let i = 0; i < 50; i++) {
    held = await notesInDatabase(page)
    if (held === n) break
    await page.waitForTimeout(200)
  }
  return held
}

/** Plant a big copy under the first version's key, as an old device would have. */
export function plantOldCopy(page) {
  return page.evaluate((key) => localStorage.setItem(key, 'x'.repeat(200_000)), OLD_NOTES_KEY)
}

/** After a start: the notes are in the Workroom's database, none in `localStorage`, the old copy gone. */
export async function checkDeviceCopy(page, check, shelf) {
  const held = await databaseReaches(page, shelf.notes.size)
  check(
    held === shelf.notes.size,
    `the device copy is in the Workroom's own database (${held} of ${shelf.notes.size} notes)`
  )
  const local = await page.evaluate(() => {
    let size = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? ''
      size += key.length + (localStorage.getItem(key) ?? '').length
    }
    return size
  })
  const old = await page.evaluate((key) => localStorage.getItem(key), OLD_NOTES_KEY)
  check(old === null, "the first version's copy in localStorage is removed at start-up")
  check(local < 4000, `localStorage holds settings only, no notes (${local} characters)`)
}

/** A note gone from the shelf goes from the device copy after the next read. */
export async function checkTrimmed(page, check, shelf, path) {
  shelf.notes.delete(path)
  await page.click('.wr-refresh')
  const held = await databaseReaches(page, shelf.notes.size)
  check(
    held === shelf.notes.size,
    `a note gone from the shelf is trimmed from the device copy (${held})`
  )
}

/** Settings' storage panel shows the copy and can forget it. */
export async function checkSettingsForgets(page, check, shelf) {
  await page.evaluate(() => (window.location.hash = '#settings'))
  const line = page.locator('[data-storage="workroom-notes"]')
  await line.waitFor({ timeout: 10000 })
  const words = (await line.textContent()) ?? ''
  check(
    words.includes(`${shelf.notes.size} status notes`),
    `Settings shows the Workroom's copy and its size (${words.slice(0, 80)}…)`
  )
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
  check((await notesInDatabase(page)) === 0, "Settings' storage panel forgets the copy")
  await page.evaluate(() => (window.location.hash = '#workroom'))
  await page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
}

/** Links in a sheet: a web link is a link; `javascript:` and `data:` stay words. */
export async function checkSheetLinks(page, check, file) {
  const found = await page.$eval(`[data-file="${file}"] .wr-md`, (sheet) => {
    const live = [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    const inside = (words) => {
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.textContent.includes(words))
          return n.parentElement.closest('a, button') ? 'live' : 'words'
      }
      return 'missing'
    }
    return { live, run: inside('Run this'), page: inside('A page'), loud: inside('Loud') }
  })
  check(
    found.live.length > 0 && found.live.every((h) => /^https?:\/\//u.test(h)),
    `only web links are live links in a sheet (${found.live.join(', ')})`
  )
  check(
    found.run === 'words' && found.loud === 'words',
    `a javascript: link is shown as plain words (${found.run}, ${found.loud})`
  )
  check(found.page === 'words', `a data: link is shown as plain words (${found.page})`)
}

/** One Escape closes only the topmost dialog; focus stays inside it and goes back after. */
export async function checkDialogKeys(page, check, file) {
  const inside = (sel) =>
    page.evaluate((s) => !!document.querySelector(s)?.contains(document.activeElement), sel)
  const fileOverlay = `.wr-overlay:has([data-file="${file}"])`
  check(await inside(fileOverlay), 'focus moves into the file when it opens')
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab')
  check(await inside(fileOverlay), 'Tab and Shift+Tab stay inside the topmost dialog')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => ({
    file: !!document.querySelector('[data-file]'),
    detail: !!document.querySelector('[data-detail]'),
    focus: document.activeElement?.matches('[data-detail] .wr-link')
      ? document.activeElement.textContent
      : (document.activeElement?.tagName ?? 'nothing')
  }))
  check(
    !after.file && after.detail,
    `one Escape closes the file and leaves the job under it open (file ${after.file}, job ${after.detail})`
  )
  check(
    after.focus === 'Readiness report',
    `focus goes back to the link that opened the file (${after.focus})`
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const last = await page.evaluate(() => ({
    detail: !!document.querySelector('[data-detail]'),
    run: document.activeElement?.closest('[data-run]')?.getAttribute('data-run') ?? null
  }))
  check(
    !last.detail && last.run === 'checkr01',
    `a second Escape closes the job, and focus goes back to its card (${last.run})`
  )
}

/** At phone width: every tap target 44 px tall or more, and no text under 13 px. */
export async function checkTapTargets(page, check) {
  const measure = () =>
    page.$$eval('.wr-back, .wr-refresh, .wr-link, .wr-latest button, .wr-close', (els) =>
      els
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => ({
          what: `${e.className || e.tagName.toLowerCase()} “${(e.textContent ?? '').trim().slice(0, 24)}”`,
          height: e.getBoundingClientRect().height
        }))
    )
  await page.click('[data-role="checker"] [data-run="checkr01"]')
  await page.waitForSelector('[data-detail="checkr01"]')
  const boxes = await measure()
  await page.keyboard.press('Escape')
  const small = boxes.filter((b) => b.height < 43.5)
  const kinds = new Set(boxes.map((b) => b.what.split(' ')[0]))
  check(
    kinds.size >= 5 && small.length === 0,
    `every tap target is at least 44 px tall at 390 px (${boxes.length} measured, ` +
      `${small.length ? small.map((b) => `${b.what} ${Math.round(b.height)}px`).join('; ') : 'none smaller'})`
  )
  const smallest = await page.evaluate(() => {
    let least = { size: 99, what: '' }
    for (const el of document.querySelectorAll('.wr *')) {
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!text || el.getClientRects().length === 0) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < least.size) least = { size, what: el.className || el.tagName }
    }
    return least
  })
  check(smallest.size >= 13, `no text under 13 px (smallest ${smallest.size}px, ${smallest.what})`)
}

/** A long JSON file: drawn up to the limit, no empty rows, one line for the rest. */
export async function checkLongJson(page, check, file, items) {
  await page.click('[data-view="waiting"] [data-run="managr01"] .wr-link')
  await page.waitForSelector(`[data-file="${file}"] .wr-json`, { timeout: 10000 })
  const seen = await page.$eval(`[data-file="${file}"] .wr-json`, (json) => ({
    rows: json.querySelectorAll('li').length,
    empty: [...json.querySelectorAll('li, dd')].filter((e) => !(e.textContent ?? '').trim()).length,
    more: json.querySelectorAll('[data-hidden]').length,
    hidden: Number(json.querySelector('[data-hidden]')?.getAttribute('data-hidden') ?? 0),
    words: json.querySelector('[data-hidden]')?.textContent ?? ''
  }))
  // The file, the two plain fields and the list are four values of the 3,000.
  check(
    seen.rows === 2996 && seen.empty === 0,
    `a long list stops at the limit, with no empty rows (${seen.rows} rows, ${seen.empty} empty)`
  )
  check(
    seen.more === 1 && seen.hidden === items - 2996 && /more entries not shown/u.test(seen.words),
    `one line says how many more are not shown (${seen.words.trim()})`
  )
  await page.keyboard.press('Escape')
}

/** A token GitHub rejects: the light says so, never "could not reach the shelf". */
export async function checkRejectedToken(page, check, shelf) {
  shelf.refuse = 401
  await page.click('.wr-refresh')
  await page.waitForSelector('[data-live="off"]', { timeout: 10000 }).catch(() => null)
  const light = (await page.locator('.wr-live').textContent()) ?? ''
  const band =
    (await page
      .locator('.wr-error')
      .textContent()
      .catch(() => '')) ?? ''
  check(
    /refused the token/u.test(light) && !/reach/u.test(light),
    `a rejected token is named beside the light (${light.replace(/Refresh|Reading…/u, '').trim()})`
  )
  check(/token was rejected/u.test(band), 'and in the band under it')
  shelf.refuse = 0
  await page.click('.wr-refresh')
  await page.waitForSelector('[data-live="on"]', { timeout: 10000 }).catch(() => null)
}

/** On its own page with a fake clock: nothing is read while the page is hidden. */
export async function checkHiddenPage(browser, check, base, seed) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  const page = await context.newPage()
  await page.addInitScript(seed)
  const shelf = { notes: madeUpNotes(), books: [], files: new Map() }
  const seen = await stubShelf(page, shelf)
  await page.clock.install()
  await page.goto(`${base}/#workroom`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-view="roles"]', { timeout: 15000 })
  const shown = (state) =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
  const before = seen.trees
  await shown('hidden')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.clock.runFor(5 * 60_000)
  await page.waitForTimeout(300)
  check(
    seen.trees === before,
    `no read while the page is hidden, for five minutes (${seen.trees - before})`
  )
  await shown('visible')
  for (let i = 0; i < 25 && seen.trees === before; i++) await page.waitForTimeout(200)
  check(seen.trees === before + 1, `one read when it is shown again (${seen.trees - before})`)
  await page.clock.runFor(61_000)
  for (let i = 0; i < 25 && seen.trees === before + 1; i++) await page.waitForTimeout(200)
  check(
    seen.trees === before + 2,
    `and every minute while it is on screen (${seen.trees - before})`
  )
  await context.close()
}
