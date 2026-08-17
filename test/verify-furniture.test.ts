import { describe, it, expect } from 'vitest'
import {
  checkableText,
  findDroppedRuns,
  transcriptionText,
  verifyPage,
  type OcrWordLike,
  type PageTranscription
} from '@core/transcribe'
import { pruneStaleAnswers } from '@core/wizard'

/**
 * The running head is transcribed — into `furniture`, which is where it
 * belongs.
 *
 * The vision pass lifts the head and the folio out of the body deliberately:
 * the layout engine sets its own, and a head left in the text prints twice. But
 * both cross-checks compared OCR against the *body* alone, so on a book with a
 * head on every leaf they concluded that every head and every folio in the book
 * had been dropped — one false finding per page, on a screen whose whole
 * purpose is to be worth reading.
 *
 * Worse than the noise: the recovery then offered to put the head *back into
 * the body*, and that offer used to be pre-selected. Accepting it across a book
 * prints the running head as a paragraph on every page.
 */
const page = (over: Partial<PageTranscription> = {}): PageTranscription => ({
  pageIndex: 42,
  role: 'body',
  blocks: [
    {
      kind: 'paragraph',
      text:
        'It is true in this that many scientists have accepted the theory that telepathy ' +
        'is more or less spontaneous, and cannot be produced to order. This theory is ' +
        'drawn as far as it goes, but there is a side of the case that these ' +
        'investigators overlook.'
    }
  ],
  uncertain: [],
  furniture: { runningHead: 'TELEPATHY vs. CLAIRVOYANCE', folio: '39' },
  ...over
})

/** OCR of that leaf: the head and folio are on the paper, so OCR read them. */
function ocr(text: string, confidence = 95): OcrWordLike[] {
  return text.split(/\s+/).map((word, i) => ({
    text: word,
    confidence,
    id: `p42_w${i}`
  }))
}

const scanned = (p: PageTranscription): OcrWordLike[] =>
  ocr(`${p.furniture.runningHead} ${p.furniture.folio} ${p.blocks.map((b) => b.text).join(' ')}`)

describe('page furniture is transcribed, not dropped', () => {
  it('keeps the body text free of the head — that has not changed', () => {
    // The reader's text must not carry it: this is the property the whole
    // separation exists for, and the fix must not quietly undo it.
    expect(transcriptionText(page())).not.toContain('TELEPATHY')
  })

  it('counts the head and folio as present for the checks', () => {
    const text = checkableText(page())
    expect(text).toContain('TELEPATHY vs. CLAIRVOYANCE')
    expect(text).toContain('39')
    expect(text).toContain('scientists have accepted')
  })

  it('no longer reports the running head as missing words', () => {
    const p = page()
    const findings = verifyPage(p, scanned(p))
    const missing = findings.find((f) => f.code === 'confident-word-missing')
    expect(missing).toBeUndefined()
  })

  it('reported it before the furniture was counted — the bug, pinned', () => {
    // Same page, same OCR, comparing against the body alone: this is what the
    // gate was doing on every leaf of a real book.
    const p = page()
    const bodyOnly = transcriptionText(p)
    const runs = findDroppedRuns(bodyOnly, scanned(p), { includeWeak: true })
    expect(runs.some((r) => r.text.includes('TELEPATHY'))).toBe(true)
  })

  it('does not offer to splice the running head into the body', () => {
    const p = page()
    const runs = findDroppedRuns(checkableText(p), scanned(p), { includeWeak: true })
    expect(runs.some((r) => r.text.includes('TELEPATHY'))).toBe(false)
    expect(runs.some((r) => r.text.trim() === '39')).toBe(false)
  })

  it('still catches text that really is missing from a leaf with furniture', () => {
    // The fix must not buy its quiet by going blind. A clause absent from the
    // body is still absent, head or no head.
    const p = page()
    const withExtra = ocr(
      `${p.furniture.runningHead} ${p.furniture.folio} ` +
        'It is true in this that many scientists have accepted the theory that telepathy ' +
        'is more or less spontaneous, and cannot be produced to order. ' +
        'Their most brilliant successes have been obtained by reason of their unconscious ' +
        'setting up of the astral telepathic sense. ' +
        'This theory is drawn as far as it goes, but there is a side of the case that these ' +
        'investigators overlook.'
    )
    const runs = findDroppedRuns(checkableText(p), withExtra)
    expect(runs.some((r) => r.text.includes('brilliant successes'))).toBe(true)
  })
})

