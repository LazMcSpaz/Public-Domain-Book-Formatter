/**
 * The service worker: the book opens on a train.
 *
 * Reading is the one pass here with no reason to need the network once the book
 * is on the device — no scan to fetch, no OCR, no layout — so an installed app
 * that will not start without a connection fails at the one job it was
 * installed for.
 *
 * Three rules, and the reasons matter more than the code:
 *
 *  - **Anything cross-origin is passed straight through, untouched.** The shelf
 *    is api.github.com and it is the source of truth; a cached answer from it
 *    would be a book file that is quietly out of date, which is the one thing
 *    this whole design refuses. Caching a *write* would be worse still.
 *  - **Navigations are network-first.** A stale `index.html` pinned in a cache
 *    is how a deployed fix never reaches the device — the page keeps loading
 *    the old script names forever. The cached copy is the fallback for being
 *    offline, not the default.
 *  - **Hashed assets are cache-first**, because Vite names them by content and
 *    a file whose name is its hash cannot go stale. That is what makes this
 *    safe without a build-time manifest to keep in step.
 */
const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`

/**
 * The shell, and the scripts it names.
 *
 * Caching only `./` was the first attempt and left an installed app that opens
 * offline as a blank page — measured, not guessed. The HTML was in the cache
 * and its script was not, because on a first visit the page fetches its modules
 * *before* this worker takes control, so nothing here ever sees them. A second
 * online visit would have fixed it, which is precisely the kind of failure that
 * looks like the feature working.
 *
 * So the index is read at install time and the assets it names are cached with
 * it. The build hashes those filenames, so there is no list here to drift out
 * of step with what was emitted — the page states its own dependencies, and
 * this believes the page.
 */
async function precache() {
  const cache = await caches.open(SHELL)
  await cache.addAll(['./', './manifest.webmanifest'])
  const html = await (await cache.match('./')).text()
  const assets = new Set()
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const href = match[1]
    // Only this origin's real files: `data:` icons are already in the HTML, and
    // the manifest is cached above.
    if (/^(data:|https?:|\/\/)/.test(href)) continue
    if (/\.(js|mjs|css)$/.test(href)) assets.add(href)
  }
  // Individually, so one asset that will not fetch does not throw away the
  // whole install — `addAll` is all-or-nothing, and a shell missing one
  // stylesheet still opens.
  await Promise.all(
    [...assets].map((href) =>
      fetch(href)
        .then((response) => (response.ok ? cache.put(href, response) : undefined))
        .catch(() => undefined)
    )
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !n.endsWith(VERSION)).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Cross-origin is the shelf, and the shelf is never cached. Also not ours to
  // second-guess: a fetch this worker does not understand is a fetch it should
  // not be answering.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL).then((cache) => cache.put('./', copy))
          return response
        })
        .catch(() => caches.match('./').then((hit) => hit ?? Response.error()))
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        // Only a real answer is kept. An opaque or failed response cached here
        // would be served back as the file forever, which looks exactly like a
        // corrupted install.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(ASSETS).then((cache) => cache.put(request, copy))
        }
        return response
      })
    })
  )
})
