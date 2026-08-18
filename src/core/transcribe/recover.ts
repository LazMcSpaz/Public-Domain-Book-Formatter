/**
 * Finding the text that went missing, and where it belongs.
 *
 * `verifyPage` compares the transcription against OCR as two *sets* of words,
 * which is enough to say "fourteen words OCR read clearly are absent" and no
 * more. That leaves the user with an alarming number, a scan, and one remedy
 * that costs money — re-read the page and hope.
 *
 * But both texts are sitting right there. A sequence alignment finds not just
 * which words are missing but the contiguous *runs* they form and the words on
 * either side of each gap, which is everything needed to show the user the
 * dropped sentence and put it back. Free, deterministic, and it turns a paid
 * re-read into a click.
 *
 * ## What this is not
 *
 * It is not a correction of the transcription against OCR. OCR is the noisier
 * witness of the two — that is why the vision pass exists — so a run recovered
 * here carries OCR's mistakes with it. It is offered to the user beside the
 * scan, never applied on its own, and the confidence it came back with travels
 * with it so an obviously garbled run can be seen for what it is.
 *
 * Pure: two texts in, runs out.
 */
import type { OcrWordLike } from './types'

/**
 * How likely a gap is to be a real dropped clause rather than OCR noise.
 *
 * A run of several words in a row is a sentence the vision pass skipped. One
 * or two words is far more often OCR seeing something that is not there, or
 * the vision pass silently *fixing* a misreading — `thc` becoming `the` looks
 * exactly like a dropped word from this side of the comparison.
 *
 * Both are reported. Only the strong ones are worth a suggestion.
 */
export type RunStrength = 'strong' | 'weak'

/** A contiguous stretch of the page that OCR read and the transcription lacks. */
export interface DroppedRun {
  /** The words as OCR read them, in reading order. */
  words: string[]
  /** Those words as a sentence — what would go into the book. */
  text: string
  /**
   * The ids of the OCR words in this run, where OCR supplied them.
   *
   * What lets the gate show the *pixels* rather than describe them. Each id
   * names a word box on the scan, so the leaf can be rendered once and every
   * discrepancy on it cut out at exactly the place it was read from. Without
   * this the user is told a word is missing and left to find it by eye on a
   * page of dense type, which is the complaint this field exists to answer.
   */
  tokenIds: string[]
  /** Whether this is long enough to be worth suggesting. See `RunStrength`. */
  strength: RunStrength
  /** Mean OCR confidence across the run, 0–100. Low means "look hard at this". */
  confidence: number
  /**
   * The transcribed words immediately before the gap.
   *
   * This is what makes the run placeable: it is a phrase that exists in the
   * transcription, so the text can be put back exactly where it was taken from
   * rather than appended to the end of a block.
   */
  after: string
  /** The transcribed words immediately after the gap, for showing the context. */
  before: string
}

export interface RecoverOptions {
  /**
   * Shortest run counted as `strong`, in words.
   *
   * A single missing word is usually OCR seeing something that is not there, or
   * the vision pass silently fixing a typo — both of which the user does not
   * want to be asked about a hundred times. A run of several words in a row is
   * a dropped clause, which is the thing worth recovering.
   */
  minWords?: number
  /**
   * Whether to return the short gaps too, marked `weak`.
   *
   * Off by default, because the *suggestion* list must stay short. On for the
   * review gate, which had the opposite problem: it announced "18 words OCR
   * read clearly are absent" and then offered one four-word run, leaving the
   * other fourteen named, unlocated and impossible to act on. A discrepancy
   * worth counting is worth pointing at.
   */
  includeWeak?: boolean
  /** Mean OCR confidence a run must reach to be offered at all. Default 70. */
  minConfidence?: number
  /** Words of transcription quoted either side of a gap. Default 6. */
  contextWords?: number
  /**
   * How far ahead to look for an OCR word in the transcription before calling
   * it missing.
   *
   * The two texts are the same page in the same order, so a match is nearly
   * always within a few words. A large window would let a word match its own
   * later occurrence and swallow the real gap between them.
   */
  lookahead?: number
}

