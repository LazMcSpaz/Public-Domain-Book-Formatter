/**
 * One question: can a read of a book file answer the sha lookup for the write
 * that follows it?
 *
 * The flush does exactly that, in that order — `getText` for the book file,
 * then `putFile`, which asks the contents endpoint for the blob sha before it
 * writes. Both were GETs of one URL, differing only in the media type asked
 * for, a moment apart, from a browser with a cache in it.
 *
 * ## What actually happened, and what is imitated here
 *
 * Measured against the live API with curl, not imagined:
 *
 *   - GitHub's `ETag` for a path is the **blob sha**, and the same one is
 *     handed out whatever media type was asked for.
 *   - Given the ETag issued for `application/vnd.github.raw`, a conditional
 *     request for `application/vnd.github+json` is answered **`304 Not
 *     Modified`** — `Vary: Accept` in the response notwithstanding.
 *   - A `PUT` over a path that exists without a `sha` is refused `422`, in the
 *     wording that sends a reader looking at their own request:
 *     `Invalid request. "sha" wasn't supplied.`
 *
 * So a cache lenient about `Vary` — and the device this happened on was an
 * iPad — can serve the **book file** as the answer to "what is this path's
 * sha". It parses, being JSON, and has no sha in it. Every ruling the editor
 * made on *Isis Unveiled* failed to reach the shelf that way.
 *
 * **The stub plays that cache, and that is the honest part of this check.**
 * Chromium honours `Vary: Accept` properly and cannot be made to show the fault
 * at all — tried, with GitHub's exact `Cache-Control` and `Vary` headers and a
 * real origin behind `--host-resolver-rules`, and the second GET went to the
 * network unconditionally every time. A check that needs a particular browser
 * to be sloppy is a check that passes on the wrong machine. So what is asserted
 * is the property that does not depend on anybody's cache being correct: the
 * sha is asked for at a URL that a read of the file cannot have an answer for.
 * The stub answers any repeat of the read's URL with the file, whatever media
 * type is asked for, which is the worst a cache could do — and the write has to
 * carry a sha anyway.
 *
 *   node scripts/check-shelf-cache.mjs      (needs the dev server on :5173)
 */
import { chromium } from 'playwright'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const URL_BASE = process.env.PDBF_URL ?? 'http://localhost:5173'
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = 8443

// The file under test is JSON, so that its own body served in place of the
// envelope parses cleanly and yields an object with no `sha` in it. That is the
// book file's shape, and it is what made the fault silent.
const PATH = 'books/probe/book.json'
const BODY = JSON.stringify({ version: 15, run: { edits: [], rulings: [] } })
/** The same book after a ruling landed — what a second read must come back with. */
const LATER = JSON.stringify({ version: 15, run: { edits: [], rulings: ['leaf 209'] } })
const SHA = 'b7558071af729a61e188aaceb0643fd104e72d7f'

const certDir = mkdtempSync(join(tmpdir(), 'pdbf-cert-'))
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    join(certDir, 'key.pem'),
    '-out',
    join(certDir, 'cert.pem'),
    '-subj',
    '/CN=api.github.com',
    '-addext',
    'subjectAltName=DNS:api.github.com'
  ],
  { stdio: 'ignore' }
)

/** Every GET the stub answered, and how. */
const reads = []
/** What each URL was answered with the first time — the stale cache's memory. */
const answered = new Map()
/** The book file as it stands now; a second read must see the later one. */
let current = BODY
/** Every write it was asked to make, with whether it carried a sha. */
const writes = []
/** URLs already served as a raw read — what a lenient cache would hold. */
const cached = new Set()

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
  'access-control-allow-headers': 'authorization,accept,content-type,x-github-api-version',
  'access-control-max-age': '0'
}

