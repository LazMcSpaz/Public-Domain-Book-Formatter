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

  it('reads a digit only when something follows it that a number would not', () => {
    expect(printedMarker('1. See Croll, lib. ii.')).toBe('1')
    expect(printedMarker('12) Ibid.')).toBe('12')
    expect(printedMarker('1662 was the year of the plague')).toBeNull()
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
   * The narrowness is the safety. Only the **first** note on a leaf can be a
   * runover; a markerless note with others above it on the same leaf is some
   * other thing, and leaf 216 of this volume is exactly that. It stays its own
   * note and `verifyPage` goes on flagging it, which is the right answer for a
   * case nobody has looked at.
   */
  it('does not join a markerless note that has notes above it on its own leaf', () => {
    const doc = assembleBook([
      leaf(12, [
        { kind: 'paragraph', text: 'Body.*' },
        { kind: 'footnote', marker: '*', text: '* First note.' }
      ]),
      leaf(13, [
        { kind: 'paragraph', text: 'More body.†' },
        { kind: 'footnote', marker: '†', text: '† Second note.' },
        { kind: 'footnote', text: 'A third thing with no mark at all.' }
      ])
    ])
    expect(doc.footnotes).toHaveLength(3)
    expect(doc.footnotes[2]!.text).toBe('A third thing with no mark at all.')
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