/** The comparison key for a word: what `verifyPage` uses, so the two agree. */
function key(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '')
}

/** Whether a word is worth aligning on — punctuation and stray marks are not. */
function alignable(word: string): boolean {
  return key(word).length > 1
}

/**
 * Join the two halves of a word OCR saw broken across a line.
 *
 * The vision pass reads a page and writes `proceed`. OCR reads the same page
 * and, because the line ends mid-word, emits `pro-` and `ceed` as two words.
 * Neither half matches anything in the transcription, so the comparison calls
 * both of them missing — on a leaf with three hyphenated line breaks that is
 * three spurious discrepancies, and a book of three hundred leaves produces
 * hundreds of them. Every one asks the user to judge a word that is already
 * right, and the only wrong answer, "put it back", writes `pro- ceed proceed`
 * into the book.
 *
 * The same rule assembly uses across a *page* break, applied to the OCR stream
 * across a *line* break: a hyphen at the end of a word, immediately before
 * another word, was line-wrap rather than spelling. It is the same ambiguity
 * assembly already lives with — a genuine compound broken at a line end heals
 * into one word — and the same answer, because the transcription made that
 * choice first and this is only trying to agree with it.
 *
 * The merged word keeps the *first* half's id, so a crop still points at where
 * the word starts.
 */
export function healLineBreaks(words: readonly OcrWordLike[]): OcrWordLike[] {
  const out: OcrWordLike[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const next = words[i + 1]
    if (next && /\p{L}[-\u00AD]$/u.test(word.text)) {
      out.push({
        text: word.text.replace(/[-\u00AD]$/u, '') + next.text,
        // The rougher of the two halves: a join is only as trustworthy as its
        // worse end, and this number is shown to a person as a probability.
        confidence: Math.min(word.confidence, next.confidence),
        ...(word.id ? { id: word.id } : {})
      })
      i += 1
      continue
    }
    out.push(word)
  }
  return out
}

/**
 * How many words in a row must agree before a match is believed.
 *
 * The reason this is not one: a page says "the cord" three times, and a single
 * common word will happily match its own later occurrence — closing a gap that
 * is real and swallowing the sentence between the two. Three consecutive words
 * agreeing is a position, not a coincidence.
 */
const ANCHOR_WORDS = 3

/**
 * Find the runs of text OCR saw that the transcription does not contain.
 *
 * A forward alignment rather than a full diff: the two texts are the same page
 * read twice in the same order, so walking OCR's words and advancing a cursor
 * through the transcription finds the gaps in one pass. What makes it reliable
 * is that a position is only accepted when several consecutive words agree —
 * see `ANCHOR_WORDS`.
 */
