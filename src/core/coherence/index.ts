/**
 * Reading the assembled book for the faults nothing else can see.
 *
 * Two halves, deliberately kept apart because they carry different authority.
 *
 * `checkConsistency` is **deterministic** and costs nothing: it points at
 * places where the book disagrees with itself. It never proposes a reading, so
 * nothing it says has to be adjudicated — only looked at.
 *
 * `checkDamage` is deterministic too, and asks a narrower question with a
 * different provenance behind it: where does the text carry a mark **no
 * compositor sets**? That is the check for a book whose "scan" is a text layer
 * and which therefore has no pixels to be accepted by — see the module's own
 * head for why the book's vocabulary may stand in for them, and where it may
 * not.
 *
 * `findParallels` is the third deterministic check and the one that supplies a
 * **second witness** where there are no pixels: the places a book prints the
 * same passage twice were converted independently, so where the two copies
 * point one word two ways, one of them is wrong. `concordanceFor` is what a reader
 * is handed in place of a crop on such a book — the paragraph, its neighbours
 * and its parallels, and never the hypothesis.
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
export {
  findParallels,
  concordanceFor,
  type ParallelPair,
  type PointingDifference,
  type Concordance
} from './parallels'
export {
  checkDamage,
  damageSheet,
  honourRulings,
  type DamageRuling,
  type HonouredFinding,
  type DamageFinding,
  type DamageKind,
  type DamageConfidence
} from './damage'
export {
  checkFootnotePairing,
  checkNoteContinuations,
  type ContinuationFinding,
  type PairingFinding
} from './footnote-pairing'
