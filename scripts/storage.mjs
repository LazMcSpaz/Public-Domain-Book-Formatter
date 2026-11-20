/**
 * The big-file store: put a file into the private R2 bucket, get it back,
 * list what is there, check a copy (decision 0051, `docs/specs/storage.md`).
 *
 *   node scripts/storage.mjs put <file> --kind <kind> [--shelf <dir>] [--from <path>]
 *   node scripts/storage.mjs get <key> <out>
 *   node scripts/storage.mjs list [prefix]
 *   node scripts/storage.mjs verify <key>
 *   node scripts/storage.mjs selftest
 *
 * Every file is named by its SHA-256 fingerprint (`sources/<sha256>.pdf`) and
 * checked against it after every move: `put` always fetches the copy back and
 * hashes it, and `get` keeps no download that does not match its name. With
 * `--shelf`, `put` adds a row to the shelf's `STORAGE.tsv`; `--from` is the
 * path the file had on the shelf (by default its path under `--shelf`).
 * `selftest` puts a small made-up file under `_test/`, gets it, checks it,
 * lists it and deletes it, leaving the bucket as it was.
 *
 * The requests are in `lib/r2.mjs`; the names and the list in
 * `src/core/sync/storage.ts`. The key is never written anywhere.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolsRefusal } from './lib/tools-guard.mjs'

// Node 22's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set when
// Node starts, and a cloud session reaches Cloudflare only through its proxy
// (which is also what adds the key). So, behind a proxy, run again with it set.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const script = fileURLToPath(import.meta.url)
  const again = spawnSync(
    process.execPath,
    ['--disable-warning=UNDICI-EHPA', ...process.execArgv, script, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } }
  )
  process.exit(again.status ?? 1)
}

register('./resolve-ts.mjs', import.meta.url)
const core = await import('../src/core/sync/storage.ts')
const r2 = await import('./lib/r2.mjs')
const { STORAGE_LIST, MAX_OBJECT_BYTES, TEST_KIND } = core
const { fail, hashOf } = r2

/** Refuse a destination inside the tools repository, which is public: book files never go in it. */
function refuseInsideTools(target, what) {
  const why = toolsRefusal(target, what)
  if (why) fail(why)
}

/**
 * A new file at `path`, to be written beside its destination and renamed
 * over it. Whatever is at that name first goes: a link planted there would
 * otherwise carry the write wherever it points. The open refuses anything
 * that appears in between. Returns the open file's number.
 */
function freshBeside(path) {
  try {
    rmSync(path, { force: true })
    return openSync(path, 'wx')
  } catch (e) {
    fail(`${path} is in the way and could not be cleared (${e.code}). Move it, then try again.`)
  }
}

const mb = (bytes) => (bytes / 1e6).toFixed(1)
const today = () => new Date().toISOString().slice(0, 10)

function readShelfList(shelf) {
  const path = join(shelf, STORAGE_LIST)
  if (!existsSync(path)) return []
  try {
    return core.parseStorageList(readFileSync(path, 'utf8'))
  } catch (e) {
    fail(`${path}: ${e.message} Fix the list before putting anything else in the bucket.`)
  }
}

/** The path a file had on the shelf: given, or its place under the shelf, or its name. */
function shelfPath(path, shelfDir, from) {
  if (from) return from
  const inside = shelfDir ? relative(shelfDir, path) : ''
  const under = inside && !inside.startsWith('..') && !isAbsolute(inside)
  return under ? inside.split(sep).join('/') : basename(path)
}

async function put(file, kind, { shelf = '', from = '' } = {}) {
  const path = resolve(file)
  if (!existsSync(path) || !statSync(path).isFile()) fail(`There is no file at ${path}.`)
  const size = statSync(path).size
  if (size > MAX_OBJECT_BYTES) {
    fail(
      `${basename(path)} is ${mb(size)} MB (${size} bytes), over the ${MAX_OBJECT_BYTES / 1e6} MB a file the storage API takes. Nothing was uploaded: keep it where it is and write down how to rebuild it, as the shelf's *-scans.md notes do.`
    )
  }
  const shelfDir = shelf ? resolve(shelf) : ''
  if (shelfDir && !existsSync(shelfDir)) fail(`There is no shelf folder at ${shelfDir}.`)
  if (shelfDir) refuseInsideTools(join(shelfDir, STORAGE_LIST), 'the storage list')
  if (shelfDir) readShelfList(shelfDir) // a broken list stops the run before the upload
  const named = shelfPath(path, shelfDir, from)

  const { sha256 } = await hashOf(createReadStream(path))
  let key
  try {
    key = core.storageKey(kind, sha256, core.extensionOf(path))
  } catch (e) {
    fail(e.message)
  }
  const there = await r2.find(key)
  let uploaded = false
  if (!there || there.size !== size) {
    await r2.upload(path, key, size)
    uploaded = true
  }
  let back = await hashOf(await r2.download(key))
  if (back.sha256 !== sha256 && !uploaded) {
    await r2.upload(path, key, size) // the copy already there was damaged: replace it
    uploaded = true
    back = await hashOf(await r2.download(key))
  }
  if (back.sha256 !== sha256 || back.bytes !== size) {
    fail(
      `The copy of ${basename(path)} fetched back from the bucket does not match the file (${back.bytes} bytes, fingerprint ${back.sha256}). Nothing was recorded; keep the original.`
    )
  }

  let listed = null
  if (shelfDir) {
    const row = { key, sha256, bytes: size, from: named, added: today() }
    const result = core.addStorageRow(readShelfList(shelfDir), row)
    const list = join(shelfDir, STORAGE_LIST)
    if (result.added) {
      // Written beside and renamed over, so a crash part-way cannot cut the list short.
      const tmp = `${list}.tmp`
      const fd = freshBeside(tmp)
      try {
        writeFileSync(fd, core.serializeStorageList(result.rows))
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, list)
    }
    listed = result.added ? 'added' : 'already listed'
  }
  return { key, sha256, bytes: size, uploaded, verified: true, listed, from: named }
}