export function findDroppedRuns(
  transcription: string,
  ocrWords: readonly OcrWordLike[],
  options: RecoverOptions = {}
): DroppedRun[] {
  const minWords = options.minWords ?? 4
  const includeWeak = options.includeWeak ?? false
  const minConfidence = options.minConfidence ?? 70
  const contextWords = options.contextWords ?? 6
  const lookahead = options.lookahead ?? 40

  const transcribed = transcription.split(/\s+/u).filter((w) => w.length > 0)
  const transcribedKeys = transcribed.map(key)
  const ocr = healLineBreaks(ocrWords).filter((w) => alignable(w.text))
  const ocrKeys = ocr.map((w) => key(w.text))
  if (transcribed.length === 0 || ocr.length === 0) return []

  const runs: DroppedRun[] = []
  let cursor = 0
  let gap: OcrWordLike[] = []

  /** Close the gap standing before the transcription word at `cursor`. */
  const flush = (): void => {
    const words = gap
    gap = []
    if (words.length === 0) return

    const strength: RunStrength = words.length >= minWords ? 'strong' : 'weak'
    if (strength === 'weak' && !includeWeak) return

    const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length
    if (confidence < minConfidence) return

    runs.push({
      words: words.map((w) => w.text),
      text: words.map((w) => w.text).join(' '),
      tokenIds: words.map((w) => w.id).filter((id): id is string => typeof id === 'string'),
      strength,
      confidence: Math.round(confidence),
      after: transcribed.slice(Math.max(0, cursor - contextWords), cursor).join(' '),
      before: transcribed.slice(cursor, cursor + contextWords).join(' ')
    })
  }

  /**
   * How many words agree, starting from these two positions.
   *
   * Used both to find an anchor and to consume the whole matched stretch once
   * one is found, so a long agreeing passage costs one search rather than one
   * per word.
   */
  const agreement = (from: number, at: number): number => {
    let n = 0
    while (
      from + n < ocrKeys.length &&
      at + n < transcribedKeys.length &&
      ocrKeys[from + n] === transcribedKeys[at + n]
    ) {
      n += 1
    }
    return n
  }

  let i = 0
  while (i < ocr.length) {
    // The anchor may be shorter than usual at the very end of the page, where
    // there are not three words left to agree on.
    const needed = Math.min(ANCHOR_WORDS, ocr.length - i)

    let matchedAt = -1
    let matchedLen = 0
    for (let j = cursor; j < Math.min(transcribedKeys.length, cursor + lookahead); j++) {
      const n = agreement(i, j)
      if (n >= needed) {
        matchedAt = j
        matchedLen = n
        break
      }
    }

    if (matchedAt === -1) {
      gap.push(ocr[i]!)
      i += 1
      continue
    }

    // Words the transcription has and OCR skipped are not a problem — OCR is
    // the noisier reader — so the cursor simply jumps past them.
    flush()
    cursor = matchedAt + matchedLen
    i += matchedLen
  }

  // A gap at the very end of the page: the tail was dropped.
  cursor = transcribed.length
  flush()

  return runs
}

/**
 * Put a run back where it came from.
 *
 * Splices the text in after its `after` phrase, which is a phrase the block
 * genuinely contains — so the recovered clause lands where it was taken from
 * rather than at the end. Returns null when the anchor is not in this text,
 * which is how the caller knows to try the next block.
 */
export function spliceRun(blockText: string, run: DroppedRun): string | null {
  return spliceRunInto(blockText, undefined, run)?.text ?? null
}

/** A block after a recovered passage was put back into it. */
export interface SplicedBlock {
  text: string
  /** The block's emphasis, moved along past the words that were inserted. */
  emphasis: number[]
}

/**
 * Put a run back, and carry the block's italics across the join.
 *
 * Emphasis is word indices, so inserting words in the middle of a paragraph
 * moves every index after the insertion — and doing nothing about it italicises
 * whichever words now sit at the old positions. The alternative that suggests
 * itself, splicing into the text *with* its `<i>` tags, does not work: the
 * anchor is a phrase taken from the tagless transcription, so it straddles a
 * tag and is not found at all.
 *
 * Nothing is dropped either way, which is the point. Before this, restoring a
 * dropped clause silently discarded the emphasis of the paragraph it landed in.
 */
export function spliceRunInto(
  blockText: string,
  emphasis: readonly number[] | undefined,
  run: DroppedRun
): SplicedBlock | null {
  const inserted = run.text.split(/\s+/u).filter((w) => w.length > 0).length
  const shift = (from: number): number[] =>
    (emphasis ?? []).map((i) => (i < from ? i : i + inserted))

  const anchor = run.after.trim()
  if (!anchor) {
    // A run dropped from the very start of the page goes at the front, so every
    // word of the block moves along by all of it.
    return { text: `${run.text} ${blockText}`.trim(), emphasis: shift(0) }
  }

  const at = blockText.indexOf(anchor)
  if (at === -1) return null

  const end = at + anchor.length
  const head = blockText.slice(0, end)
  const tail = blockText.slice(end)
  // A space either side, then collapse — so the join reads as prose whether or
  // not the anchor ended with punctuation.
  const text = `${head} ${run.text}${tail.startsWith(' ') ? '' : ' '}${tail}`
    .replace(/\s+/gu, ' ')
    .trim()
  const before = head.split(/\s+/u).filter((w) => w.length > 0).length
  return { text, emphasis: shift(before) }
}