describe('every gap is located, not just the long ones', () => {
  const body = 'the alembick being set upon a gentle fire and left to stand'

  it('reports a one-word gap when asked, and not otherwise', () => {
    const scan = ocr('the alembick being set upon a very gentle fire and left to stand')
    expect(findDroppedRuns(body, scan)).toHaveLength(0)
    const weak = findDroppedRuns(body, scan, { includeWeak: true })
    expect(weak).toHaveLength(1)
    expect(weak[0]?.text).toBe('very')
  })

  it('marks a short gap weak and a long one strong', () => {
    const scan = ocr(
      'the alembick being set upon a very gentle fire and afterwards drawn off by degrees ' +
        'and left to stand'
    )
    const runs = findDroppedRuns(body, scan, { includeWeak: true })
    const short = runs.find((r) => r.text === 'very')
    // Matched by prefix: the alignment carries the trailing "and" into the gap,
    // because the body's own "and" matches the later one. That is the aligner
    // being right about where the gap ends, not a stray word.
    const long = runs.find((r) => r.text.startsWith('afterwards drawn off by degrees'))
    expect(short?.strength).toBe('weak')
    expect(long?.strength).toBe('strong')
  })

  it('carries the ids of the words it is talking about', () => {
    const scan = ocr('the alembick being set upon a very gentle fire and left to stand')
    const runs = findDroppedRuns(body, scan, { includeWeak: true })
    // The whole point of the id: it names a box on the scan, which is what
    // turns "a word is missing" into a picture of the word.
    expect(runs[0]?.tokenIds).toHaveLength(1)
    expect(runs[0]?.tokenIds[0]).toMatch(/^p42_w\d+$/)
  })

  it('leaves the ids empty rather than inventing them when OCR gave none', () => {
    const scan = 'the alembick being set upon a very gentle fire and left to stand'
      .split(' ')
      .map((text) => ({ text, confidence: 95 }))
    const runs = findDroppedRuns(body, scan, { includeWeak: true })
    expect(runs[0]?.tokenIds).toEqual([])
  })
})

describe('a verdict saved against an option that no longer exists', () => {
  /**
   * Written for the book that is already half worked through.
   *
   * `restore` was a real answer last week and is not one now, so a leaf
   * answered with it would come back from storage naming nothing: the radio
   * unselected, the leaf apparently unvisited, and an evening's decisions
   * looking lost. Nothing about the *transcription* is at risk here — that is
   * stored separately and never rewritten — but the progress is, and progress
   * is the other thing in this app that costs a person real time.
   */
  const leaf = {
    id: 'page-16',
    type: 'choice' as const,
    prompt: 'Page 17',
    defaultValue: 'accept',
    options: [
      { value: 'accept', label: 'Looks fine' },
      { value: 'skip', label: 'Leave this page out' }
    ]
  }

  it('drops the retired answer', () => {
    expect(pruneStaleAnswers([leaf], { 'page-16': 'restore' })).toEqual({})
  })

  it('keeps every answer that is still offered', () => {
    expect(pruneStaleAnswers([leaf], { 'page-16': 'skip' })).toEqual({ 'page-16': 'skip' })
  })

  it('leaves typed and per-row answers alone', () => {
    // Only a fixed list of options can go stale. What the user typed, and the
    // per-gap verdicts, are theirs and are never second-guessed.
    const typed = { 'page-16-fix': { p16b0: 'the chirurgeon' } }
    const gaps = { 'page-16-gaps': { p16d0: 'restore' as const } }
    expect(pruneStaleAnswers([leaf], typed)).toEqual(typed)
    expect(pruneStaleAnswers([leaf], gaps)).toEqual(gaps)
  })

  it('keeps answers for questions this step does not have', () => {
    // Another gate's answers travel in the same record; pruning must not eat
    // them just because they are not on this screen.
    const other = { 'some-other-question': 'value' }
    expect(pruneStaleAnswers([leaf], other)).toEqual(other)
  })
})
