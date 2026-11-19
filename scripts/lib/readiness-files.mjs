/**
 * The upload files for `readiness.mjs`: found from what the session named (a
 * local path, a storage key, or the path the file had on the shelf, which
 * `STORAGE.tsv` maps to its key), fetched from the bucket into the scratch
 * folder, fingerprinted, and measured.
 *
 * Also the one question git can answer about a file: has the book file (or a
 * cover spec) changed since this exact file was committed beside it?
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const SHA = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/u

export function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The rows of the shelf's `STORAGE.tsv`, read with the core's own parser. */
export function storageRows(core, shelf) {
  const path = join(shelf, core.STORAGE_LIST)
  return existsSync(path) ? core.parseStorageList(readFileSync(path, 'utf8')) : []
}

/**
 * One upload file, ready to check: `{ role, source, path, sha256, bytes, from }`,
 * where `from` is the path it had on the shelf when the list knows one. Throws
 * with what to do when the file cannot be found or fetched.
 */
export function uploadFile({ role, arg, shelf, scratch, rows, run }) {
  const posix = (p) => p.split('\\').join('/')
  let path = null
  let key = null
  if (existsSync(arg) && statSync(arg).isFile()) path = resolve(arg)
  else {
    const want = posix(arg).replace(/^\.\//u, '')
    const local = posix(relative(shelf, resolve(arg)))
    const byFrom = rows.filter((r) => r.from === want || r.from === local)
    if (byFrom.length > 1) {
      throw new Error(
        `${role}: STORAGE.tsv lists ${byFrom.length} files that were at ${want}; name one by its key: ${byFrom.map((r) => r.key).join(', ')}`
      )
    }
    const row = rows.find((r) => r.key === want) ?? byFrom[0]
    if (row) key = row.key
    else if (SHA.test(want) && want.includes('/')) key = want
    else {
      throw new Error(
        `${role}: "${arg}" is not a file here, a key in the bucket, or a shelf path STORAGE.tsv lists`
      )
    }
    const dir = join(scratch, 'files')
    mkdirSync(dir, { recursive: true })
    path = join(dir, `${role}-${basename(key)}`)
    if (!existsSync(path)) {
      const got = run.node('scripts/storage.mjs', ['get', key, path])
      if (got.code !== 0 || !existsSync(path)) {
        throw new Error(
          `${role}: could not fetch ${key} from the bucket: ${`${got.err}\n${got.out}`.trim().split('\n').slice(-2).join(' ')}`
        )
      }
    }
  }
  const sha256 = sha256Of(path)
  const listed = rows.find((r) => r.sha256 === sha256)
  const inShelf = posix(relative(shelf, path))
  const from = listed?.from ?? (!inShelf.startsWith('..') && !isAbsolute(inShelf) ? inShelf : null)
  return {
    role,
    source: key ?? arg,
    path,
    sha256,
    bytes: statSync(path).size,
    from,
    name: from ? basename(from) : basename(path)
  }
}

/** A PDF's page count and the date it says it was made, through pdf-lib. */
export async function pdfFacts(path) {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(readFileSync(path), {
    ignoreEncryption: true,
    updateMetadata: false
  })
  return { pages: doc.getPageCount(), created: doc.getCreationDate() ?? null }
}

function git(shelf, args) {
  const r = spawnSync('git', ['-C', shelf, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return r.status === 0 ? r.stdout.trim() : null
}

/** The shelf's commit, or null when it is not a git checkout. */
export function shelfCommit(shelf) {
  return git(shelf, ['rev-parse', '--short', 'HEAD'])
}

/**
 * Whether `dependsOn` (shelf-relative) changed after this exact file was
 * committed at `from`: `{ state: 'in step' | 'stale' | 'unknown', why }`.
 *
 * The file is matched by its git blob, so an earlier export committed at the
 * same path does not count. A change not yet committed counts as a change.
 */
export function inStep(shelf, file, dependsOn) {
  if (!file.from) return { state: 'unknown', why: 'the shelf has no record of where this file was' }
  const blob = shelfCommit(shelf) && git(shelf, ['hash-object', file.path])
  if (!blob) return { state: 'unknown', why: 'the shelf is not a git checkout' }
  const commits = (
    git(shelf, ['log', '--format=%H', '--diff-filter=AM', '-n', '60', '--', file.from]) ?? ''
  )
    .split('\n')
    .filter(Boolean)
  const at = commits.find((c) => git(shelf, ['rev-parse', `${c}:${file.from}`]) === blob)
  if (!at) {
    return { state: 'unknown', why: `this exact file was never committed at ${file.from}` }
  }
  const later = (git(shelf, ['log', '--format=%h %cs %s', `${at}..HEAD`, '--', dependsOn]) ?? '')
    .split('\n')
    .filter(Boolean)
  const dirty = (git(shelf, ['status', '--porcelain', '--', dependsOn]) ?? '').trim()
  const where = `committed at ${file.from} in ${at.slice(0, 7)}`
  if (later.length === 0 && !dirty) {
    return { state: 'in step', why: `${where}; ${dependsOn} has not changed since` }
  }
  return {
    state: 'stale',
    why:
      `${where}; ${dependsOn} changed after it` +
      (later.length ? `: ${later.slice(0, 5).join('; ')}${later.length > 5 ? '; …' : ''}` : '') +
      (dirty ? ' (and has changes not committed)' : '')
  }
}

/** Whether `path` (shelf-relative) has changes not committed; null when git cannot say. */
export function uncommitted(shelf, path) {
  const out = git(shelf, ['status', '--porcelain', '--', path])
  return out === null ? null : out.length > 0
}

/** When `path` (shelf-relative) last changed in a commit, as a Date, or null. */
export function lastCommitted(shelf, path) {
  const iso = git(shelf, ['log', '-1', '--format=%cI', '--', path])
  return iso ? new Date(iso) : null
}
