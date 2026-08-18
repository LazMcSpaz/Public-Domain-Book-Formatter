import { describe, it, expect } from 'vitest'
import {
  checkableText,
  findDroppedRuns,
  healLineBreaks,
  transcriptionText,
  verifyPage,
  type OcrWordLike,
  type PageTranscription
} from '@core/transcribe'
import {
  initialState,
  messagesByPage,
  pruneStaleAnswers,
  settledLeaves,
  stepById,
  type WizardState
} from '@core/wizard'
import { spotsFromStored } from '@core/adjudicate'
import { unionBox } from '../src/platform/browser/word-crops'

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

/**
 * "Looks fine" is both the pre-selected answer and the one that removes a leaf
 * from the proof sheet. Those two facts together are a trap: on a book with a
 * hundred and sixty flagged leaves, tapping through the gate would mark every
 * one of them checked and leave the proof step with nothing in it — the flags
 * gone, and no sign they were ever raised.
 *
 * So the rule is a fact rather than a claim: a leaf carrying disagreements is
 * reviewed only once each of them has a verdict. Deciding them is the work the
 * grid exists to collect, and having done it is the evidence that the leaf was
 * actually read.
 *
 * Expressed here as the predicate `App` applies, so the rule is pinned even
 * though the wiring around it is not pure.
 */
describe('a leaf counts as reviewed only when its gaps are decided', () => {
  const isReviewed = (gapCount: number, decided: Record<string, string> | undefined): boolean => {
    if (gapCount === 0) return true
    return (
      decided !== undefined &&
      decided !== null &&
      typeof decided === 'object' &&
      !Array.isArray(decided) &&
      Object.keys(decided).length >= gapCount
    )
  }

  it('is reviewed when the leaf had nothing to disagree about', () => {
    expect(isReviewed(0, undefined)).toBe(true)
  })

  it('is not reviewed when the gaps were never looked at', () => {
    expect(isReviewed(3, undefined)).toBe(false)
    expect(isReviewed(3, {})).toBe(false)
  })

  it('is not reviewed when only some gaps were decided', () => {
    expect(isReviewed(3, { p1d0: 'ignore' })).toBe(false)
  })

  it('is reviewed once every gap has a verdict', () => {
    expect(isReviewed(3, { p1d0: 'ignore', p1d1: 'restore', p1d2: 'ignore' })).toBe(true)
  })

  it('counts "not missing" as deciding, not only "put it back"', () => {
    // Judging a gap to be OCR noise is a decision, and the commonest one.
    expect(isReviewed(2, { p1d0: 'ignore', p1d1: 'ignore' })).toBe(true)
  })
})

describe('the picture a discrepancy row shows', () => {
  const at = (x0: number, y0: number, x1: number, y1: number) => ({ bbox: { x0, y0, x1, y1 } })

  it('covers every word of the run, not just the first', () => {
    // The defect this replaced: a row about a missing clause showed a crop of
    // the word "THE", because only the first box was used. The app appeared to
    // be pointing at the wrong thing, and was.
    const box = unionBox([
      { id: 'a', ...at(100, 40, 140, 60) },
      { id: 'b', ...at(145, 40, 220, 60) },
      { id: 'c', ...at(225, 38, 300, 62) }
    ])
    expect(box).toEqual({ x0: 100, y0: 38, x1: 300, y1: 62 })
  })

  it('spans both lines when a run wraps', () => {
    const box = unionBox([
      { id: 'a', ...at(400, 40, 480, 60) },
      { id: 'b', ...at(60, 70, 130, 90) }
    ])
    // A block rather than a strip, which is still the thing the row is about.
    expect(box).toEqual({ x0: 60, y0: 40, x1: 480, y1: 90 })
  })

  it('is the word itself for a one-word gap', () => {
    expect(unionBox([{ id: 'a', ...at(10, 20, 30, 40) }])).toEqual({
      x0: 10,
      y0: 20,
      x1: 30,
      y1: 40
    })
  })

  it('is null when OCR gave no boxes, rather than a crop of nothing', () => {
    expect(unionBox([])).toBeNull()
  })
})

/**
 * A leaf whose text was never going to reach the book cannot be missing text.
 *
 * The title page is mined for metadata and the scanned contents page is
 * discarded — it carries the *original* edition's pagination, which would be
 * wrong in this one. Both are deliberate, and both mean OCR reads a page full
 * of words against a body that rightly holds none of them.
 *
 * Comparing the two reports the entire leaf as dropped. On a real book that put
 * the title page at the review gate claiming every word on it was missing, with
 * an offer to splice the imprint into the start of the text.
 */
