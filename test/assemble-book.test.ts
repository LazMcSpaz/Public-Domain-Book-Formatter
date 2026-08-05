import { describe, it, expect } from 'vitest'
import {
  assembleBook,
  shouldJoin,
  joinText,
  bookWordCount,
  seamCount,
  stripSoftHyphens
} from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'
import type { PageRole } from '@core/pages'

function page(
  pageIndex: number,
  blocks: TranscribedBlock[],
  role: PageRole = 'body'
): PageTranscription {
  return { pageIndex, role, blocks, uncertain: [], furniture: {} }
}

const para = (text: string, extra: Partial<TranscribedBlock> = {}): TranscribedBlock => ({
  kind: 'paragraph',
  text,
  ...extra
})

describe('shouldJoin', () => {
  it('joins when the model marked the seam', () => {
    expect(shouldJoin(para('The spirit', { continuesNext: true }), para('ascendeth.'))).toBe(true)
    expect(shouldJoin(para('The spirit'), para('ascendeth.', { continuesPrevious: true }))).toBe(
      true
    )
  })

  it('joins an unterminated sentence followed by lowercase', () => {
    expect(shouldJoin(para('the alembick being set upon'), para('a gentle fire.'))).toBe(true)
  })

  it('does not join across a completed sentence', () => {
    expect(shouldJoin(para('It was done.'), para('A new thought begins.'))).toBe(false)
  })

  it('does not join when the next block starts a new sentence', () => {
    expect(shouldJoin(para('the alembick being set upon'), para('Nowe the chirurgeon'))).toBe(false)
  })

  it('never joins across different block kinds', () => {
    expect(shouldJoin(para('unterminated text'), { kind: 'heading', text: 'chapter v' })).toBe(
      false
    )
  })

  it('joins a hyphenated word even though it ends with punctuation-ish', () => {
    expect(shouldJoin(para('the chirur-'), para('geon his art'))).toBe(true)
  })
})

describe('joinText', () => {
  it('heals a word split by the page break', () => {
    expect(joinText('the chirur-', 'geon his art')).toBe('the chirurgeon his art')
  })

  it('heals a trailing soft hyphen at a page seam', () => {
    expect(joinText('quintes\u00AD', 'sence')).toBe('quintessence')
  })

  it('otherwise joins with a single space', () => {
    expect(joinText('the alembick being set upon', 'a gentle fire.')).toBe(
      'the alembick being set upon a gentle fire.'
    )
  })
})

describe('stripSoftHyphens', () => {
  it('removes invisible soft hyphens that would survive into the book', () => {
    expect(stripSoftHyphens('quintes\u00ADsence')).toBe('quintessence')
  })

  it('leaves real hyphens alone', () => {
    expect(stripSoftHyphens('well-nigh')).toBe('well-nigh')
  })
})

