/**
 * Running the existing checks for `readiness.mjs`: a child process per
 * command, its exit code and its output kept, and the driver asked whether it
 * is up and which book it has open.
 *
 * Nothing here judges a result; each check in `readiness-checked.mjs` and
 * `readiness-ready.mjs` reads the exit code and the output it gets back.
 */
import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const NOISE =
  /MODULE_TYPELESS|Reparsing as ES|eliminate this warning|trace-warnings|CJS build of Vite|vite\.dev\/guide\/troubleshooting|^\s*$/u

/** The output's lines, without Node's and Vite's warnings. */
export function lines(text) {
  return String(text ?? '')
    .split(/\r?\n/u)
    .filter((l) => !NOISE.test(l))
}

/** The last `n` lines worth reading of a run's output. */
export function tail(res, n = 12) {
  const all = lines(`${res.out}\n${res.err}`)
  return all.length > n ? [`… ${all.length - n} lines before`, ...all.slice(-n)] : all
}

/**
 * A runner bound to the two repositories, so the commands it reports read as
 * a person would type them: paths inside the shelf start `<shelf>/`, paths in
 * the scratch folder `<scratch>/`.
 */
export function runner({ tools, shelf, scratch, timeoutMs = 20 * 60 * 1000 }) {
  const short = (a) => {
    const s = String(a)
    for (const [root, name] of [
      [scratch, '<scratch>'],
      [shelf, '<shelf>']
    ]) {
      const rel = root ? relative(root, s) : '..'
      if (isAbsolute(s) && !rel.startsWith('..') && !isAbsolute(rel)) {
        return rel ? `${name}/${rel.split('\\').join('/')}` : name
      }
    }
    return /\s/u.test(s) ? JSON.stringify(s) : s
  }
  const run = (cmd, args, shown) => {
    const r = spawnSync(cmd, args, {
      cwd: tools,
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      timeout: timeoutMs,
      env: process.env
    })
    const line = shown ?? [cmd, ...args].map(short).join(' ')
    if (r.error) return { code: null, out: '', err: String(r.error.message), line }
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', line }
  }
  const viteNodeBin = join(tools, 'node_modules', 'vite-node', 'vite-node.mjs')
  return {
    short,
    run,
    node: (script, args) =>
      run(process.execPath, [script, ...args], ['node', script, ...args].map(short).join(' ')),
    viteNode: (script, args) => {
      const shown = ['npx vite-node --config vitest.config.ts', script, ...args.map(short)].join(
        ' '
      )
      if (!existsSync(viteNodeBin)) {
        return {
          code: null,
          out: '',
          err: `vite-node is not installed (${viteNodeBin})`,
          line: shown
        }
      }
      return run(
        process.execPath,
        [viteNodeBin, '--config', 'vitest.config.ts', script, ...args],
        shown
      )
    },
    drive: (verb, args = []) => {
      const res = run(
        process.execPath,
        ['scripts/drive.mjs', verb, ...args],
        ['node scripts/drive.mjs', verb, ...args.map(short)].join(' ')
      )
      let json = null
      try {
        json = JSON.parse(res.out)
      } catch {
        /* an error line, not a result */
      }
      return { ...res, json }
    }
  }
}

/** Whether something answers on the driver's port, within a second. */
export function portOpen(port) {
  return new Promise((done) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    const finish = (ok) => {
      sock.destroy()
      done(ok)
    }
    sock.setTimeout(1000, () => finish(false))
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })
}

const same = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return resolve(a) === resolve(b)
  }
}

/** Why the driver checks do not run when its copy is not this file's bytes. */
export const STALE_COPY =
  "the driver's copy is not this book file: load it again (`drive.mjs load <book.json> <scan>`)"

/**
 * Whether the driver can run this book's checks: up, holding this book, and
 * holding it as this `book.json` is today. `drive.mjs load` (and `save`, over
 * the file the book came from) records the SHA-256 of the file's bytes; a copy
 * with no fingerprint, or another one, is stale, and a check run on it could
 * pass while the report fingerprints a different file. Edits made in the
 * driver and not saved leave the fingerprint as it was, so save first.
 * `{ ok, why }`; `why` is the line the report prints either way.
 */
export async function driverFor(run, bookDir, scanName, bookSha) {
  const port = Number(process.env.DRIVE_PORT ?? 7788)
  if (!(await portOpen(port))) {
    return {
      ok: false,
      why: `not running (nothing on port ${port}); start it with \`node scripts/drive.mjs serve &\` and \`drive.mjs load\` this book`
    }
  }
  const res = run.drive('book')
  if (res.code !== 0 || !res.json) {
    return {
      ok: false,
      why: `on port ${port}, but \`drive.mjs book\` failed: ${tail(res, 2).join(' ')}`
    }
  }
  const { bookFile, current } = res.json
  const mine = join(bookDir, 'book.json')
  if (!((bookFile && same(bookFile, mine)) || (!bookFile && current && current === scanName))) {
    return {
      ok: false,
      why: `up on port ${port}, but it has ${current ?? 'no book'} open${bookFile ? ` (from ${bookFile})` : ''}, not this book; \`drive.mjs load\` it first`
    }
  }
  const held = res.json.bookSha
  if (typeof held !== 'string' || !bookSha || held.toLowerCase() !== bookSha.toLowerCase()) {
    // A driver started before it recorded fingerprints answers without the
    // field at all, and loading again there would record nothing.
    const old =
      'bookSha' in res.json
        ? ''
        : '; this driver is older than that record, so restart it first (`drive.mjs quit`, then `serve`)'
    return { ok: false, why: `up on port ${port}, but ${STALE_COPY}${old}` }
  }
  return { ok: true, why: `up on port ${port}, with this book open (${current}) as it is on disk` }
}