const server = createServer(
  { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) },
  (req, res) => {
    if (process.env.PDBF_TRACE)
      console.log('  stub:', req.method, req.url, req.headers.accept ?? '')
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()

    if (req.method === 'GET') {
      const raw = String(req.headers.accept ?? '').includes('raw')
      // The 60-second window at its worst: a URL already answered is answered
      // again with what it said then. A read whose URL is unique cannot be.
      if (answered.has(req.url)) {
        reads.push({ url: req.url, raw, stale: true })
        return res
          .writeHead(200, { ...cors, 'content-type': 'application/vnd.github.raw; charset=utf-8' })
          .end(answered.get(req.url))
      }
      // The lenient cache. A URL already read raw answers with the file again,
      // whatever was asked for — which is what GitHub's one-ETag-per-path lets
      // such a cache do, and what put a book file where a sha should have been.
      const shadowed = cached.has(req.url)
      reads.push({ url: req.url, raw, shadowed })
      if (raw) cached.add(req.url)
      const body =
        raw || shadowed
          ? current
          : JSON.stringify({
              name: 'book.json',
              path: PATH,
              sha: SHA,
              size: BODY.length,
              content: '',
              encoding: 'none'
            })
      // Remembered *before* the reply goes out, not after it: written after
      // the `return` this sat dead, the stale path never ran, and the check
      // passed for a reason that had nothing to do with what it asserts.
      answered.set(req.url, body)
      return res
        .writeHead(200, {
          ...cors,
          etag: `"${SHA}"`,
          'cache-control': 'private, max-age=60, s-maxage=60',
          vary: 'Accept, Authorization, Cookie, X-GitHub-OTP, Accept-Encoding, Accept, X-Requested-With',
          'content-type':
            raw || shadowed
              ? 'application/vnd.github.raw; charset=utf-8'
              : 'application/json; charset=utf-8'
        })
        .end(body)
    }

    if (req.method === 'PUT') {
      let text = ''
      req.on('data', (chunk) => (text += chunk))
      req.on('end', () => {
        let sent = {}
        try {
          sent = JSON.parse(text)
        } catch {
          /* the status is the whole message */
        }
        const sha = typeof sent.sha === 'string' && sent.sha !== '' ? sent.sha : null
        writes.push({ sha })
        // The book moves on, as it does the moment a ruling lands.
        if (sha) current = LATER
        if (!sha) {
          return res
            .writeHead(422, { ...cors, 'content-type': 'application/json' })
            .end(JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }))
        }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end('{"content":{}}')
      })
      return
    }
    res.writeHead(405, cors).end()
  }
)
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready))

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    // The page believes it is talking to api.github.com, so this is a real
    // cross-origin request with the browser's own cache in the path.
    `--host-resolver-rules=MAP api.github.com 127.0.0.1:${PORT}`,
    '--ignore-certificate-errors',
    // Chromium picks the sandbox's egress proxy out of the environment, and
    // that proxy answers `OPTIONS` with a bare 405 — which arrives as a
    // preflight failure and reads exactly like a stub that will not talk.
    '--no-proxy-server'
  ]
})
const context = await browser.newContext({ ignoreHTTPSErrors: true })
const page = await context.newPage()
if (process.env.PDBF_TRACE) {
  page.on('console', (m) => console.log('  page:', m.text()))
  page.on('requestfailed', (r) => console.log('  failed:', r.url(), r.failure()?.errorText))
}
await page.goto(URL_BASE, { waitUntil: 'networkidle' })

const result = await page.evaluate(
  async ([repo, path]) => {
    const shelf = await import(`/@fs${repo}/src/platform/browser/shelf.ts`)
    const config = { repo: 'LazMcSpaz/Probe-Shelf', branch: 'main', token: 'probe' }
    // The flush's own order, and the whole point of the check.
    const text = await shelf.getText(config, path)
    try {
      await shelf.putFile(config, path, btoa('updated'), 'a ruling')
    } catch (err) {
      return { read: text === null ? null : text.length, error: String(err?.message ?? err) }
    }
    // A second flush, a moment later. This is the read that deleted a ruling.
    const again = await shelf.getText(config, path)
    return { read: text === null ? null : text.length, again, error: null }
  },
  [REPO, PATH]
)

await browser.close()
server.close()

const shadowed = reads.filter((r) => r.shadowed)
const stale = reads.filter((r) => r.stale)
const problems = []
if (result.read !== BODY.length)
  problems.push(`the book file read back as ${result.read}, not ${BODY.length}`)
if (stale.length > 0) {
  problems.push(`a read was answered out of the cache's memory (${stale[0].url})`)
}
if (result.again !== undefined && result.again !== LATER) {
  problems.push(
    'the second read came back with the earlier book — a flush folding its queue ' +
      'into that would delete whatever landed in between'
  )
}
if (shadowed.length > 0) {
  problems.push(
    `the sha was looked up at a URL a read of the file already answers (${shadowed[0].url})`
  )
}
if (writes.length !== 1) problems.push(`${writes.length} writes reached the shelf, expected 1`)
if (writes[0] && writes[0].sha === null) problems.push('the write went up with no sha')
if (result.error) problems.push(`the write failed: ${result.error}`)

console.log(`read back    : ${result.read} chars`)
console.log(
  `read again   : ${result.again === LATER ? 'the current book' : JSON.stringify(result.again)}`
)
console.log(
  `reads        : ${reads.map((r) => (r.raw ? 'raw' : 'json') + (r.shadowed ? '(shadowed)' : '')).join(', ')}`
)
console.log(`write carried: ${writes[0] ? (writes[0].sha ?? 'NO SHA') : '(no write)'}`)
console.log(`error        : ${result.error ?? 'none'}`)

if (problems.length > 0) {
  console.error('\nFAILED:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\nthe sha is asked for where no read of the book can answer.')