describe('assembleBook', () => {
  it('stitches a paragraph that runs across a page boundary', () => {
    const doc = assembleBook([
      page(0, [para('the alembick being set upon', { continuesNext: true })]),
      page(1, [para('a gentle fire.', { continuesPrevious: true })])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]!.text).toBe('the alembick being set upon a gentle fire.')
    expect(doc.blocks[0]!.sourcePages).toEqual([0, 1])
    expect(seamCount(doc)).toBe(1)
  })

  it('heals a hyphenated word broken by the page edge', () => {
    const doc = assembleBook([
      page(0, [para('and so the chirur-', { continuesNext: true })]),
      page(1, [para('geon proceeded.', { continuesPrevious: true })])
    ])
    expect(doc.blocks[0]!.text).toBe('and so the chirurgeon proceeded.')
  })

  it('keeps genuinely separate paragraphs apart', () => {
    const doc = assembleBook([
      page(0, [para('A complete thought.')]),
      page(1, [para('Another complete thought.')])
    ])
    expect(doc.blocks).toHaveLength(2)
  })

  it('mines front matter for metadata instead of transcribing it', () => {
    const doc = assembleBook([
      page(0, [para('THE ALCHEMIST HIS PRACTISE')], 'title-page'),
      page(1, [para('Entered according to Act of Parliament')], 'copyright'),
      page(2, [para('Real body text.')])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]!.text).toBe('Real body text.')
    expect(doc.skipped.map((s) => s.role)).toEqual(['title-page', 'copyright'])
  })

  it('discards the scanned TOC and index — their page numbers are the old edition’s', () => {
    const doc = assembleBook([
      page(0, [para('CONTENTS … 37')], 'table-of-contents'),
      page(1, [para('Body.')]),
      page(2, [para('INDEX … 41')], 'index')
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.skipped.map((s) => s.role).sort()).toEqual(['index', 'table-of-contents'])
    expect(doc.skipped[0]!.reason).toBeTruthy()
  })

  it('sets dedications and epigraphs aside from the main flow', () => {
    const doc = assembleBook([
      page(0, [para('To my patron.')], 'dedication'),
      page(1, [para('Body text.')])
    ])
    expect(doc.asides).toHaveLength(1)
    expect(doc.asides[0]!.text).toBe('To my patron.')
    expect(doc.blocks).toHaveLength(1)
  })

  it('pulls footnotes out of the body and links them by marker', () => {
    const doc = assembleBook([
      page(0, [
        para('It helde it soveraigne against all putrefaction.1'),
        { kind: 'footnote', text: 'See the Basilica Chymica of Croll.', marker: '1' }
      ])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]!.text).not.toContain('Basilica')
    expect(doc.footnotes).toHaveLength(1)
    expect(doc.footnotes[0]).toMatchObject({ id: 'fn1', originalMarker: '1', orphaned: false })
  })

  it('flags a footnote whose marker never appears in the body', () => {
    const doc = assembleBook([
      page(0, [
        para('Body text with no reference mark.'),
        { kind: 'footnote', text: 'A stranded note.', marker: '7' }
      ])
    ])
    expect(doc.footnotes[0]!.orphaned).toBe(true)
  })

  it('does not match a footnote digit inside a longer number', () => {
    // "1" must not be considered referenced just because "1662" appears.
    const doc = assembleBook([
      page(0, [
        para('Printed in the yeare 1662.'),
        { kind: 'footnote', text: 'A note.', marker: '1' }
      ])
    ])
    expect(doc.footnotes[0]!.orphaned).toBe(true)
  })

  it('derives chapters for the regenerated table of contents', () => {
    const doc = assembleBook([
      page(0, [{ kind: 'heading', text: 'Chapter IV', level: 1 }, para('Body.')]),
      page(1, [{ kind: 'heading', text: 'Of Simples', level: 2 }, para('More.')])
    ])
    expect(doc.chapters).toHaveLength(2)
    expect(doc.chapters[0]).toMatchObject({ title: 'Chapter IV', level: 1, sourcePage: 0 })
    expect(doc.chapters[1]!.level).toBe(2)
  })

  it('orders pages regardless of the order supplied', () => {
    const doc = assembleBook([
      page(2, [para('Third.')]),
      page(0, [para('First.')]),
      page(1, [para('Second.')])
    ])
    expect(doc.blocks.map((b) => b.text)).toEqual(['First.', 'Second.', 'Third.'])
  })

  it('can be told to keep every page, ignoring dispositions', () => {
    const doc = assembleBook(
      [page(0, [para('THE ALCHEMIST')], 'title-page'), page(1, [para('Body.')])],
      { applyDispositions: false }
    )
    expect(doc.blocks).toHaveLength(2)
    expect(doc.skipped).toHaveLength(0)
  })

  it('strips stray soft hyphens from assembled text', () => {
    const doc = assembleBook([page(0, [para('quintes\u00ADsence of everie thing')])])
    expect(doc.blocks[0]!.text).toBe('quintessence of everie thing')
  })

  it('counts the assembled words', () => {
    const doc = assembleBook([page(0, [para('one two three'), para('four five')])])
    expect(bookWordCount(doc)).toBe(5)
  })

  it('handles an empty book without throwing', () => {
    const doc = assembleBook([])
    expect(doc).toMatchObject({ blocks: [], footnotes: [], chapters: [], asides: [], skipped: [] })
  })
})
