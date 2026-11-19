/**
 * The words a status note is written in: its roles, stages and states, and
 * the shape of the note itself. The parser is `./note.ts`; why the note
 * exists is said there.
 *
 * Pure: constants and types only.
 */

export const STATUS_NOTE_FORMAT = 'status-note'
export const STATUS_NOTE_VERSION = 1

/** The seven roles of `docs/specs/agent-roles.md`, then the two for tools work. */
export const ROLES = [
  'managing-editor',
  'scout',
  'reader',
  'typesetter',
  'etsu',
  'etsu-editor',
  'checker',
  'builder',
  'reviewer'
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  'managing-editor': 'Managing editor',
  scout: 'Scout',
  reader: 'Reader',
  typesetter: 'Typesetter',
  etsu: 'Etsu, the writer',
  'etsu-editor': "Etsu's editor",
  checker: 'Checker',
  builder: 'Builder',
  reviewer: 'Reviewer'
}

/**
 * A book's stages, in the usual order of the work: one per job in
 * `docs/process/README.md`, with the scout's sourcing before them and
 * `published` after the upload, when the working files are retired
 * (decision 0052). The stages in `docs/FLOW.md` are steps inside reading and
 * checking, too fine for a board; a compilation is assembled at `layout`.
 */
export const STAGES = [
  'sourcing',
  'reading',
  'checking',
  'writing',
  'pictures',
  'layout',
  'upload',
  'published'
] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  sourcing: 'Sourcing',
  reading: 'Reading',
  checking: 'Checking',
  writing: 'Writing',
  pictures: 'Pictures',
  layout: 'Layout',
  upload: 'Upload',
  published: 'Published'
}

/** Where a run is. The last three are final: a finished run is never reopened. */
export const STATES = ['working', 'waiting', 'done', 'failed', 'handed-off'] as const
export type RunState = (typeof STATES)[number]
const FINAL: readonly RunState[] = ['done', 'failed', 'handed-off']

export function isFinal(state: RunState): boolean {
  return FINAL.includes(state)
}

/** The longest each piece of plain text may be. A note is a line, not an essay. */
export const LIMITS = {
  job: 120,
  result: 300,
  note: 500,
  what: 300,
  label: 80,
  unit: 24,
  files: 200,
  links: 10,
  history: 1000
} as const

/** "20 of 40 leaves". */
export interface Progress {
  done: number
  total: number
  unit: string
}

/** A file on the shelf the owner is to open: its path from the shelf's top. */
export interface OwnerLink {
  label: string
  path: string
}

/** What the owner must do, and where. */
export interface OwnerAsk {
  what: string
  links: OwnerLink[]
}

/** The role a run handed its work to and, when known, the run that took it. */
export interface Handoff {
  role: Role
  run: string | null
  note: string | null
}

/** One change to a run, as the timeline shows it. */
export interface NoteEvent {
  at: string
  state: RunState
  note: string | null
  progress: Progress | null
  owner: OwnerAsk | null
}

export interface StatusNote {
  format: typeof STATUS_NOTE_FORMAT
  version: typeof STATUS_NOTE_VERSION
  id: string
  role: Role
  /** The book's folder under `books/`, or null for tools or shelf work. */
  book: string | null
  /** Null exactly when `book` is. */
  stage: Stage | null
  job: string
  state: RunState
  progress: Progress | null
  startedAt: string
  updatedAt: string
  /** Set exactly when the state is final. */
  finishedAt: string | null
  /** One line: what came of it. Required once the run is final. */
  result: string | null
  /** Set exactly while the run is waiting on the owner. */
  owner: OwnerAsk | null
  /** Paths on the shelf the run left. */
  files: string[]
  /** The run this one took over from. */
  from: string | null
  /** Set exactly when the run handed off. */
  handoff: Handoff | null
  history: NoteEvent[]
}

/** The fields of a note, in the order the file holds them. */
export const NOTE_FIELDS = [
  'format',
  'version',
  'id',
  'role',
  'book',
  'stage',
  'job',
  'state',
  'progress',
  'startedAt',
  'updatedAt',
  'finishedAt',
  'result',
  'owner',
  'files',
  'from',
  'handoff',
  'history'
] as const satisfies readonly (keyof StatusNote)[]
