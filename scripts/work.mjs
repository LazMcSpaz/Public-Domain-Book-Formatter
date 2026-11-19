/**
 * Status notes: each run of an agent leaves one on the shelf, at its start,
 * as it goes and when it stops (`docs/specs/status-notes.md`).
 *
 *   node scripts/work.mjs start --role <role> --book <folder> --stage <stage> --job "<words>"
 *        [--from <run>] [--done <n>] [--of <m> --unit <word>] [--note "<words>"]
 *   node scripts/work.mjs progress <run> [--done <n>] [--of <m>] [--unit <word>] [--note "<words>"]
 *   node scripts/work.mjs ask <run> --what "<what the owner must do>" --where <shelf path>...
 *   node scripts/work.mjs done <run> --result "<one line>" [--file <shelf path>]...
 *   node scripts/work.mjs fail <run> --result "<why>" [--file <shelf path>]...
 *   node scripts/work.mjs handoff <run> --to <role> --result "<one line>" [--run <id>] [--note] [--file]...
 *   node scripts/work.mjs list [--book <folder>] [--role <role>] [--stale-hours <n>] [--json]
 *   node scripts/work.mjs show <run> [--json]
 *
 * Every verb takes `--shelf <dir>`; without it the shelf is `$SHELF`, then
 * the shelf checked out beside the tools, then `~/Public-Domain-Books-Storage`.
 * A note is checked by core's strict parser before it is written, a new one
 * never replaces a file already there, and nothing is ever written inside
 * the tools repository. The command does not commit or push: the session
 * commits its notes with its work.
 *
 * The note, its changes and the Workroom's views are in `src/core/work/`;
 * where notes live is `src/core/sync/work-paths.ts`; the wording is in
 * `lib/work-print.mjs`.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { printRun, printWorkroom, progressText } from './lib/work-print.mjs'
import { shelfNotes } from './lib/work-shelf.mjs'

register('./resolve-ts.mjs', import.meta.url)
const work = await import('../src/core/work/index.ts')
const paths = await import('../src/core/sync/work-paths.ts')

class Stop extends Error {}
const fail = (message) => {
  throw new Stop(message)
}
const COMMIT = 'Commit the note with your work: this command does not commit or push.'
const { findShelf, linkFrom, filesFrom, noteFiles, findNote, writeNote } = shelfNotes({
  work,
  paths,
  fail
})

// ------------------------------------------------------------------ options

const FLAGS = new Set(['--json'])
const REPEATS = new Set(['--where', '--file'])
const ALLOWED = {
  start: ['--role', '--book', '--stage', '--job', '--from', '--done', '--of', '--unit', '--note'],
  progress: ['--done', '--of', '--unit', '--note'],
  ask: ['--what', '--where', '--note'],
  done: ['--result', '--file', '--note', '--done', '--of', '--unit'],
  fail: ['--result', '--file', '--note'],
  handoff: ['--to', '--run', '--result', '--note', '--file', '--done', '--of', '--unit'],
  list: ['--book', '--role', '--stale-hours', '--json'],
  show: ['--json']
}

function parseArgs(argv) {
  const [verb, ...rest] = argv
  if (!ALLOWED[verb]) fail(USAGE)
  const opts = {}
  const words = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) {
      words.push(a)
      continue
    }
    if (a !== '--shelf' && !ALLOWED[verb].includes(a)) {
      fail(`"${verb}" does not take ${a}.\n${USAGE}`)
    }
    if (FLAGS.has(a)) {
      opts[a] = true
      continue
    }
    const value = rest[++i]
    if (value === undefined || value.startsWith('--')) fail(`${a} needs a value.`)
    if (REPEATS.has(a)) opts[a] = [...(opts[a] ?? []), value]
    else if (a in opts) fail(`${a} is given twice.`)
    else opts[a] = value
  }
  return { verb, words, opts }
}

function count(value, name) {
  if (value === undefined) return undefined
  if (!/^\d+$/u.test(value)) fail(`${name} must be a whole number, as ${name} 12.`)
  return Number(value)
}

/** The progress the options give, merged over what the run had. */
function progressFrom(opts, had) {
  const done = count(opts['--done'], '--done')
  const total = count(opts['--of'], '--of')
  const unit = opts['--unit']
  if (done === undefined && total === undefined && unit === undefined) return undefined
  const next = { done: done ?? had?.done ?? 0, total: total ?? had?.total, unit: unit ?? had?.unit }
  if (next.total === undefined || next.unit === undefined) {
    fail(
      'Say how far out of how much: give --of <total> and --unit <word> (leaves, plates, checks).'
    )
  }
  return next
}

