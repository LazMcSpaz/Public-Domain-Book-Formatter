/**
 * Status notes: the record each run of an agent leaves on the shelf, and the
 * Workroom's views read off them (`docs/specs/status-notes.md`). Where the
 * notes live is in `../sync/work-paths.ts`.
 */
export {
  LIMITS,
  NOTE_FIELDS,
  ROLES,
  ROLE_LABELS,
  STAGES,
  STAGE_LABELS,
  STATES,
  STATUS_NOTE_FORMAT,
  STATUS_NOTE_VERSION,
  isFinal,
  type Handoff,
  type NoteEvent,
  type OwnerAsk,
  type OwnerLink,
  type Progress,
  type Role,
  type RunState,
  type Stage,
  type StatusNote
} from './vocab'
export { checkStatusNote, parseStatusNote, serializeStatusNote, type NoteCheck } from './note'
export {
  noteAsk,
  noteDone,
  noteFailed,
  noteHandoff,
  noteProgress,
  runIdFrom,
  stampFor,
  startNote,
  type StartInput
} from './changes'
export { readNotes, type NoteFile, type ReadNotes, type UnreadableNote } from './read-notes'
export {
  RECENT_DAYS,
  SHOWN_LABELS,
  STALE_AFTER_HOURS,
  filterWorkroom,
  runViews,
  workroom,
  type BookView,
  type RoleView,
  type RunView,
  type Shown,
  type StageRow,
  type Workroom,
  type WorkroomFilter,
  type WorkroomOptions
} from './workroom'
