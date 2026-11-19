#!/usr/bin/env node
/**
 * Is this book checked? Is it ready to upload? One command that runs the whole
 * list (`docs/process/checking.md`, C1 to C12 and R1 to R11) and writes one
 * report, `readiness.md`, beside the book (cleanup task 1, `docs/specs/readiness.md`).
 *
 *   node scripts/readiness.mjs <book-dir> [--stage checked|ready]
 *        [--interior <file>] [--softcover <file>] [--hardcover <file>] [--epub <file>]
 *        [--export-report <proof.json>] [--witness <w.json>]
 *        [--out <readiness.md>] [--scratch <dir>] [--shelf <shelf>]
 *
 * Each upload file is a local path, a key in the storage bucket, or the path
 * it had on the shelf (`STORAGE.tsv` gives its key); keys are fetched with
 * `storage.mjs get` into the scratch folder, and every file's SHA-256 goes in
 * the report. `--stage` defaults to `ready` when any upload file is named and
 * `checked` when none is. Driver checks run only when `drive.mjs serve` is up
 * with this book open. A check a person must do counts once `ledger.md` signs
 * it off (`readiness-signoff.ts` has the line's form).
 *
 * Exit 0 only when the stage asked for is reached; 1 when it is not; 2 when
 * the command could not start (a missing book, a file it cannot fetch).
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { driverFor, runner } from './lib/readiness-run.mjs'
import { pdfFacts, sha256Of, shelfCommit, storageRows, uploadFile } from './lib/readiness-files.mjs'
import { checkedStage, notRun } from './lib/readiness-checked.mjs'
import { readyStage } from './lib/readiness-ready.mjs'
import { readJsonSync, stripBom } from './lib/json-file.mjs'

register('./resolve-ts.mjs', import.meta.url)
const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROLES = ['interior', 'softcover', 'hardcover', 'epub']

function stop(message) {
  console.error(message)
  process.exit(2)
}

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) stop(`--${name} wants a value`)
  return v
}
const valued = new Set([...ROLES, 'stage', 'export-report', 'witness', 'out', 'scratch', 'shelf'])
const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]?.slice(2)))
if (positional.length !== 1) {
  stop(
    'usage: node scripts/readiness.mjs <book-dir> [--stage checked|ready] [--interior <file>] ' +
      '[--softcover <file>] [--hardcover <file>] [--epub <file>] [--export-report <proof.json>] ' +
      '[--witness <w.json>] [--out <readiness.md>] [--scratch <dir>]'
  )
}

const bookDir = resolve(positional[0])
const bookJson = join(bookDir, 'book.json')
if (!existsSync(bookJson)) stop(`${bookDir} holds no book.json: name a book folder on the shelf`)
const shelf = resolve(flag('shelf') ?? join(bookDir, '..', '..'))
const named = Object.fromEntries(ROLES.map((r) => [r, flag(r)]).filter(([, v]) => v))
const stage = flag('stage') ?? (Object.keys(named).length > 0 ? 'ready' : 'checked')
if (stage !== 'checked' && stage !== 'ready') stop('--stage is "checked" or "ready"')

/** Whether `target` is `root` or inside it, following links. */
function inside(root, target) {
  const real = (p) => {
    try {
      return realpathSync(p)
    } catch {
      return existsSync(dirname(p)) ? join(realpathSync(dirname(p)), basename(p)) : resolve(p)
    }
  }
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const rel = relative(fold(real(root)), fold(real(target)))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const out = resolve(flag('out') ?? join(bookDir, 'readiness.md'))
if (inside(TOOLS, out)) {
  stop(
    `Refusing to write the report at ${out}: that is inside the tools repository, which is public. Write it beside the book.`
  )
}
const scratch = resolve(flag('scratch') ?? mkdtempSync(join(tmpdir(), 'readiness-')))
if (inside(TOOLS, scratch) || inside(shelf, scratch)) {
  stop(`The scratch folder ${scratch} must be outside both repositories.`)
}
mkdirSync(scratch, { recursive: true })
mkdirSync(dirname(out), { recursive: true })

const core = {
  ...(await import('../src/core/coherence/readiness.ts')),
  ...(await import('../src/core/coherence/readiness-signoff.ts')),
  ...(await import('../src/core/coherence/readiness-report.ts')),
  ...(await import('../src/core/coherence/readiness-scans.ts'))
}
const storage = await import('../src/core/sync/storage.ts')
const { parseShape } = await import('../src/core/provenance/shape.ts')

const run = runner({ tools: TOOLS, shelf, scratch })
const loud =
  (r) =>
  (...args) => {
    const res = r(...args)
    console.error(`  ${res.code === 0 ? 'ok  ' : `exit ${res.code}`}  ${res.line}`)
    return res
  }
for (const k of ['node', 'viteNode', 'drive']) run[k] = loud(run[k])

const book = readJsonSync(bookJson)
const rows = storageRows(storage, shelf)
const files = {}
for (const [role, arg] of Object.entries(named)) {
  try {
    files[role] = uploadFile({ role, arg, shelf, scratch, rows, run })
    if (files[role].name.toLowerCase().endsWith('.pdf'))
      files[role].pages = (await pdfFacts(files[role].path)).pages
  } catch (e) {
    stop(e.message)
  }
}

console.error(
  `Readiness of ${basename(bookDir)}, asked for: ${stage === 'ready' ? 'ready to upload' : 'checked'}`
)
const bookSha = sha256Of(bookJson)
const driver = await driverFor(run, bookDir, book.scan?.fileName ?? null, bookSha)
let body = null
const ctx = {
  run,
  core,
  shelf,
  bookDir,
  bookJson,
  bookRel: relative(shelf, bookDir).split('\\').join('/'),
  folder: basename(bookDir),
  book,
  bookSha,
  shape: parseShape(book.run?.shape),
  scratch,
  sheets: dirname(out),
  driver,
  files,
  witness: flag('witness') ? resolve(flag('witness')) : null,
  exportReport: flag('export-report') ? resolve(flag('export-report')) : null,
  body: () => {
    if (body) return body
    const path = join(scratch, 'body.json')
    const res = run.viteNode('scripts/body-of.ts', [bookJson, path])
    body =
      res.code === 0 && existsSync(path)
        ? { ok: true, path }
        : {
            ok: false,
            why: `body-of.ts stopped (exit ${res.code})`,
            details: [res.err.slice(-400)]
          }
    return body
  }
}

let results = checkedStage(ctx)
if (stage === 'ready') results.push(...(await readyStage(ctx)))
else {
  const why = 'not run: only "checked" was asked for'
  results.push(
    ...core.READINESS_CHECKS.filter((k) => k.stage === 'ready').map((k) => notRun(k.id, why))
  )
}

const local = new Date()
const today = [local.getFullYear(), local.getMonth() + 1, local.getDate()]
  .map((n) => String(n).padStart(2, '0'))
  .join('-')
const ledgerPath = join(bookDir, 'ledger.md')
const reading = existsSync(ledgerPath)
  ? core.parseSignOffs(stripBom(readFileSync(ledgerPath, 'utf8')))
  : { signOffs: [], problems: [] }
const signed = core.applySignOffs(results, reading.signOffs, today)
results = signed.results
const decision = core.decideReadiness(results, stage)

const git = (dir) => {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}
const report = core.readinessReport(decision, {
  book: basename(bookDir),
  writtenAt: local.toISOString(),
  today,
  command: ['node scripts/readiness.mjs', ...argv.map(run.short)].join(' '),
  bookFingerprint: ctx.bookSha,
  toolsCommit: git(TOOLS),
  shelfCommit: shelfCommit(shelf),
  files: ROLES.filter((r) => files[r]).map((r) => ({
    role: r,
    source: files[r].source,
    shelfPath: files[r].from,
    sha256: files[r].sha256,
    bytes: files[r].bytes,
    pages: files[r].pages ?? null
  })),
  driver: driver.why,
  signOffNotes: [...reading.problems, ...signed.notes]
})
writeFileSync(out, report)

for (const res of decision.results) {
  const shown = res.signedOff ? 'SIGNED OFF' : res.outcome
  console.log(`${res.id.padEnd(4)} ${shown.padEnd(15)} ${res.summary.slice(0, 110)}`)
}
console.log(
  `\nVerdict: ${decision.verdict} (asked for: ${stage === 'ready' ? 'ready to upload' : 'checked'})`
)
console.log(`Report: ${out}`)
process.exit(decision.reachedAsked ? 0 : 1)
