import { describe, it, expect } from 'vitest'
import { assembleBook, printedMarker } from '@core/assemble'
import { verifyPage } from '@core/transcribe'
import type { PageTranscription } from '@core/transcribe'

describe('the mark a note opens with', () => {
  it('reads a symbol off the front', () => {
    expect(printedMarker('† See Gibbon, vol. ii.')).toBe('†')
    expect(printedMarker('* W. Crookes, F.R.S.')).toBe('*')
    expect(printedMarker('‡ Ibid.')).toBe('‡')
  })

  /**
   * Leaf 358 of *Isis Unveiled* Vol. I carries nine notes, so the printer runs
   * past the six symbols and starts again doubled. Matching a single symbol
   * read `** With the Gnostics` as `*` — a mark another note on that same leaf
   * already owns, so the note would have been filed under it, the body's `**`
   * reference would have reached nothing, and `stripLeadingMarker` would have
   * left the second asterisk in the text.
   */
  it('reads a doubled mark as one marker', () => {
    expect(printedMarker('** With the Gnostics, Christ was identical')).toBe('**')
    expect(printedMarker('†† “Codex Nazaræus,” i. 135.')).toBe('††')
    expect(printedMarker('‡‡ Ibid.')).toBe('‡‡')
  })

  /**
   * Only a repeat of the *same* symbol. `*†` at the head of a note is two marks
   * that have run together — most likely two notes a reader filed as one — and
   * calling it a single marker would hide that rather than report it. And only
   * two: this tradition doubles and does not treble, so a third tier would be
   * invented rather than read.
   */
  it('does not join two different marks, or take a third', () => {
    expect(printedMarker('*† Two notes run together')).toBe('*')
    expect(printedMarker('*** Ibid.')).toBe('**')
  })

  it('reads a digit only when punctuation follows it', () => {
    expect(printedMarker('1. See Croll, lib. ii.')).toBe('1')
    expect(printedMarker('12) Ibid.')).toBe('12')
    expect(printedMarker('1662 was the year of the plague')).toBeNull()
  })

  /**
   * Whitespace after the digit is not enough, and this is why. Leaf 275 of
   * *Isis Unveiled* carries the note `1 Kings, i. 1-4, 15.` under a printed
   * `*`. Reading its marker as `1` made `verifyPage` report a contradiction
   * that was not there — and a note with no declared field would have been
   * filed under a mark the page never printed.
   */
  it('does not read the first word of a citation as a marker', () => {
    expect(printedMarker('1 Kings, i. 1-4, 15.')).toBeNull()
    expect(printedMarker('2 Corinthians xii.')).toBeNull()
    expect(printedMarker('1 vol., Paris, 1855.')).toBeNull()
  })

  it('reads a superscript back to its digit', () => {
    expect(printedMarker('¹ See Croll.')).toBe('1')
  })

  it('is null for a note that opens with a word', () => {
    expect(printedMarker('See Gibbon, vol. ii.')).toBeNull()
  })
})

const page = (blocks: PageTranscription['blocks']): PageTranscription => ({
  pageIndex: 12,
  role: 'body',
  blocks,
  uncertain: [],
  furniture: {}
})

/**
 * The fault this exists for, measured on a real book: six notes in one chapter
 * of *Isis Unveiled* were transcribed with the mark left in the text and the
 * `marker` field omitted. The fallback was a bare `*`, so a note the page marks
 * `†` was filed as `*` — which keeps the `†` in the printed text and then makes
 * `markOrphanFootnotes` look in the body for a mark that is not there.
 */
describe('assembly files a note under the mark the page prints', () => {
  const noteOn = (text: string, marker?: string): PageTranscription =>
    page([
      { kind: 'paragraph', text: 'The body of the leaf, with a mark on it.†' },
      { kind: 'footnote', text, ...(marker === undefined ? {} : { marker }) }
    ])

  it('takes the marker off the text when the field is missing', () => {
    const doc = assembleBook([noteOn('† See Gibbon, vol. ii.')])
    expect(doc.footnotes[0]!.originalMarker).toBe('†')
    expect(doc.footnotes[0]!.text).toBe('See Gibbon, vol. ii.')
  })

  it('falls back to an asterisk only when the text carries no mark either', () => {
    const doc = assembleBook([noteOn('See Gibbon, vol. ii.')])
    expect(doc.footnotes[0]!.originalMarker).toBe('*')
  })

  it('keeps the declared field when there is one', () => {
    const doc = assembleBook([noteOn('‡ See Gibbon.', '‡')])
    expect(doc.footnotes[0]!.originalMarker).toBe('‡')
    expect(doc.footnotes[0]!.text).toBe('See Gibbon.')
  })
})

describe('the leaf reports what assembly could not settle', () => {
  const ocr = [{ text: 'body', confidence: 95 }]

  it('says a marker was read off the text rather than declared', () => {
    const found = verifyPage(page([{ kind: 'footnote', text: '† See Gibbon.' }]), ocr).filter(
      (f) => f.code === 'orphan-footnote'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/read off the front/)
  })

  it('still reports a note with no mark anywhere', () => {
    const found = verifyPage(page([{ kind: 'footnote', text: 'See Gibbon.' }]), ocr).filter(
      (f) => f.code === 'orphan-footnote'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/does not open with one either/)
  })

  /**
   * A contradiction inside one leaf: either the transcriber typed the wrong
   * field or read the wrong mark off the page, and nothing here can tell which.
   * Medium, so it reaches the review gate.
   */
  it('reports a note filed under one mark and opening with another', () => {
    const found = verifyPage(
      page([{ kind: 'footnote', marker: '*', text: '† See Gibbon.' }]),
      ocr
    ).filter((f) => f.code === 'footnote-marker')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('medium')
    expect(found[0]!.message).toMatch(/declared "\*", printed "†"/)
  })

  it('says nothing when the field and the page agree', () => {
    const found = verifyPage(
      page([{ kind: 'footnote', marker: '†', text: '† See Gibbon.' }]),
      ocr
    ).filter((f) => f.code === 'footnote-marker' || f.code === 'orphan-footnote')
    expect(found).toEqual([])
  })
})

