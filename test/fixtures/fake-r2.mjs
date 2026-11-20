/**
 * A stand-in for Cloudflare's storage API, loaded with `node --import` ahead
 * of `scripts/storage.mjs` in `test/storage-script.test.ts`, so a test never
 * sends a request off the machine. It replaces `fetch` before the script runs.
 *
 * - `FAKE_R2=trap`: any request at all is the fault under test. It prints
 *   "A REQUEST WAS SENT" and stops with exit code 97.
 * - `FAKE_R2=<folder>`: the bucket is that folder, each object a file under
 *   its key. Only what `scripts/lib/r2.mjs` asks is answered: list by prefix,
 *   put, get.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const mode = process.env.FAKE_R2
if (!mode)
  throw new Error('fake-r2.mjs needs FAKE_R2 (trap, or the folder that stands for the bucket).')

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function objectsIn(root, dir = root) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return objectsIn(root, path)
    return [{ key: relative(root, path).split(sep).join('/'), size: statSync(path).size }]
  })
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const method = init.method ?? 'GET'
  if (mode === 'trap') {
    process.stderr.write(`A REQUEST WAS SENT: ${method} ${url.host}${url.pathname}\n`)
    process.exit(97)
  }
  const m = /\/r2\/buckets\/[^/]+\/objects(?:\/(.+))?$/u.exec(url.pathname)
  if (!m) return json(404, { success: false, errors: [{ code: 0, message: 'not faked' }] })
  const key = m[1] ? m[1].split('/').map(decodeURIComponent).join('/') : ''
  if (!key && method === 'GET') {
    const prefix = url.searchParams.get('prefix') ?? ''
    const result = objectsIn(mode).filter((o) => o.key.startsWith(prefix))
    return json(200, { success: true, result, result_info: { is_truncated: false } })
  }
  const file = join(mode, ...key.split('/'))
  if (method === 'PUT') {
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer())
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    return json(200, { success: true, result: { key, size: bytes.length } })
  }
  if (method === 'GET') {
    if (!existsSync(file))
      return json(404, { success: false, errors: [{ code: 0, message: 'no such key' }] })
    return new Response(readFileSync(file), { status: 200 })
  }
  return json(405, { success: false, errors: [{ code: 0, message: `${method} is not faked` }] })
}
