/**
 * What the annotation pass has bought so far, kept between sittings.
 *
 * The pass is the app's second paid step and, until now, the only one with
 * nothing on disk while it ran. It reads a book in chunks, holds every proposal
 * in memory, and hands the whole lot to the review screen at the end — so a
 * locked phone, a closed tab or a refresh partway through cost the user every
 * chunk they had already been billed for. The transcription has checkpointed
 * since the day it was written; this had the same failure and none of the
 * protection.
 *
 * Same rule as everywhere else in this app: **what costs money is written down
 * as soon as it exists.** A chunk that has come back is paid for whether or not
 * the next one ever does.
 *
 * ## What makes a checkpoint unusable
 *
 * Storing it is easy; knowing when it has gone stale is the part worth writing
 * down, because the ways of getting it wrong are silent.
 *
 *   - **A different book.** Obvious, and handled by the key it is filed under.
 *   - **A different body.** Notes name a block and quote the words they hang
 *     on. Go back to the proof step, retype a paragraph, and the chunks this
 *     record calls "done" no longer describe the text a resumed run would skip
 *     — a stretch of book silently left unread. `bodyKey` is what notices.
 *   - **The other door.** Annotating and harvesting chunk a book differently,
 *     so a record from one cannot tell the other how far it got.
 *
 * A changed *voice* is deliberately not one of them. Finishing in a different
 * pen name than you started in is a book with two editors, which is worth
 * saying — but it is the user's own visible choice, every note is read one at a
 * time before it goes in, and refusing the resume would throw away notes they
 * paid for to prevent an inconsistency they can see. So the voice is recorded
 * and reported, not enforced. The body is the opposite case: nothing on screen
 * would ever show the stretch that went unread.
 *
 * A record that fails any of these is refused whole, never partly applied. What
 * it costs is a re-read of the chunks it held, which is money — so the refusal
 * is a *question* at the gate rather than a silent deletion, and the notes it
 * carries can still be taken even when carrying on is not on offer.
 *
 * ## Why anchors are not stored
 *
 * A `CheckedProposal` carries `at` — the character offset the note's mark goes
 * at — and the list of claims the book does not make. Both are *derived* from
 * the text as it stood when the chunk came back, and both are re-derived from
 * the current book on the way out of storage (`checkProposals`). Storing them
 * would put a note at an offset that a since-corrected paragraph has moved,
 * which is the whole class of bug this app keeps refusing to ship: a quote that
 * can no longer be found comes back *unplaced*, never placed at a guess.
 *
 * Pure: shapes, a stamp and a verdict. No storage and no DOM.
 */
import type { AnnotationProposal } from '@core/annotate'
import { ANNOTATION_KINDS } from '@core/annotate'
import type { Fact } from '@core/harvest'
import type { ApiUsage } from '@core/transcribe'

/**
 * Bump when the stored shape changes in a way an older record cannot satisfy.
 *
 * There is no migration path here, unlike `SavedRun`. A transcription is the
 * one thing in this app that cannot be had again at any price; a half-read
 * book's notes cost real money but can be re-read, so the honest answer to a
 * record this version does not understand is to refuse it and say so, not to
 * guess at what an older one meant and put the guess in a book.
 */
export const ANNOTATION_CHECKPOINT_VERSION = 1

/** Which pass wrote it. The two chunk a book differently — see the header. */
export type AnnotationPassMode = 'notes' | 'facts'

/** One chunk the pass could not read, kept so the user is told about it. */
export interface ChunkFailureRecord {
  chunkIndex: number
  message: string
}

