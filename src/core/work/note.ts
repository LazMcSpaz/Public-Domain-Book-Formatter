/**
 * A status note: the record one run of an agent leaves on the shelf.
 *
 * An agent writes its note when it starts a job, as it makes progress, and
 * when it stops: done, failed, handed to another role, or waiting on the
 * owner, with what he must do and links to the files to open. The Workroom
 * reads many notes to show what is waiting on the owner, where each book
 * stands and what each role is doing (`./workroom.ts`). The book's
 * `ledger.md` stays the written record of what was done; a note is the live
 * board beside it.
 *
 * Every change is added to the note's own `history`, never written over, so
 * the Workroom can show the whole timeline of a run. The fields at the top
 * are the run as it stands now, and must agree with the last event.
 *
 * The parser is strict: a missing field, an unknown one, a role or stage
 * that does not exist, a time out of order, or a state its fields contradict
 * is refused, and every reason is given in plain words. A note that cannot
 * be believed must not be shown.
 *
 * Pure: the command (`scripts/work.mjs`) supplies the times and the random
 * id, and does the reading and writing. The words are in `./vocab.ts`, the
 * checks on each part in `./fields.ts`.
 */
import { bookFolderProblem, runIdProblem, shelfPathProblem } from '../sync/work-paths'
import {
  checkHistory,
  checkOwner,
  checkProgress,
  textValue,
  timeOrder,
  timeProblem,
  type Fields
} from './fields'
import {
  LIMITS,
  NOTE_FIELDS,
  ROLES,
  STAGES,
  STATES,
  STATUS_NOTE_FORMAT,
  STATUS_NOTE_VERSION,
  isFinal,
  type StatusNote
} from './vocab'

export type NoteCheck = { ok: true; note: StatusNote } | { ok: false; problems: string[] }

/** Read a note's text. Never throws: a note that cannot be believed gives its reasons. */
export function parseStatusNote(text: string): NoteCheck {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (e) {
    return { ok: false, problems: [`It is not JSON (${(e as Error).message}).`] }
  }
  return checkStatusNote(raw)
}

/** Check a value is a note this version of the tools can believe. */
export function checkStatusNote(raw: unknown): NoteCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: ['A status note is a JSON object; this is not one.'] }
  }
  const v = raw as Record<string, unknown>
  if (v['format'] !== STATUS_NOTE_FORMAT) {
    return {
      ok: false,
      problems: [`"format" must be "${STATUS_NOTE_FORMAT}"; this is not a status note.`]
    }
  }
  if (v['version'] !== STATUS_NOTE_VERSION) {
    const was = JSON.stringify(v['version'])
    const newer = typeof v['version'] === 'number' && v['version'] > STATUS_NOTE_VERSION
    return {
      ok: false,
      problems: [
        newer
          ? `This note is version ${was} and these tools read version ${STATUS_NOTE_VERSION}: update the tools before reading or writing it.`
          : `"version" is ${was}; these tools read version ${STATUS_NOTE_VERSION} only.`
      ]
    }
  }
  const f: Fields = { v, problems: [] }
  const p = f.problems
  for (const key of Object.keys(v)) {
    if (!(NOTE_FIELDS as readonly string[]).includes(key)) {
      p.push(`"${key}" is not a field of a status note (a typo, or a note from newer tools).`)
    }
  }
  for (const key of NOTE_FIELDS) if (!(key in v)) p.push(`"${key}" is missing.`)
  if (p.length) return { ok: false, problems: p }

  const id = v['id']
  const idWhy = typeof id === 'string' ? runIdProblem(id) : '"id" must be a run id.'
  if (idWhy) p.push(idWhy)
  oneOf(f, 'role', ROLES, 'a role')
  const book = v['book']
  if (book !== null) {
    const why = typeof book === 'string' ? bookFolderProblem(book) : null
    if (typeof book !== 'string') p.push('"book" must be a folder name, or null for no book.')
    else if (why) p.push(why)
  }
  if (v['stage'] === null) {
    if (book !== null) p.push('"stage" is missing: a run on a book says which stage of it.')
  } else {
    oneOf(f, 'stage', STAGES, 'a stage')
    if (book === null) p.push('"stage" is set but "book" is null: only work on a book has a stage.')
  }
  textValue(f, v['job'], '"job"', LIMITS.job, false)
  const state = oneOf(f, 'state', STATES, 'a state')
  checkProgress(f, v['progress'], '"progress"')
  const started = time(f, 'startedAt', false)
  const updated = time(f, 'updatedAt', false)
  const finished = time(f, 'finishedAt', true)
  textValue(f, v['result'], '"result"', LIMITS.result, true)
  checkOwner(f, v['owner'], '"owner"')
  idOrNull(f, 'from')
  if (v['from'] !== null && v['from'] === id) p.push('"from" names this run itself.')
  checkFiles(f)
  checkHandoff(f)

  if (started && updated && timeOrder(updated, started) < 0) {
    p.push('"updatedAt" is before "startedAt".')
  }
  if (finished && updated && timeOrder(finished, updated) !== 0) {
    p.push('"finishedAt" and "updatedAt" differ: nothing changes a run once it has finished.')
  }
  if (state) agreesWithState(f, state)
  checkHistory(f, { state, started, updated, progress: v['progress'], owner: v['owner'] })
  return p.length ? { ok: false, problems: p } : { ok: true, note: raw as StatusNote }
}

