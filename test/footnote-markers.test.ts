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
