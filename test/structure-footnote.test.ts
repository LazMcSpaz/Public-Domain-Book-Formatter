import { describe, it, expect } from 'vitest'
import { linkFootnote, footnoteTagData } from '@core/structure'
import type { FootnoteLink } from '@core/structure'

const markdown = 'See the text here1 and at the bottom the note body follows'

describe('linkFootnote', () => {
  it('links a ref range to a note range and derives the marker', () => {
    const refRange = { start: 17, end: 18 } // the "1"
    const noteRange = { start: 38, end: 57 }
    const link = linkFootnote({ markdown, refRange, noteRange })
    expect(link.refRange).toEqual(refRange)
    expect(link.noteRange).toEqual(noteRange)
    expect(link.marker).toBe('1')
  })

  it('honors an explicit marker over the derived one', () => {
    const link = linkFootnote({
      markdown,
      refRange: { start: 17, end: 18 },
      noteRange: { start: 38, end: 57 },
      marker: '*',
    })
    expect(link.marker).toBe('*')
  })

  it('falls back to "*" when the ref slice is empty/whitespace', () => {
    const md = 'word     more'
    const link = linkFootnote({
      markdown: md,
      refRange: { start: 4, end: 6 },
      noteRange: { start: 9, end: 13 },
    })
    expect(link.marker).toBe('*')
  })

  it('copies ranges (does not alias the inputs)', () => {
    const refRange = { start: 0, end: 1 }
    const noteRange = { start: 2, end: 3 }
    const link = linkFootnote({ markdown: 'a b c', refRange, noteRange })
    refRange.start = 99
    expect(link.refRange.start).toBe(0)
  })
})

describe('footnoteTagData', () => {
  it('flattens a link into primitive tag data', () => {
    const link: FootnoteLink = {
      refRange: { start: 17, end: 18 },
      noteRange: { start: 38, end: 57 },
      marker: '1',
    }
    expect(footnoteTagData(link)).toEqual({
      marker: '1',
      refStart: 17,
      refEnd: 18,
      noteStart: 38,
      noteEnd: 57,
    })
  })
})
