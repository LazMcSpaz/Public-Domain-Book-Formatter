/**
 * Reading the assembled book for the faults nothing else can see.
 *
 * Two halves, deliberately kept apart because they carry different authority.
 *
 * `checkConsistency` is **deterministic** and costs nothing: it points at
 * places where the book disagrees with itself. It never proposes a reading, so
 * nothing it says has to be adjudicated — only looked at.
 *
 * `Finding` and `Verdict` are the contract for the half that *does* need a
 * reader. A finding is a hypothesis and is marked as one; it becomes an edit
 * only after a reader with the crop has said what the paper says. See **A model
 * may propose a reading; only pixels may accept one** in CLAUDE.md.
 */
export { checkConsistency, type ConsistencyFinding, type ConsistencyKind } from './consistency'
export {
  parseSenseFinding,
  parseVerdict,
  locateFindings,
  settle,
  settleAll,
  scoreSense,
  SENSE_KINDS,
  type SenseFinding,
  type SenseKind,
  type LocatedFinding,
  type Verdict,
  type Outcome,
  type SettledFinding,
  type SenseLedger
} from './sense'
export { chunkForSense, type SenseChunk, type SenseChunking } from './chunk'