/** Apply a change, as core allows it, and write the note back. */
function change(shelf, id, apply) {
  const note = findNote(shelf, id)
  const now = nowUtc()
  let next
  try {
    next = apply(note, now)
  } catch (e) {
    fail(`Nothing was written:\n  - ${e.message.split('\n').join('\n  - ')}`)
  }
  if (work.stampFor(note, now) !== now) {
    console.error(
      `This computer's clock is behind the note's last change; the change is stamped ${next.updatedAt}.`
    )
  }
  return { note: next, rel: writeNote(shelf, next, false) }
}

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')

function said(note, rel, headline) {
  const far = progressText(note.progress)
  console.log(headline)
  if (far) console.log(`  Progress: ${far}`)
  console.log(`  Note: ${rel}`)
  console.log(COMMIT)
}

// -------------------------------------------------------------------- verbs

function start(shelf, opts) {
  const book = opts['--book'] ?? null
  const stage = opts['--stage'] ?? null
  if (book !== null) {
    const why = paths.bookFolderProblem(book)
    if (why) fail(why)
    if (!existsSync(join(shelf, 'books', book))) {
      if (stage !== 'sourcing') {
        fail(
          `There is no books/${book} on the shelf at ${shelf}. Check the folder's name (only a scout at the sourcing stage may name a book not yet on the shelf).`
        )
      }
      console.error(
        `Note: books/${book} is not on the shelf yet; a scout's note may name it before it exists.`
      )
    }
  }
  if (!opts['--role']) fail('Say which role is working: --role <role>.')
  if (!opts['--job']) fail('Say what the job is, in plain words: --job "<words>".')
  const progress = progressFrom(opts, null)
  const from = opts['--from'] ?? null
  if (from) findNote(shelf, from)
  let note
  try {
    note = work.startNote({
      id: work.runIdFrom(randomBytes(8)),
      role: opts['--role'],
      book,
      stage,
      job: opts['--job'],
      now: nowUtc(),
      from,
      progress: progress ?? null,
      note: opts['--note'] ?? null
    })
  } catch (e) {
    fail(`Nothing was written:\n  - ${e.message.split('\n').join('\n  - ')}`)
  }
  const rel = writeNote(shelf, note, true)
  const where = [note.book ?? 'no book', note.stage].filter(Boolean).join(', ')
  said(
    note,
    rel,
    `Started run ${note.id}: ${work.ROLE_LABELS[note.role]}, ${where}.\n  Job: ${note.job}`
  )
  console.log(
    `Use run id ${note.id} for every later step, as: node scripts/work.mjs progress ${note.id} --done <n>`
  )
}