/** A note as the file holds it: two-space JSON, fields in a fixed order, one newline at the end. */
export function serializeStatusNote(note: StatusNote): string {
  const ordered: Record<string, unknown> = {}
  for (const key of NOTE_FIELDS) ordered[key] = note[key]
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/** The fields each state needs, and the ones it must not have. */
function agreesWithState(f: Fields, state: (typeof STATES)[number]): void {
  const { v, problems: p } = f
  const final = isFinal(state)
  if (final && v['finishedAt'] === null) p.push(`The run is ${state} but "finishedAt" is not set.`)
  if (!final && v['finishedAt'] !== null) p.push(`"finishedAt" is set but the run is ${state}.`)
  if (final && v['result'] === null) p.push(`The run is ${state} but has no "result" line.`)
  if (state === 'waiting' && v['owner'] === null) {
    p.push('The run is waiting on the owner but "owner" does not say what he must do, or where.')
  }
  if (state !== 'waiting' && v['owner'] !== null) {
    p.push(`"owner" is set but the run is ${state}: only a waiting run asks the owner.`)
  }
  if (state === 'handed-off' && v['handoff'] === null) {
    p.push('The run is handed off but "handoff" does not say to which role.')
  }
  if (state !== 'handed-off' && v['handoff'] !== null) {
    p.push(`"handoff" is set but the run is ${state}.`)
  }
}

function oneOf<T extends string>(
  f: Fields,
  key: string,
  allowed: readonly T[],
  what: string
): T | null {
  const value = f.v[key]
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  f.problems.push(
    `"${key}" is ${JSON.stringify(value)}, which is not ${what}. Use one of: ${allowed.join(', ')}.`
  )
  return null
}

function time(f: Fields, key: string, nullable: boolean): string | null {
  const value = f.v[key]
  if (value === null && nullable) return null
  const why = timeProblem(value, `"${key}"`)
  if (why) {
    f.problems.push(why)
    return null
  }
  return value as string
}

function idOrNull(f: Fields, key: string): void {
  const value = f.v[key]
  if (value === null) return
  const why = typeof value === 'string' ? runIdProblem(value) : 'it must be a run id or null.'
  if (why) f.problems.push(`"${key}": ${why}`)
}

function checkFiles(f: Fields): void {
  const files = f.v['files']
  if (!Array.isArray(files)) {
    f.problems.push('"files" must be a list of paths on the shelf (empty when it left none).')
    return
  }
  if (files.length > LIMITS.files) f.problems.push(`"files" names more than ${LIMITS.files} files.`)
  files.forEach((path, i) => {
    const why = typeof path === 'string' ? shelfPathProblem(path) : 'it is not text.'
    if (why) f.problems.push(`"files" item ${i + 1}: ${why}`)
  })
}

function checkHandoff(f: Fields): void {
  const h = f.v['handoff']
  if (h === null) return
  if (typeof h !== 'object' || Array.isArray(h)) {
    f.problems.push('"handoff" must be { role, run, note } or null.')
    return
  }
  const o = h as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => !['role', 'run', 'note'].includes(k))
  if (extra.length) f.problems.push(`"handoff" has fields it does not use: ${extra.join(', ')}.`)
  if (typeof o['role'] !== 'string' || !(ROLES as readonly string[]).includes(o['role'])) {
    f.problems.push(
      `"handoff" role is ${JSON.stringify(o['role'])}, which is not a role. Use one of: ${ROLES.join(', ')}.`
    )
  }
  const run = o['run']
  if (!('run' in o) || (run !== null && (typeof run !== 'string' || runIdProblem(run)))) {
    f.problems.push('"handoff" run must be a run id, or null when the next run is not known yet.')
  } else if (run !== null && run === f.v['id']) {
    f.problems.push('"handoff" run names this run itself; a run cannot hand its work to itself.')
  }
  if (!('note' in o)) f.problems.push('"handoff" note is missing (null when there is none).')
  else textValue(f, o['note'], '"handoff" note', LIMITS.note, true)
}
