#!/usr/bin/env node
/**
 * Does the installed app actually open with the network gone?
 *
 * The one question about a service worker that cannot be answered by reading
 * it. The first version of `public/sw.js` cached the shell, registered
 * cleanly, reported an active worker and a correct scope — and opened offline
 * as a blank page, because on a first visit the page fetches its modules
 * before the worker takes control, so the worker never saw them. Everything
 * that could be inspected looked right; only loading it offline said otherwise.
 *
 *   npm run build            # with PUBLIC_BASE set as the deploy sets it
 *   node scripts/check-install.mjs [base-path]
 *
 * It serves `dist/` under the sub-path GitHub Pages uses — the base is where
 * this breaks, since an absolute `/sw.js` is a 404 there and fails silently —
 * loads it once online, then reloads with the network cut and asks whether the
 * app drew anything. Exits non-zero when it did not.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = (process.argv[2] ?? '/Public-Domain-Book-Formatter/').replace(/\/*$/, '/')
const PORT = Number(process.env.INSTALL_CHECK_PORT ?? 8099)

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end()
    return
  }
  const rest = url.pathname.slice(BASE.length) || 'index.html'
  const file = join(REPO, 'dist', rest)
  try {
    const bytes = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(bytes)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(PORT, done))

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const page = await browser.newPage()
const home = `http://localhost:${PORT}${BASE}`
await page.goto(home, { waitUntil: 'networkidle' })
// The worker installs and precaches after the page settles; without this the
// check races it and reports a failure that is only earliness.
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 })
await page.waitForTimeout(1500)

const online = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration()
  const href = document.querySelector('link[rel=manifest]')?.href
  const manifest = href ? await (await fetch(href)).json() : null
  return {
    scope: registration?.scope ?? null,
    manifest: href ?? null,
    icon: manifest ? new URL(manifest.icons[0].src, href).href : null,
    caches: await caches.keys()
  }
})

await page.context().setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
await page.waitForTimeout(1200)
const offline = await page.evaluate(() => ({
  drew: (document.getElementById('root')?.childElementCount ?? 0) > 0,
  text: document.body.innerText.slice(0, 60).replace(/\s+/g, ' ')
}))

await browser.close()
server.close()

console.log(JSON.stringify({ base: BASE, online, offline }, null, 2))
if (!online.scope || !online.manifest || !online.icon) {
  console.error('\nThe worker or the manifest did not resolve under the base path.')
  process.exit(1)
}
if (!offline.drew) {
  console.error('\nThe app did not draw anything with the network gone.')
  process.exit(1)
}
console.log('\nOpens offline.')