function verbs(verb, shelf, words, opts) {
  const id = words[0]
  const files = () => filesFrom(shelf, opts['--file'])
  const need = (name, what) => opts[name] ?? fail(`Say ${what}: ${name} "<words>".`)
  switch (verb) {
    case 'progress': {
      const { note, rel } = change(shelf, id, (n, now) =>
        work.noteProgress(n, {
          now,
          progress: progressFrom(opts, n.progress),
          note: opts['--note'] ?? null
        })
      )
      return said(
        note,
        rel,
        `Run ${id}: progress noted${opts['--note'] ? `: ${opts['--note']}` : ''}.`
      )
    }
    case 'ask': {
      const what = need('--what', 'what the owner must do')
      const where =
        opts['--where'] ?? fail('Say where the owner looks: --where <path on the shelf>.')
      const links = where.map((w) => linkFrom(shelf, w))
      const { note, rel } = change(shelf, id, (n, now) =>
        work.noteAsk(n, { now, what, links, note: opts['--note'] ?? null })
      )
      return said(
        note,
        rel,
        `Run ${id} is waiting on the owner: ${what}\n  Open: ${links.map((l) => l.path).join(', ')}`
      )
    }
    case 'done':
    case 'fail': {
      const result = need('--result', verb === 'done' ? 'what came of it' : 'why it failed')
      const apply = verb === 'done' ? work.noteDone : work.noteFailed
      const { note, rel } = change(shelf, id, (n, now) =>
        apply(n, {
          now,
          result,
          files: files(),
          progress: progressFrom(opts, n.progress),
          note: opts['--note'] ?? null
        })
      )
      return said(note, rel, `Run ${id} ${verb === 'done' ? 'is done' : 'failed'}: ${result}`)
    }
    case 'handoff': {
      const role = need('--to', 'which role takes the work on')
      const result = need('--result', 'what this run did')
      const run = opts['--run'] ?? null
      if (run) findNote(shelf, run)
      const { note, rel } = change(shelf, id, (n, now) =>
        work.noteHandoff(n, {
          now,
          role,
          run,
          result,
          files: files(),
          progress: progressFrom(opts, n.progress),
          note: opts['--note'] ?? null
        })
      )
      const to = work.ROLE_LABELS[role] ?? role
      said(note, rel, `Run ${id} handed off to ${to}: ${result}`)
      return console.log(
        `The next run names it: node scripts/work.mjs start --role ${role} --from ${id} ...`
      )
    }
  }
}

function list(shelf, opts) {
  const read = work.readNotes(noteFiles(shelf))
  const staleAfterHours = count(opts['--stale-hours'], '--stale-hours')
  const room = work.workroom(read.notes, nowUtc(), { staleAfterHours })
  if (opts['--json']) console.log(JSON.stringify({ ...room, unreadable: read.unreadable }, null, 2))
  else {
    const filter = { shelf, count: read.notes.length, book: opts['--book'], role: opts['--role'] }
    console.log(printWorkroom(room, work, filter))
  }
  if (read.unreadable.length) {
    console.error(`\n${read.unreadable.length} note(s) could not be read and are not shown:`)
    for (const u of read.unreadable)
      console.error(`  ${u.path}\n    - ${u.problems.join('\n    - ')}`)
    process.exitCode = 1
  }
}

function show(shelf, id, opts) {
  const note = findNote(shelf, id)
  if (opts['--json']) return console.log(work.serializeStatusNote(note).trimEnd())
  const now = nowUtc()
  const all = work.readNotes(noteFiles(shelf)).notes
  const view = work.runViews(all, now).find((r) => r.id === id)
  console.log(printRun(view, note, work, now))
}

const USAGE = `Usage:
  node scripts/work.mjs start --role <role> --book <folder> --stage <stage> --job "<words>" [--from <run>] [--of <n> --unit <word>] [--note "<words>"]
  node scripts/work.mjs progress <run> [--done <n>] [--of <n>] [--unit <word>] [--note "<words>"]
  node scripts/work.mjs ask <run> --what "<what the owner must do>" --where <path on the shelf> [--where "Label=path"]
  node scripts/work.mjs done <run> --result "<one line>" [--file <path on the shelf>]
  node scripts/work.mjs fail <run> --result "<why>"
  node scripts/work.mjs handoff <run> --to <role> --result "<one line>" [--run <id>] [--note "<words>"]
  node scripts/work.mjs list [--book <folder>] [--role <role>] [--json]
  node scripts/work.mjs show <run> [--json]
Every verb takes --shelf <dir>. Roles: ${work.ROLES.join(', ')}. Stages: ${work.STAGES.join(', ')}.`

try {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--shelf')
  let given
  if (at >= 0) {
    given = argv[at + 1]
    if (!given || given.startsWith('--')) fail('--shelf needs a value.')
    argv.splice(at, 2)
  }
  const { verb, words, opts } = parseArgs(argv)
  const shelf = findShelf(given)
  if (verb === 'start') start(shelf, opts)
  else if (verb === 'list') list(shelf, opts)
  else if (verb === 'show') show(shelf, words[0], opts)
  else verbs(verb, shelf, words, opts)
} catch (e) {
  console.error(e instanceof Stop ? e.message : (e?.stack ?? e))
  process.exitCode = 1
}