describe('leaves whose text is deliberately not carried over', () => {
  const leaf = (role: PageTranscription['role']): PageTranscription => ({
    pageIndex: 0,
    role,
    // Nothing transcribed: that is the point of these roles, not a failure.
    blocks: [],
    uncertain: [],
    furniture: {}
  })

  const imprint = ocr(
    'THE ALCHEMIST HIS PRACTISE Wherein is declared the Vertues of Hearbes Mineralls and ' +
      'Chymicall Preparations By a Student in the Spagyrick Art LONDON Printed for J Smith ' +
      'at the Signe of the Bell MDCLXII'
  )

  it('says nothing about a title page', () => {
    expect(verifyPage(leaf('title-page'), imprint)).toEqual([])
  })

  it('says nothing about a copyright page', () => {
    expect(verifyPage(leaf('copyright'), imprint)).toEqual([])
  })

  it('says nothing about the original contents page', () => {
    expect(verifyPage(leaf('table-of-contents'), imprint)).toEqual([])
  })

  it('still reports a body leaf that really was read and lost', () => {
    // The exemption is about roles, not about going quiet. A body page with
    // nothing transcribed and a page of OCR behind it is a genuine failure.
    const findings = verifyPage(leaf('body'), imprint)
    expect(findings.some((f) => f.code === 'empty-page')).toBe(true)
  })

  it('still reports a preface, which is real content', () => {
    // `preface` is front matter by position and `transcribe` by disposition —
    // the words go into the book, so losing them is a real loss.
    const findings = verifyPage(leaf('preface'), imprint)
    expect(findings.some((f) => f.code === 'empty-page')).toBe(true)
  })
})

/**
 * Reusing a transcription you already paid for is the commonest way to reach
 * the review gate, and it was the one path the second reading never ran on.
 *
 * The pass fired in exactly two places — a fresh paid read, and collecting a
 * batch. Someone who opened a book, took "use what I already paid for", and
 * arrived at a hundred and thirty flagged spots got a gate with no verdicts on
 * it and no button to ask for any. The verdicts a *previous* visit had bought
 * were dropped on the way in as well, so paying for them twice was the only
 * route back to them.
 */
describe('verdicts survive being stored with the run', () => {
  it('rebuilds a spot from what storage holds', () => {
    const back = spotsFromStored({
      p4d0: { verdict: 'not-there', reading: '', note: 'A speck of dirt read as a word.' }
    })
    expect(back['p4d0']).toEqual({
      // The id is the key it was filed under — stored once, so the two can
      // never drift apart.
      id: 'p4d0',
      verdict: 'not-there',
      reading: '',
      note: 'A speck of dirt read as a word.'
    })
  })

  it('keeps the reading, which is the field that makes a verdict checkable', () => {
    const back = spotsFromStored({
      p9d2: { verdict: 'missing', reading: 'and of the fixed salt', note: 'Clear on the page.' }
    })
    expect(back['p9d2']?.reading).toBe('and of the fixed salt')
  })

  it('drops a verdict this version does not recognise', () => {
    // Rather than pass it through to a gate that has no way to render it,
    // which shows the user a recommendation nothing can act on. The spot
    // arriving unjudged is the better failure.
    expect(spotsFromStored({ p1d0: { verdict: 'probably', reading: 'x', note: 'y' } })).toEqual({})
  })

  it('tolerates a record missing its text fields', () => {
    const back = spotsFromStored({
      p1d0: { verdict: 'unsure' } as unknown as { verdict: string; reading: string; note: string }
    })
    expect(back['p1d0']).toEqual({ id: 'p1d0', verdict: 'unsure', reading: '', note: '' })
  })

  it('keeps every well-formed spot when one beside it is broken', () => {
    const back = spotsFromStored({
      p1d0: { verdict: 'nonsense', reading: '', note: '' },
      p2d0: { verdict: 'different', reading: 'quintessence', note: 'Neither reading has it.' }
    })
    expect(Object.keys(back)).toEqual(['p2d0'])
  })
})

/**
 * The offer must count the leaves the gate shows, and no others.
 *
 * The screen said "2253 spot(s) across 308 leaf(s)" directly above "132
 * checked". Both numbers were honestly computed and they were counting
 * different things: the gate asks about leaves that produced a *finding*, and
 * the offer was counting every leaf carrying any gap at all — including the
 * weak single-word ones that never rose to a finding.
 *
 * That is not a labelling slip. The pass is priced per leaf-image, so the wider
 * set would have sent 308 leaves and billed for 176 the user is never shown.
 */