/** Everything one interrupted pass had produced when it stopped. */
export interface AnnotationCheckpoint {
  version: number
  /** The file this belongs to — the same key a saved run is filed under. */
  key: string
  savedAt: string
  mode: AnnotationPassMode
  /** What the book's text looked like when these were written. */
  bodyKey: string
  /** Chunks finished. Anything below `chunksTotal` is an interrupted pass. */
  chunksDone: number
  chunksTotal: number
  /**
   * The editor these were written as.
   *
   * Recorded so a resumed run can *say* it is finishing a book someone else
   * started, rather than to stop it — see the header.
   */
  penName: string
  density: string
  /** How freely the harvest was mining, reported for the same reason. */
  depth: string
  /**
   * The notes, unlocated.
   *
   * Base fields only: where the mark goes and which claims the book does not
   * make are recomputed against the book as it stands now.
   */
  proposals: AnnotationProposal[]
  facts: Fact[]
  failures: ChunkFailureRecord[]
  discarded: number
  usage: ApiUsage
}

/**
 * What a fresh pass is about to do.
 *
 * Everything here is stamped onto the record; only `mode`, `bodyKey` and
 * `chunksTotal` decide whether an old one may be carried on — see the header
 * for why the voice is reported rather than enforced.
 */
export interface AnnotationWanted {
  mode: AnnotationPassMode
  bodyKey: string
  chunksTotal: number
  penName: string
  density: string
  depth: string
}

/**
 * A name for the body of the book, cheap to compute and sensitive to the
 * things that would move a note.
 *
 * Block ids and the length of each block's text: an id going missing or a
 * paragraph being retyped both change it, while re-running the same document
 * through assembly does not. It does not need to be a cryptographic digest —
 * nothing adversarial is on the other side of it, only an honest mistake.
 */