async function get(key, out) {
  let target = resolve(out)
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, basename(key))
  refuseInsideTools(target, key)
  const named = core.fingerprintOf(key)
  if (existsSync(target)) {
    const here = named ? await hashOf(createReadStream(target)) : null
    if (here && here.sha256 === named) {
      return { key, out: target, bytes: here.bytes, sha256: named, verified: true, fetched: false }
    }
    fail(`${target} already exists and is not this file. Choose another name or move it first.`)
  }
  const stream = await r2.download(key)
  mkdirSync(dirname(target), { recursive: true })
  const part = `${target}.part`
  const sink = createWriteStream(part, { fd: freshBeside(part) })
  let got = null
  try {
    got = await hashOf(stream, sink)
  } catch (e) {
    fail(`The download of ${key} broke off (${e?.cause?.code ?? e?.message}). Try again.`)
  } finally {
    await new Promise((done) => sink.end(done))
    if (!got) rmSync(part, { force: true })
  }
  if (named && got.sha256 !== named) {
    rmSync(part, { force: true })
    fail(`The download of ${key} does not match its fingerprint (got ${got.sha256}). Not kept.`)
  }
  renameSync(part, target)
  const { bytes, sha256 } = got
  return { key, out: target, bytes, sha256, verified: !!named, fetched: true }
}

async function verify(key) {
  const named = core.fingerprintOf(key)
  if (!named) fail(`${key} carries no fingerprint, so there is nothing to check it against.`)
  const back = await hashOf(await r2.download(key))
  if (back.sha256 !== named) {
    fail(
      `${key} does NOT match its fingerprint: the bucket holds ${back.bytes} bytes hashing to ${back.sha256}.`
    )
  }
  return { key, bytes: back.bytes, sha256: back.sha256, verified: true }
}

async function selftest() {
  const dir = join(tmpdir(), `storage-selftest-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'selftest.bin')
  const stamp = Buffer.from(`storage self-test ${new Date().toISOString()}\n`)
  writeFileSync(file, Buffer.concat([stamp, randomBytes(4096)]))
  const steps = []
  let left = ''
  try {
    const p = await put(file, TEST_KIND)
    left = p.key
    steps.push(`put: ${p.key}, ${p.bytes} bytes, uploaded and fetched back; it matches`)
    const g = await get(p.key, join(dir, 'back.bin'))
    if (!readFileSync(g.out).equals(readFileSync(file))) fail('get: the file came back different.')
    steps.push('get: the file came back byte for byte')
    await verify(p.key)
    steps.push('verify: the copy in the bucket matches its fingerprint')
    const listed = await r2.listAll(`${TEST_KIND}/`)
    if (!listed.some((o) => o.key === p.key)) fail('list: the test file is not listed.')
    steps.push('list: the test file is listed')
    await r2.removeTestObject(p.key)
    if (await r2.find(p.key)) fail(`delete: ${p.key} is still in the bucket.`)
    left = ''
    steps.push('delete: the test file is gone; the bucket is as it was')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    for (const s of steps) console.log(s)
    if (left)
      await r2.removeTestObject(left).catch(() => console.error(`Could not delete ${left}.`))
  }
  console.log('Storage self-test passed.')
}

const USAGE = `Usage:
  node scripts/storage.mjs put <file> --kind <kind> [--shelf <dir>] [--from <path on the shelf>]
  node scripts/storage.mjs get <key> <out>
  node scripts/storage.mjs list [prefix]
  node scripts/storage.mjs verify <key>
  node scripts/storage.mjs selftest`

async function main() {
  const argv = process.argv.slice(2)
  const option = (name) => {
    const i = argv.indexOf(name)
    if (i < 0) return ''
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) fail(`${name} needs a value.\n${USAGE}`)
    argv.splice(i, 2)
    return value
  }
  const kind = option('--kind')
  const shelf = option('--shelf')
  const from = option('--from')
  const [verb, a, b] = argv
  if (verb === 'put' && a && kind) console.log(JSON.stringify(await put(a, kind, { shelf, from })))
  else if (verb === 'get' && a && b) console.log(JSON.stringify(await get(a, b)))
  else if (verb === 'list') {
    const found = await r2.listAll(a ?? '')
    for (const o of found) console.log(`${o.key}\t${o.size}`)
    console.error(`${found.length} object(s)${a ? ` under ${a}` : ''}`)
  } else if (verb === 'verify' && a) console.log(JSON.stringify(await verify(a)))
  else if (verb === 'selftest') await selftest()
  else fail(USAGE)
}

try {
  await main()
} catch (e) {
  console.error(r2.hidden(e instanceof r2.Stop ? e.message : (e?.stack ?? e)))
  process.exitCode = 1
}
