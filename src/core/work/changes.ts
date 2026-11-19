/**
 * The changes a run makes to its own status note: start, progress, ask the
 * owner, done, failed, handed off. Each adds one event to the note's history
 * and returns a new note, checked by the strict parser before it is handed
 * back, so the command can only ever write a note the Workroom will believe.
 * A change that would make a wrong note throws, with the reasons.
 *
 * A finished run (done, failed, handed off) is never reopened: the next piece
 * of work is a new run that names it as `from`. A waiting run goes back to
 * working with `noteProgress` once the owner has answered, or straight to
 * done.
 *
 * Pure: the caller hands in the time and, for a new run, random bytes.
 */
import { checkStatusNote } from './note'
import {
  STATUS_NOTE_FORMAT,
  STATUS_NOTE_VERSION,
  type NoteEvent,
  type OwnerLink,
  type Progress,
  type Role,
  type RunState,
  type Stage,
  type StatusNote,
  isFinal
} from './vocab'

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A run id from eight or more random bytes: eight lower-case letters and digits. */
export function runIdFrom(bytes: ArrayLike<number>): string {
  if (bytes.length < 8) throw new Error('A run id needs eight random bytes.')
  let id = ''
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length]
  return id
}

export interface StartInput {
  id: string
  role: Role
  book: string | null
  stage: Stage | null
  job: string
  now: string
  from?: string | null
  progress?: Progress | null
  note?: string | null
}

/** A new run's note: working, with its start as the first event. */
export function startNote(input: StartInput): StatusNote {
  const progress = input.progress ?? null
  return checked({
    format: STATUS_NOTE_FORMAT,
    version: STATUS_NOTE_VERSION,
    id: input.id,
    role: input.role,
    book: input.book,
    stage: input.stage,
    job: input.job,
    state: 'working',
    progress,
    startedAt: input.now,
    updatedAt: input.now,
    finishedAt: null,
    result: null,
    owner: null,
    files: [],
    from: input.from ?? null,
    handoff: null,
    history: [event(input.now, 'working', input.note ?? null, progress)]
  })
}

interface Change {
  now: string
  note?: string | null
  progress?: Progress | null
}

/** Progress, or a word on how it goes. Brings a waiting run back to working. */
export function noteProgress(note: StatusNote, change: Change): StatusNote {
  return next(note, change, 'working', change.note ?? null, {})
}

/** The run waits on the owner: what he must do, and the files on the shelf to open. */
export function noteAsk(
  note: StatusNote,
  change: Change & { what: string; links: OwnerLink[] }
): StatusNote {
  const owner = { what: change.what, links: change.links }
  return next(note, change, 'waiting', change.note ?? null, { owner })
}

interface Finish extends Change {
  result: string
  files?: string[]
}

/** The run finished its job. */
export function noteDone(note: StatusNote, change: Finish): StatusNote {
  return finish(note, change, 'done', {})
}

/** The run could not finish its job; `result` says why. */
export function noteFailed(note: StatusNote, change: Finish): StatusNote {
  return finish(note, change, 'failed', {})
}

/** The run hands its work to another role, and to that role's run when it is known. */
export function noteHandoff(
  note: StatusNote,
  change: Finish & { role: Role; run?: string | null }
): StatusNote {
  const handoff = { role: change.role, run: change.run ?? null, note: change.note ?? null }
  return finish(note, change, 'handed-off', { handoff })
}

/**
 * The time a change is stamped with: now, or the note's last change when this
 * computer's clock is behind the one that wrote it, so the timeline stays in
 * order. The command says so when that happens.
 */
export function stampFor(note: StatusNote, now: string): string {
  return now < note.updatedAt ? note.updatedAt : now
}

function finish(
  note: StatusNote,
  change: Finish,
  state: RunState,
  extra: Partial<StatusNote>
): StatusNote {
  const files = [...note.files]
  for (const file of change.files ?? []) if (!files.includes(file)) files.push(file)
  return next(note, change, state, change.note ?? change.result, {
    ...extra,
    result: change.result,
    files
  })
}

function next(
  note: StatusNote,
  change: Change,
  state: RunState,
  said: string | null,
  extra: Partial<StatusNote>
): StatusNote {
  if (isFinal(note.state)) {
    throw new Error(
      `Run ${note.id} is already ${note.state}; a finished run is never reopened. ` +
        `Start a new run with --from ${note.id}.`
    )
  }
  const at = stampFor(note, change.now)
  const progress = change.progress === undefined ? note.progress : change.progress
  const owner = extra.owner ?? null
  return checked({
    ...note,
    ...extra,
    state,
    progress,
    owner,
    updatedAt: at,
    finishedAt: isFinal(state) ? at : null,
    history: [...note.history, event(at, state, said, progress, owner)]
  })
}

function event(
  at: string,
  state: RunState,
  note: string | null,
  progress: Progress | null,
  owner: NoteEvent['owner'] = null
): NoteEvent {
  return { at, state, note, progress, owner }
}

/** The note, once the parser believes it; else an error with one reason per line. */
function checked(note: StatusNote): StatusNote {
  const result = checkStatusNote(note)
  if (!result.ok) throw new Error(result.problems.join('\n'))
  return result.note
}