export function bodyKeyFor(blocks: readonly { id: string; text: string }[]): string {
  let h = 0x811c9dc5
  const seed = blocks.map((b) => `${b.id}:${b.text.length}`).join('|')
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${blocks.length}-${(h >>> 0).toString(36)}`
}

/** What to show at the gate about a checkpoint, without loading all of it. */
export interface AnnotationCheckpointSummary {
  savedAt: string
  mode: AnnotationPassMode
  chunksDone: number
  chunksTotal: number
  notes: number
  facts: number
  /** Whether carrying on where it stopped is still an honest offer. */
  resumable: boolean
  /** The pen name these were written under, when it is not the one in use now. */
  writtenAs: string | null
}

export function summarizeCheckpoint(
  checkpoint: AnnotationCheckpoint,
  wanted: AnnotationWanted
): AnnotationCheckpointSummary {
  return {
    savedAt: checkpoint.savedAt,
    mode: checkpoint.mode,
    chunksDone: checkpoint.chunksDone,
    chunksTotal: checkpoint.chunksTotal,
    notes: checkpoint.proposals.length,
    facts: checkpoint.facts.length,
    resumable: annotationResumeFrom(checkpoint, wanted) > 0,
    writtenAs: checkpoint.penName === wanted.penName ? null : checkpoint.penName
  }
}

/**
 * How many chunks a fresh run may skip, or 0 for none.
 *
 * Zero is also the answer for a checkpoint that finished: there is nothing left
 * to read, and "resume from the end" would be a request with no work in it.
 */
export function annotationResumeFrom(
  checkpoint: AnnotationCheckpoint,
  wanted: AnnotationWanted
): number {
  if (checkpoint.version !== ANNOTATION_CHECKPOINT_VERSION) return 0
  if (checkpoint.mode !== wanted.mode) return 0
  if (checkpoint.bodyKey !== wanted.bodyKey) return 0
  if (checkpoint.chunksTotal !== wanted.chunksTotal) return 0
  if (checkpoint.chunksDone >= checkpoint.chunksTotal) return 0
  return Math.max(0, checkpoint.chunksDone)
}

/** Whether the pass this record came from read the whole book. */
export function checkpointComplete(checkpoint: AnnotationCheckpoint): boolean {
  return checkpoint.chunksTotal > 0 && checkpoint.chunksDone >= checkpoint.chunksTotal
}

export function createAnnotationCheckpoint(init: {
  key: string
  wanted: AnnotationWanted
  chunksDone: number
  proposals: readonly AnnotationProposal[]
  facts: readonly Fact[]
  failures: readonly ChunkFailureRecord[]
  discarded: number
  usage: ApiUsage
}): AnnotationCheckpoint {
  return {
    version: ANNOTATION_CHECKPOINT_VERSION,
    key: init.key,
    savedAt: new Date().toISOString(),
    mode: init.wanted.mode,
    bodyKey: init.wanted.bodyKey,
    chunksDone: init.chunksDone,
    chunksTotal: init.wanted.chunksTotal,
    penName: init.wanted.penName,
    density: init.wanted.density,
    depth: init.wanted.depth,
    // Stored unlocated on purpose — see the header.
    proposals: init.proposals.map((p) => ({
      blockId: p.blockId,
      anchorText: p.anchorText,
      kind: p.kind,
      text: p.text,
      reason: p.reason
    })),
    facts: [...init.facts],
    failures: init.failures.map((f) => ({ chunkIndex: f.chunkIndex, message: f.message })),
    discarded: init.discarded,
    usage: { ...init.usage }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function proposalFrom(raw: unknown): AnnotationProposal | null {
  if (!isObject(raw)) return null
  const kind = ANNOTATION_KINDS.find((k) => k === raw['kind'])
  const blockId = str(raw['blockId'])
  const text = str(raw['text'])
  if (!kind || !blockId || !text) return null
  return { blockId, anchorText: str(raw['anchorText']), kind, text, reason: str(raw['reason']) }
}

/**
 * Read a record back, or refuse it.
 *
 * Refuses whole rather than in part. A checkpoint half of whose notes could be
 * read is a review screen that quietly shows fewer notes than were paid for,
 * and nothing downstream could tell that anything was missing — the same
 * failure as a half-restored transcription, for the same reason.
 */
export function migrateAnnotationCheckpoint(raw: unknown): AnnotationCheckpoint | null {
  if (!isObject(raw)) return null
  if (raw['version'] !== ANNOTATION_CHECKPOINT_VERSION) return null

  const mode = raw['mode'] === 'facts' ? 'facts' : raw['mode'] === 'notes' ? 'notes' : null
  const key = str(raw['key'])
  const bodyKey = str(raw['bodyKey'])
  if (!mode || !key || !bodyKey) return null

  const rawProposals = raw['proposals']
  const rawFacts = raw['facts']
  if (!Array.isArray(rawProposals) || !Array.isArray(rawFacts)) return null

  const proposals: AnnotationProposal[] = []
  for (const item of rawProposals) {
    const proposal = proposalFrom(item)
    if (!proposal) return null
    proposals.push(proposal)
  }

  const failures: ChunkFailureRecord[] = []
  for (const item of Array.isArray(raw['failures']) ? raw['failures'] : []) {
    if (!isObject(item)) return null
    failures.push({ chunkIndex: num(item['chunkIndex']), message: str(item['message']) })
  }

  const usage = isObject(raw['usage']) ? raw['usage'] : {}
  return {
    version: ANNOTATION_CHECKPOINT_VERSION,
    key,
    savedAt: str(raw['savedAt']) || new Date(0).toISOString(),
    mode,
    bodyKey,
    chunksDone: num(raw['chunksDone']),
    chunksTotal: num(raw['chunksTotal']),
    penName: str(raw['penName']),
    density: str(raw['density']),
    depth: str(raw['depth']),
    proposals,
    // Facts are stored as they were written and are not re-derived: unlike a
    // note, an entry does not point *into* the printed book, so nothing about
    // it moves when a paragraph is retyped.
    facts: rawFacts as Fact[],
    failures,
    discarded: num(raw['discarded']),
    usage: {
      inputTokens: num(usage['inputTokens']),
      outputTokens: num(usage['outputTokens']),
      cacheReadTokens: num(usage['cacheReadTokens'])
    }
  }
}
