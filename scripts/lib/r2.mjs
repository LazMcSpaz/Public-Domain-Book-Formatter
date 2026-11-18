/**
 * The private R2 bucket through Cloudflare's REST API, with Node's own fetch:
 * list, find, fetch, put and delete objects, and fingerprint a stream. The
 * commands built on it are in `scripts/storage.mjs`.
 *
 * The key is never written anywhere. In a cloud session the network proxy
 * adds the `Authorization` header for api.cloudflare.com, so none is sent; on
 * the owner's computer it comes from `CLOUDFLARE_API_TOKEN`. The account id is
 * found from the key (or `CLOUDFLARE_ACCOUNT_ID`) and blanked out of anything
 * printed (`hidden`).
 *
 * Load it after `resolve-ts.mjs` is registered: it imports core.
 */
import { createHash } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'

const core = await import('../../src/core/sync/storage.ts')
const { STORAGE_BUCKET, TEST_KIND } = core

const API = 'https://api.cloudflare.com/client/v4'
const TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim()
let account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || ''

const KEY_HELP = (status) =>
  [
    `The storage key is missing, or it has no access to the bucket ${STORAGE_BUCKET} (Cloudflare answered ${status}).`,
    'On your own computer, set the key in the window you run node from, then run the command again:',
    '  PowerShell:  $env:CLOUDFLARE_API_TOKEN = "<the token>"',
    '  bash:        export CLOUDFLARE_API_TOKEN="<the token>"',
    'The token needs R2 read and write access on the account (docs/process/sessions.md, "Storage key on your own computer").',
    "In a cloud session the network adds the key: it must be saved for api.cloudflare.com in the session's environment."
  ].join('\n')

/** A stop with a plain message; the command prints it once cleanup has run. */
export class Stop extends Error {}
export function fail(message) {
  throw new Stop(String(message))
}

/** Text with the account id blanked out, so it never reaches a log. */
export const hidden = (text) =>
  account ? String(text).replaceAll(account, '<account>') : String(text)

/** One request, tried up to three times when the network or Cloudflare stumbles. */
async function call(url, init = () => ({})) {
  for (let attempt = 1; ; attempt++) {
    const req = init()
    const headers = { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...req.headers }
    let res = null
    let why = ''
    try {
      res = await fetch(url, { ...req, headers })
    } catch (e) {
      why = e?.cause?.code ?? e?.message ?? String(e)
    }
    if (res && (res.status === 401 || res.status === 403)) fail(KEY_HELP(res.status))
    if (res && res.status < 500 && res.status !== 429) return res
    if (res) why = `Cloudflare answered ${res.status}`
    if (attempt >= 3) fail(`Could not reach the storage bucket (${why}). Try again in a minute.`)
    await new Promise((done) => setTimeout(done, 2000 * attempt))
  }
}

/** The JSON body of a reply, byte-order mark stripped; a failed reply stops the run. */
async function jsonOf(res, doing) {
  const text = await res.text()
  let body
  try {
    body = JSON.parse(core.stripBom(text))
  } catch {
    fail(`${doing}: Cloudflare answered ${res.status} with something that is not JSON.`)
  }
  if (!res.ok || body.success === false) {
    const errors = body.errors ?? []
    // 6003/6111: the Authorization header is not a token at all (a mistyped key).
    const codes = errors.flatMap((e) => [e.code, ...(e.error_chain ?? []).map((c) => c.code)])
    if (codes.includes(6003) || codes.includes(6111)) fail(KEY_HELP(res.status))
    const said = errors.map((e) => e.message).join('; ') || `status ${res.status}`
    fail(`${doing}: ${said}`)
  }
  return body
}

async function accountId() {
  if (account) return account
  const body = await jsonOf(await call(`${API}/accounts`), 'Finding the Cloudflare account')
  const found = body.result ?? []
  if (found.length !== 1) {
    fail(
      `The storage key can see ${found.length} Cloudflare accounts; this command needs exactly one. Set CLOUDFLARE_ACCOUNT_ID to the account's id (it is kept on the shelf).`
    )
  }
  account = found[0].id
  return account
}

async function objectsUrl(key = '') {
  const base = `${API}/accounts/${await accountId()}/r2/buckets/${STORAGE_BUCKET}/objects`
  return key ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : base
}

/** Every object under a prefix, `{ key, size }`, following the pages. */
export async function listAll(prefix = '') {
  const found = []
  let cursor = ''
  do {
    const query = new URLSearchParams({ per_page: '1000' })
    if (prefix) query.set('prefix', prefix)
    if (cursor) query.set('cursor', cursor)
    const body = await jsonOf(await call(`${await objectsUrl()}?${query}`), 'Listing the bucket')
    for (const o of body.result ?? []) found.push({ key: o.key, size: Number(o.size) })
    cursor = body.result_info?.is_truncated ? (body.result_info.cursor ?? '') : ''
  } while (cursor)
  return found
}

/** The object with exactly this key, `{ key, size }`, or null. */
export async function find(key) {
  const query = new URLSearchParams({ per_page: '10', prefix: key })
  const body = await jsonOf(await call(`${await objectsUrl()}?${query}`), `Looking for ${key}`)
  const hit = (body.result ?? []).find((o) => o.key === key)
  return hit ? { key, size: Number(hit.size) } : null
}

/** Fingerprint and size of a stream, read once; each chunk also goes to `sink` if given. */
export async function hashOf(stream, sink = null) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of stream) {
    hash.update(chunk)
    bytes += chunk.length
    if (sink && !sink.write(chunk)) await new Promise((done) => sink.once('drain', done))
  }
  return { sha256: hash.digest('hex'), bytes }
}

/** The object's bytes as a stream; a plain stop when the bucket has no such key. */
export async function download(key) {
  const res = await call(await objectsUrl(key))
  if (res.status === 404) fail(`There is no ${key} in the bucket.`)
  if (!res.ok) await jsonOf(res, `Fetching ${key}`)
  return Readable.fromWeb(res.body)
}

/** Put a file under a key, streamed from disk; stops unless the bucket took every byte. */
export async function upload(file, key, bytes) {
  const blob = await openAsBlob(file)
  const res = await call(await objectsUrl(key), () => ({
    method: 'PUT',
    body: blob,
    headers: { 'content-type': 'application/octet-stream' }
  }))
  const body = await jsonOf(res, `Uploading ${basename(file)}`)
  if (Number(body.result?.size) !== bytes) {
    fail(`Uploading ${basename(file)}: the bucket took ${body.result?.size} bytes of ${bytes}.`)
  }
}

/** Delete one self-test object. Nothing else is ever deleted from here (decision 0052). */
export async function removeTestObject(key) {
  if (!core.isTestKey(key)) {
    fail(`Refusing to delete ${key}: only ${TEST_KIND}/ objects are deleted here.`)
  }
  await jsonOf(await call(await objectsUrl(key), () => ({ method: 'DELETE' })), `Deleting ${key}`)
}