/**
 * A note that runs over onto the next leaf.
 *
 * The page prints the marker once, at the head of the note, and does not repeat
 * it on the continuation — so the runover arrives with no marker and no mark in
 * its text. Filed as a note of its own it becomes a second note under the `*`
 * fallback: the reader gets the note in two pieces, and the orphan half prints
 * as a collected endnote at the back of the book, alone and meaning nothing.
 *
 * Three of 240 notes across five chapters of *Isis Unveiled* Vol. I.
 */
describe('a footnote that runs over onto the next leaf', () => {
  const leaf = (pageIndex: number, blocks: PageTranscription['blocks']): PageTranscription => ({
    pageIndex,
    role: 'body',
    blocks,
    uncertain: [],
    furniture: {}
  })

  it('joins the continuation to the note it continues', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'The body of leaf twelve, with a mark on it.*' },
        { kind: 'footnote', marker: '*', text: '* See Gibbon, who observes that the' }
      ]),
      leaf(13, [
        { kind: 'footnote', text: 'decline was long in coming.' },
        { kind: 'paragraph', text: 'The body of leaf thirteen.' }
      ])
    ])
    expect(doc.footnotes).toHaveLength(1)
    expect(doc.footnotes[0]!.text).toBe(
      'See Gibbon, who observes that the decline was long in coming.'
    )
    expect(doc.footnotes[0]!.originalMarker).toBe('*')
  })

  it('carries the continuation’s emphasis across the join, shifted', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'Body.*' },
        { kind: 'footnote', marker: '*', text: '* See the' }
      ]),
      leaf(13, [{ kind: 'footnote', text: 'Decline and Fall, vol. ii.', emphasis: [0, 1, 2] }])
    ])
    // "See the Decline and Fall, vol. ii." — the three italic words are 2, 3, 4.
    expect(doc.footnotes[0]!.emphasis).toEqual([2, 3, 4])
  })

  /**
   * The same shape lower down a leaf, which the rule used to decline.
   *
   * Leaf 216 of this volume sets a `*` note, a `†` note, and then a third
   * paragraph with no mark — a further paragraph of the `†` note, not a third
   * note. Leaf 287 is the case that forced the look: one `*` note in five
   * paragraphs, the mark on the first, and the body carrying exactly one
   * reference. Under the old rule that leaf produced one note and four orphan
   * `*` endnotes at the back of the book.
   */
  it('joins a markerless note that has notes above it on its own leaf', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'Body.*' },
        { kind: 'footnote', marker: '*', text: '* First note.' }
      ]),
      leaf(13, [
        { kind: 'paragraph', text: 'More body.†' },
        { kind: 'footnote', marker: '†', text: '† Second note.' },
        { kind: 'footnote', text: 'A further paragraph of it, with no mark at all.' }
      ])
    ])
    expect(doc.footnotes).toHaveLength(2)
    expect(doc.footnotes[1]!.originalMarker).toBe('†')
    expect(doc.footnotes[1]!.text).toBe(
      'Second note. A further paragraph of it, with no mark at all.'
    )
  })

  /**
   * Leaf 287 itself, in miniature: one mark in the body, one in the notes, and
   * four paragraphs under it carrying none. The count is the assertion — under
   * the narrow rule this was five notes, four of them orphans, and the orphans
   * are what print at the back of the book meaning nothing.
   */
  it('gathers every markerless paragraph of one note, not just the first', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'Tritenheim left their recipes for it.*' },
        { kind: 'footnote', marker: '*', text: '* Sublime them into flowers.' },
        { kind: 'footnote', text: 'The other is as follows :' },
        { kind: 'footnote', text: 'Affuse over it strong wine vinegar.' },
        { kind: 'footnote', text: 'These are the eternal lights of Tritenheimus.' },
        { kind: 'footnote', text: 'We may add that we have ourselves seen a lamp.' }
      ])
    ])
    expect(doc.footnotes).toHaveLength(1)
    expect(doc.footnotes[0]!.originalMarker).toBe('*')
    expect(doc.footnotes[0]!.text).toBe(
      'Sublime them into flowers. The other is as follows : ' +
        'Affuse over it strong wine vinegar. ' +
        'These are the eternal lights of Tritenheimus. ' +
        'We may add that we have ourselves seen a lamp.'
    )
  })

  it('does not join a note that opens with a mark of its own', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'Body.*' },
        { kind: 'footnote', marker: '*', text: '* First note.' }
      ]),
      leaf(13, [{ kind: 'footnote', text: '† A second note, marked on the page.' }])
    ])
    expect(doc.footnotes).toHaveLength(2)
    expect(doc.footnotes[1]!.originalMarker).toBe('†')
  })
})

/**
 * The real leaf the digit rule was tightened for.
 */
describe('a note that opens with the name of a book of the Bible', () => {
  it('is not a contradiction', () => {
    const found = verifyPage(
      {
        pageIndex: 275,
        role: 'body',
        furniture: {},
        uncertain: [],
        blocks: [
          { kind: 'paragraph', text: 'the warmth of the young Abishag ; * and the medical' },
          { kind: 'footnote', marker: '*', text: '1 Kings, i. 1-4, 15.' }
        ]
      },
      [{ text: 'abishag', confidence: 95 }]
    ).filter((f) => f.code === 'footnote-marker' || f.code === 'orphan-footnote')
    expect(found).toEqual([])
  })
})