describe('which leaves the gate is asking about', () => {
  const state = (over: Partial<WizardState> = {}): WizardState => ({
    ...initialState(),
    ...over
  })

  const finding = (pageIndex: number, severity: 'high' | 'medium' | 'low') => ({
    code: 'confident-word-missing' as const,
    severity,
    pageIndex,
    message: 'words absent'
  })

  it('flags a leaf whose finding is worth stopping for', () => {
    const flagged = messagesByPage(state({ findings: [finding(3, 'high')] }))
    expect([...flagged.keys()]).toEqual([3])
  })

  it('does not flag a leaf on a low finding alone', () => {
    // Weak single-word gaps are the commonest thing OCR imagines. A gate that
    // stopped on every one would be unusable — they are still shown, under a
    // leaf something else already flagged.
    expect(messagesByPage(state({ findings: [finding(4, 'low')] })).size).toBe(0)
  })

  it('flags a leaf the model itself could not read', () => {
    const flagged = messagesByPage(
      state({
        uncertainties: [{ pageIndex: 9, text: 'chirurgeon', alternatives: [], reason: 'blurred' }]
      })
    )
    expect([...flagged.keys()]).toEqual([9])
  })

  it('gathers every reason for one leaf under it', () => {
    const flagged = messagesByPage(
      state({
        findings: [finding(2, 'high'), finding(2, 'medium')],
        uncertainties: [{ pageIndex: 2, text: 'x', alternatives: ['y'], reason: 'blurred' }]
      })
    )
    expect(flagged.get(2)).toHaveLength(3)
  })

  it('is empty for a book nothing flagged, so nothing is offered or spent', () => {
    expect(messagesByPage(state()).size).toBe(0)
  })
})

/**
 * The second reading has to *shorten the queue*, not decorate it.
 *
 * As built, it attached a verdict to every spot and left all 132 flagged
 * leaves in the review — so a book cost real money to check and then asked for
 * exactly as many decisions as before. That is the expensive half of the job
 * without the useful half.
 *
 * A leaf leaves the queue only when there is genuinely nothing left to decide
 * on it, and the gate says how many went.
 */
describe('leaves the second reading answers outright', () => {
  const dismissed = { verdict: 'not-there' as const, reading: '', note: 'imagined' }

  const at = (over: Partial<WizardState> = {}): WizardState => ({
    ...initialState(),
    findings: [
      { code: 'confident-word-missing', severity: 'medium', pageIndex: 7, message: '3 words' }
    ],
    droppedRuns: {
      7: [
        {
          words: ['a'],
          text: 'a',
          tokenIds: [],
          strength: 'weak',
          confidence: 90,
          after: '',
          before: ''
        },
        {
          words: ['b'],
          text: 'b',
          tokenIds: [],
          strength: 'weak',
          confidence: 90,
          after: '',
          before: ''
        }
      ]
    },
    adjudicated: { p7d0: { id: 'p7d0', ...dismissed }, p7d1: { id: 'p7d1', ...dismissed } },
    ...over
  })

  it('drops a leaf whose every spot was OCR imagining things', () => {
    expect([...settledLeaves(at())]).toEqual([7])
  })

  it('keeps a leaf with one spot still unjudged', () => {
    const s = at({ adjudicated: { p7d0: { id: 'p7d0', ...dismissed } } })
    expect(settledLeaves(s).size).toBe(0)
  })

  it('keeps a leaf where the words really are missing', () => {
    // Putting words *into* a book is the consequential direction, and stays a
    // human's call however good the reading behind it.
    const s = at({
      adjudicated: {
        p7d0: { id: 'p7d0', ...dismissed },
        p7d1: { id: 'p7d1', verdict: 'missing', reading: 'the fixed salt', note: 'clear' }
      }
    })
    expect(settledLeaves(s).size).toBe(0)
  })

  it('keeps a leaf the reading could not settle', () => {
    const s = at({
      adjudicated: {
        p7d0: { id: 'p7d0', ...dismissed },
        p7d1: { id: 'p7d1', verdict: 'unsure', reading: '', note: 'too faint' }
      }
    })
    expect(settledLeaves(s).size).toBe(0)
  })

  it('keeps a leaf flagged for something spots cannot answer', () => {
    // An empty page — the cover — is not a question about a gap mid-paragraph,
    // so settling every gap on it leaves the real reason untouched.
    const s = at({
      findings: [
        { code: 'confident-word-missing', severity: 'medium', pageIndex: 7, message: '3 words' },
        { code: 'empty-page', severity: 'high', pageIndex: 7, message: 'nothing transcribed' }
      ]
    })
    expect(settledLeaves(s).size).toBe(0)
  })

  it('keeps a leaf the model itself said it could not read', () => {
    const s = at({
      uncertainties: [{ pageIndex: 7, text: 'chirurgeon', alternatives: [], reason: 'blurred' }]
    })
    expect(settledLeaves(s).size).toBe(0)
  })

  it('settles nothing before the reading has run', () => {
    expect(settledLeaves(at({ adjudicated: {} })).size).toBe(0)
  })

  it('takes the settled leaves out of the gate', () => {
    const ready: WizardState = {
      ...at(),
      pageText: { 7: 'some text' },
      completed: ['intake', 'recon', 'gate-identity', 'transcribe']
    }
    const qs = stepById('gate-uncertainties').questions(ready)
    expect(qs.some((q) => q.id === 'page-7')).toBe(false)
  })

  it('leaves an unsettled leaf in the gate, so the queue is not merely emptied', () => {
    const ready: WizardState = {
      ...at({ adjudicated: {} }),
      pageText: { 7: 'some text' },
      completed: ['intake', 'recon', 'gate-identity', 'transcribe']
    }
    expect(
      stepById('gate-uncertainties')
        .questions(ready)
        .some((q) => q.id === 'page-7')
    ).toBe(true)
  })

  /**
   * What was settled is *stated*, above the list, not asked inside the pager.
   *
   * It went in as a `confirm` first, which put a statement about the whole gate
   * on one screen out of forty — paged past before the leaves it explains. The
   * count is exported so the app can say it where it stays visible.
   */
  it('reports a count the app can state', () => {
    expect(settledLeaves(at()).size).toBe(1)
  })
})

