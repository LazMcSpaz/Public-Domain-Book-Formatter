/**
 * The control protocol: operating the interview from outside the tab.
 */
export {
  CONTROL_ROOT,
  CONTROL_VERSION,
  REDACTED_QUESTIONS,
  advanceOutlook,
  inboxPath,
  outboxPath,
  parseCommand,
  parseWordsRef,
  snapshot,
  validSession,
  wordsRef,
  type AdvanceOutlook,
  type Command,
  type CommandEnvelope,
  type GateView,
  type Inbox,
  type Outbox,
  type Reply,
  type Snapshot,
  type SnapshotInput,
  type ViewEvidence,
  type ViewQuestion,
  type ViewRow
} from './protocol'
