/**
 * The checks on a status note's parts: plain text, times, progress, the ask
 * to the owner and the timeline. Each adds plain reasons to `problems` and
 * never throws; `./note.ts` puts them together.
 *
 * Pure.
 */
import { shelfPathProblem } from '../sync/work-paths'
import { LIMITS, STATES, isFinal, type RunState } from './vocab'

/** The value being checked and the reasons found so far. */
export interface Fields {
  v: Record<string, unknown>
  problems: string[]
}

export function textValue(
  f: Fields,
  value: unknown,
  name: string,
  max: number,
  nullable: boolean
): void {
  if (value === null && nullable) return
  if (typeof value !== 'string' || value.trim() === '') {
    f.problems.push(`${name} must be some plain words${nullable ? ', or null' : ''}.`)
  } else if (/[\n\r]/u.test(value)) {
    f.problems.push(`${name} must be one line.`)
  } else if (value.length > max) {
    f.problems.push(`${name} is ${value.length} characters; keep it to ${max}.`)
  }
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u

/** Why `at` is not a UTC time a note may carry, or null when it is. */
export function timeProblem(at: unknown, name: string): string | null {
  if (typeof at !== 'string' || !UTC.test(at)) {
    return `${name} must be a UTC time such as 2026-11-19T14:05:00Z.`
  }
  const ms = Date.parse(at)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== at.slice(0, 19)) {
    return `${name} (${at}) is not a real time.`
  }
  return null
}

/** Exactly these keys, each present; the reasons say which are missing or extra. */
function exactKeys(f: Fields, o: Record<string, unknown>, keys: string[], name: string): void {
  const extra = Object.keys(o).filter((k) => !keys.includes(k))
  if (extra.length) f.problems.push(`${name} has fields it does not use: ${extra.join(', ')}.`)
  const missing = keys.filter((k) => !(k in o))
  if (missing.length) f.problems.push(`${name} is missing: ${missing.join(', ')}.`)
}

function asObject(f: Fields, value: unknown, name: string, shape: string) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  f.problems.push(`${name} must be ${shape}.`)
  return null
}

/** `null`, or `{ done, total, unit }` with 0 <= done <= total and total >= 1. */
export function checkProgress(f: Fields, value: unknown, name: string): void {
  if (value === null) return
  const o = asObject(f, value, name, '{ done, total, unit } or null')
  if (!o) return
  exactKeys(f, o, ['done', 'total', 'unit'], name)
  const { done, total } = o
  const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (!whole(done)) f.problems.push(`${name}: "done" must be a whole number, 0 or more.`)
  if (!whole(total) || total === 0) {
    f.problems.push(`${name}: "total" must be a whole number, 1 or more.`)
  }
  if (whole(done) && whole(total) && (done as number) > (total as number)) {
    f.problems.push(`${name} says ${done} of ${total}: what is done cannot be more than the total.`)
  }
  textValue(f, o['unit'], `${name} unit`, LIMITS.unit, false)
}

/** `null`, or `{ what, links }` with at least one link to a path on the shelf. */
export function checkOwner(f: Fields, value: unknown, name: string): void {
  if (value === null) return
  const o = asObject(f, value, name, '{ what, links } or null')
  if (!o) return
  exactKeys(f, o, ['what', 'links'], name)
  textValue(f, o['what'], `${name} what`, LIMITS.what, false)
  const links = o['links']
  if (!Array.isArray(links) || links.length === 0) {
    f.problems.push(`${name} links must list at least one file on the shelf for the owner to open.`)
    return
  }
  if (links.length > LIMITS.links) f.problems.push(`${name} has more than ${LIMITS.links} links.`)
  links.forEach((link, i) => {
    const at = `${name} link ${i + 1}`
    const l = asObject(f, link, at, '{ label, path }')
    if (!l) return
    exactKeys(f, l, ['label', 'path'], at)
    textValue(f, l['label'], `${at} label`, LIMITS.label, false)
    const why = typeof l['path'] === 'string' ? shelfPathProblem(l['path']) : 'it is not text.'
    if (why) f.problems.push(`${at}: ${why}`)
  })
}

/**
 * The timeline: one event per change, oldest first. The first is the start
 * (working, at `startedAt`); the last is the run as it stands (its state, at
 * `updatedAt`); nothing follows a final event; a waiting event carries the
 * ask and no other does.
 */
export function checkHistory(
  f: Fields,
  run: { state: RunState | null; started: string | null; updated: string | null }
): void {
  const history = f.v['history']
  if (!Array.isArray(history) || history.length === 0) {
    f.problems.push('"history" must list every change to the run, starting with its start.')
    return
  }
  if (history.length > LIMITS.history) {
    f.problems.push(`"history" has more than ${LIMITS.history} events; start a new run instead.`)
  }
  let before: string | null = null
  history.forEach((event, i) => {
    const name = `history event ${i + 1}`
    const e = asObject(f, event, name, '{ at, state, note, progress, owner }')
    if (!e) return
    exactKeys(f, e, ['at', 'state', 'note', 'progress', 'owner'], name)
    const why = timeProblem(e['at'], `${name} "at"`)
    if (why) f.problems.push(why)
    const at = why ? null : (e['at'] as string)
    if (at && before && at < before) {
      f.problems.push(
        `The timeline is out of order: ${name} (${at}) is before the one above it (${before}).`
      )
    }
    if (at) before = at
    const state = e['state']
    if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) {
      f.problems.push(`${name} state is ${JSON.stringify(state)}, which is not a state.`)
    } else {
      if (i < history.length - 1 && isFinal(state as RunState)) {
        f.problems.push(
          `${name} is ${state}, but more follows it: a finished run is never reopened.`
        )
      }
      if (state === 'waiting' && e['owner'] === null) {
        f.problems.push(`${name} is waiting on the owner but does not say what for.`)
      }
      if (state !== 'waiting' && e['owner'] !== null && e['owner'] !== undefined) {
        f.problems.push(`${name} carries an ask but is ${state}.`)
      }
    }
    textValue(f, e['note'], `${name} note`, LIMITS.note, true)
    checkProgress(f, e['progress'], `${name} progress`)
    checkOwner(f, e['owner'], `${name} ask`)
    if (i === 0) {
      if (state !== 'working')
        f.problems.push('The first history event must be the start (working).')
      if (run.started && at && at !== run.started) {
        f.problems.push('The first history event is not at "startedAt".')
      }
    }
    if (i === history.length - 1) {
      if (run.state && state !== run.state) {
        f.problems.push(`The last history event is ${String(state)} but the run is ${run.state}.`)
      }
      if (run.updated && at && at !== run.updated) {
        f.problems.push('The last history event is not at "updatedAt".')
      }
    }
  })
}