/**
 * A word broken across a line is not a missing word.
 *
 * The vision pass reads the page and writes `proceed`. OCR reads the same page
 * and emits `pro-` and `ceed`, because the line ended mid-word. Neither half
 * matches anything in the transcription, so both were reported as absent — and
 * the row asked the user to judge a word that was already correct, where the
 * only wrong answer ("put it back") writes `pro- ceed proceed` into the book.
 *
 * Reported from a real leaf. Every hyphenated line break in a book produced one
 * of these, which on three hundred leaves is hundreds of them.
 */
describe('hyphenated line breaks', () => {
  const boxes = (text: string): OcrWordLike[] =>
    text.split(/\s+/).map((word, i) => ({ text: word, confidence: 94, id: `p13_w${i}` }))

  it('joins the halves OCR saw', () => {
    const healed = healLineBreaks(boxes('compelled to pro- ceed along lines'))
    expect(healed.map((w) => w.text)).toEqual(['compelled', 'to', 'proceed', 'along', 'lines'])
  })

  it('no longer calls the healed word missing', () => {
    const body = 'I have been compelled to proceed along lines exactly opposite'
    const scan = boxes('I have been compelled to pro- ceed along lines exactly opposite')
    expect(findDroppedRuns(body, scan, { includeWeak: true })).toEqual([])
  })

  it('takes the worse half’s confidence, since a join is only as good as its ends', () => {
    const healed = healLineBreaks([
      { text: 'chirur-', confidence: 91 },
      { text: 'geon', confidence: 62 }
    ])
    expect(healed[0]).toEqual({ text: 'chirurgeon', confidence: 62 })
  })

  it('keeps the first half’s id, so a crop still points at the word', () => {
    const healed = healLineBreaks(boxes('pro- ceed'))
    expect(healed[0]?.id).toBe('p13_w0')
  })

  it('heals a soft hyphen the same way', () => {
    const healed = healLineBreaks([
      { text: 'chirur­', confidence: 90 },
      { text: 'geon', confidence: 90 }
    ])
    expect(healed[0]?.text).toBe('chirurgeon')
  })

  it('leaves a trailing hyphen with nothing after it alone', () => {
    // The last word on a page. Assembly joins that across the seam; there is
    // nothing here to join it to, and inventing a join would be worse.
    expect(healLineBreaks([{ text: 'pro-', confidence: 90 }])[0]?.text).toBe('pro-')
  })

  it('does not swallow a word that merely contains a hyphen', () => {
    const healed = healLineBreaks(boxes('a well-known fact'))
    expect(healed.map((w) => w.text)).toEqual(['a', 'well-known', 'fact'])
  })

  it('still finds text that really is missing on the same leaf', () => {
    const body = 'I have been compelled to proceed along lines'
    const scan = boxes('I have been compelled to pro- ceed along quite different lines')
    const runs = findDroppedRuns(body, scan, { includeWeak: true })
    expect(runs.some((r) => r.text.includes('quite different'))).toBe(true)
  })
})
