/**
 * Does a driver reply survive the pipe a script captures it through?
 *
 * `drive.mjs` in client mode prints the browser's reply and exits. When stdout
 * is a file — a shell redirect — writes are synchronous and nothing is lost,
 * which is why every by-hand use of the driver looked fine for months. When it
 * is a **pipe**, which is what `execFileSync` gives it and what every script
 * that captures a reply uses, `console.log` is asynchronous and a
 * `process.exit()` behind it drops whatever has not drained.
 *
 * Measured on a real call before the fix: `words` over forty leaves came to
 * **2,133,802 bytes** down a redirect and **146,087** down a pipe, cut in the
 * middle of a token. The only reason anyone noticed is that truncated JSON does
 * not parse — a reply that happened to be cut at a boundary would have been a
 * silently short answer, which is the failure mode this repository keeps
 * finding the expensive way.
 *
 * No browser here on purpose. The fault is entirely in the client half of
 * `drive.mjs`, so the check stands up a stub on a port of its own that answers
 * with a large body, runs the real code path against it, and compares bytes.
 * `DRIVE_PORT` is what makes that possible.
 *
 *   node scripts/check-driver-output.mjs
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

// **Asynchronously**, because the stub is served by this same process: a
// synchronous `execFileSync` blocks the event loop, so the server never accepts
// the child's connection and the child hangs against a port that is listening
// and cannot answer. The first version of this check did exactly that and
// reported "nothing is listening".
const run = promisify(execFile)

const ROOT = resolve(import.meta.dirname, '..')
const PORT = 7913

// Big enough to be several pipe buffers, and shaped like a real reply so a
// truncation shows up as a parse failure rather than as a short string.
const body = JSON.stringify(
  {
    read: 'a stub',
    words: Object.fromEntries(
      Array.from({ length: 40 }, (_, leaf) => [
        String(leaf),
        Array.from({ length: 500 }, (_, i) => ({
          text: `word${i}`,
          confidence: 90,
          x0: i,
          y0: i,
          x1: i + 10,
          y1: i + 10
        }))
      ])
    )
  },
  null,
  2
)

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(body)
})
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok))

let failed = 0
try {
  const { stdout: out } = await run('node', [resolve(ROOT, 'scripts/drive.mjs'), 'words', '0'], {
    cwd: ROOT,
    env: { ...process.env, DRIVE_PORT: String(PORT) },
    maxBuffer: 1 << 28
  })

  if (out.trim().length !== body.length) {
    console.error(
      `FAIL  the reply came back as ${out.trim().length} bytes of ${body.length} — ` +
        'the tail was dropped on the way through the pipe'
    )
    failed = 1
  } else {
    console.log(`ok    ${body.length} bytes through a pipe, whole`)
  }

  try {
    const parsed = JSON.parse(out)
    const leaves = Object.keys(parsed.words ?? {}).length
    if (leaves !== 40) {
      console.error(`FAIL  ${leaves} leaves parsed, not 40`)
      failed = 1
    } else {
      console.log('ok    parses, and carries every leaf')
    }
  } catch (err) {
    console.error(`FAIL  the reply does not parse: ${err.message}`)
    failed = 1
  }
} finally {
  server.close()
}
process.exit(failed)
