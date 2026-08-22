import { describe, it, expect } from 'vitest'
import {
  assembleBook,
  shouldJoin,
  joinText,
  bookWordCount,
  seamCount,
  stripSoftHyphens,
  footnoteMarkerPattern,
  stripLeadingMarker
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

describe('footnoteMarkerPattern', () => {
  const finds = (marker: string, text: string) => {
    const pattern = footnoteMarkerPattern(marker)
    return pattern !== null && pattern.test(text)
  }

  it('finds a plain digit marker', () => {
    expect(finds('1', 'against all putrefaction.1')).toBe(true)
  })

  it('finds the superscript form the model actually emits', () => {
    // Observed against the live API: the model reports marker "1" but writes
    // the reference mark in the text as "¹". Matching only the plain form
    // orphaned every numbered footnote in the book.
    expect(finds('1', 'from the grosse.¹ Herbes gathered')).toBe(true)
  })

  it('handles superscripts drawn from both Unicode blocks', () => {
    // ¹²³ are Latin-1; the rest come from U+2070.
    expect(finds('2', 'a note.² More')).toBe(true)
    expect(finds('3', 'a note.³ More')).toBe(true)
    expect(finds('4', 'a note.⁴ More')).toBe(true)
    expect(finds('9', 'a note.⁹ More')).toBe(true)
  })

  it('finds a multi-digit superscript marker', () => {
    expect(finds('12', 'as Croll hath shewn.¹² Herbes')).toBe(true)
  })

  it('does not match a digit marker inside a numeral', () => {
    expect(finds('1', 'printed in 1662.')).toBe(false)
  })

  it('does not match a superscript marker inside a longer superscript run', () => {
    expect(finds('1', 'a note.¹² More')).toBe(false)
  })

  it('matches symbol markers, including regex metacharacters', () => {
    expect(finds('*', 'a note here*')).toBe(true)
    expect(finds('†', 'a note here†')).toBe(true)
  })

  it('returns null for a marker that can never be located', () => {
    expect(footnoteMarkerPattern('')).toBeNull()
    expect(footnoteMarkerPattern('   ')).toBeNull()
  })
})

describe('assembleBook — superscript footnote references', () => {
  it('does not orphan a note whose reference mark is superscript', () => {
    const doc = assembleBook([
      {
        pageIndex: 0,
        role: 'body',
        blocks: [
          { kind: 'paragraph', text: 'the separation of the subtile from the grosse.¹' },
          { kind: 'footnote', text: 'See Croll, Basilica Chymica, lib. ii.', marker: '1' }
        ],
        uncertain: [],
        furniture: {}
      }
    ])
    expect(doc.footnotes[0]!.orphaned).toBe(false)
  })
})

describe('stripLeadingMarker', () => {
  it('drops the marker the printed page repeats at the head of the note', () => {
    // Observed against the live API: the model returns marker "1" *and* text
    // beginning "1. ", which \footnote would render as a doubled "¹1.".
    expect(stripLeadingMarker('1. See Croll, Basilica Chymica, lib. ii.', '1')).toBe(
      'See Croll, Basilica Chymica, lib. ii.'
    )
  })

  it('handles the other ways a note head is punctuated', () => {
    expect(stripLeadingMarker('1) See Croll.', '1')).toBe('See Croll.')
    expect(stripLeadingMarker('1 See Croll.', '1')).toBe('See Croll.')
    expect(stripLeadingMarker('¹ See Croll.', '1')).toBe('See Croll.')
    expect(stripLeadingMarker('* See Croll.', '*')).toBe('See Croll.')
    expect(stripLeadingMarker('† See Croll.', '†')).toBe('See Croll.')
  })

  it('leaves a note alone when it does not repeat its marker', () => {
    expect(stripLeadingMarker('See Croll, lib. ii.', '1')).toBe('See Croll, lib. ii.')
  })

  it('does not mistake a numeral for a repeated marker', () => {
    expect(stripLeadingMarker('1662 was the year of the first printing.', '1')).toBe(
      '1662 was the year of the first printing.'
    )
  })

  it('does not strip a different note’s marker', () => {
    expect(stripLeadingMarker('2. See Croll.', '1')).toBe('2. See Croll.')
  })

  it('refuses to empty a note that is only its marker', () => {
    expect(stripLeadingMarker('1.', '1')).toBe('1.')
  })

  it('is a no-op for a marker that is blank', () => {
    expect(stripLeadingMarker('  See Croll.  ', '')).toBe('See Croll.')
  })
})

describe('assembleBook — notes that repeat their marker', () => {
  it('stores the note without the duplicated head', () => {
    const doc = assembleBook([
      {
        pageIndex: 0,
        role: 'body',
        blocks: [
          { kind: 'paragraph', text: 'from the grosse.¹' },
          { kind: 'footnote', text: '1. See Croll, lib. ii.', marker: '1' }
        ],
        uncertain: [],
        furniture: {}
      }
    ])
    expect(doc.footnotes[0]!.text).toBe('See Croll, lib. ii.')
    expect(doc.footnotes[0]!.orphaned).toBe(false)
  })
})

describe('assembleBook — pages the user left out', () => {
  const page = (pageIndex: number, text: string): PageTranscription => ({
    pageIndex,
    role: 'body',
    blocks: [{ kind: 'paragraph', text }],
    uncertain: [],
    furniture: {}
  })

  it('omits an excluded page from the body', () => {
    const doc = assembleBook([page(0, 'Kept.'), page(1, 'Dropped.'), page(2, 'Also kept.')], {
      excludePages: [1]
    })
    const text = doc.blocks.map((b) => b.text).join(' ')
    expect(text).toContain('Kept.')
    expect(text).not.toContain('Dropped.')
  })

  it('accounts for it rather than letting it vanish', () => {
    const doc = assembleBook([page(0, 'Kept.'), page(1, 'Dropped.')], { excludePages: [1] })
    const record = doc.skipped.find((s) => s.pageIndex === 1)
    expect(record).toBeDefined()
    expect(record!.reason).toContain('leave this page out')
  })

  it('does not join text across the gap an excluded page leaves', () => {
    const doc = assembleBook(
      [
        {
          ...page(0, 'The alembick being'),
          blocks: [{ kind: 'paragraph', text: 'The alembick being', continuesNext: true }]
        },
        page(1, 'a middle page'),
        {
          ...page(2, 'set upon a fire.'),
          blocks: [{ kind: 'paragraph', text: 'set upon a fire.', continuesPrevious: true }]
        }
      ],
      { excludePages: [1] }
    )
    // Page 0 and page 2 were not adjacent in the original, so stitching them
    // would invent a sentence the book never had.
    expect(doc.blocks).toHaveLength(2)
  })

  it('changes nothing when no page is excluded', () => {
    const plain = assembleBook([page(0, 'One.'), page(1, 'Two.')])
    const empty = assembleBook([page(0, 'One.'), page(1, 'Two.')], { excludePages: [] })
    expect(empty).toEqual(plain)
  })
})

/**
 * A descriptive contents is *recovered*, never composed.
 *
 * The rule this protects is the editor's, and it is narrower than "it would be
 * nice to have descriptions": keep them where the original printed them, and
 * add them nowhere else. A book whose contents was a bare list of chapter names
 * had no such prose, and inventing some would be writing the author's book for
 * them — the one thing a public-domain reprint must not do.
 *
 * Structurally this cannot happen, because `synopsis` only ever takes a value
 * from text read off the contents leaves. Asserted anyway: "it cannot happen"
 * is how it happens, and the failure would be invisible — a plausible paragraph
 * under a chapter heading looks exactly like a recovered one.
 */
describe('assembleBook — descriptions in the contents', () => {
  const chapter = (n: string) =>
    page(1, [{ kind: 'heading', text: n, level: 1 }, para('The body of the chapter.')])

  it('recovers them when the original printed them', () => {
    const doc = assembleBook([
      page(
        0,
        [
          { kind: 'heading', text: 'CONTENTS' },
          { kind: 'heading', text: 'LESSON I' },
          { kind: 'heading', text: 'THE ASTRAL SENSES' },
          para('The skeptical person who believes only the evidence of his senses, and why.'),
          para('Page 13'),
          { kind: 'heading', text: 'LESSON II' },
          { kind: 'heading', text: 'TELEPATHY vs. CLAIRVOYANCE' },
          para('The two extra physical senses of man, and how they may be told apart.'),
          para('Page 28')
        ],
        'table-of-contents'
      ),
      page(
        1,
        [
          { kind: 'heading', text: 'THE ASTRAL SENSES.', level: 1 },
          para('The body of the chapter.')
        ],
        'chapter-opening'
      )
    ])
    const found = doc.chapters.find((c) => c.title === 'THE ASTRAL SENSES.')
    expect(found?.synopsis).toContain('skeptical person')
  })

  it('adds none to a book that had no contents page at all', () => {
    const doc = assembleBook([chapter('Of the Air')])
    expect(doc.chapters.every((c) => c.synopsis === undefined)).toBe(true)
  })

  /**
   * The case that matters most: a contents page *exists* but is a bare list.
   * Nothing is offered, because there was nothing there — and a bare list is
   * still perfectly well served by the regenerated contents.
   */
  it('adds none when the original contents was only names and numbers', () => {
    const doc = assembleBook([
      page(
        0,
        [
          { kind: 'heading', text: 'CONTENTS' },
          { kind: 'heading', text: 'CHAPTER I' },
          { kind: 'heading', text: 'OF THE AIR' },
          para('Page 13'),
          { kind: 'heading', text: 'CHAPTER II' },
          { kind: 'heading', text: 'OF FIRE' },
          para('Page 28')
        ],
        'table-of-contents'
      ),
      page(1, [{ kind: 'heading', text: 'OF THE AIR', level: 1 }, para('Body.')], 'chapter-opening')
    ])
    expect(doc.chapters.every((c) => c.synopsis === undefined)).toBe(true)
  })
})

/**
 * A sentence broken by the page edge, where the two halves were read as
 * different kinds of thing.
 *
 * The pass reads one leaf at a time. A list item broken by the page edge
 * continues on the next leaf with no number in front of it, and a quotation
 * continues with no opening quotation mark — so that leaf begins with what
 * looks exactly like an ordinary paragraph, and the pass is right to call it
 * one. Requiring the kinds to match left the sentence in two pieces, which a
 * reader meets in print as a line that stops in the middle.
 *
 * Found in a real book: eight of them, in lists and in quoted narrative.
 */
describe('assembleBook — a sentence broken across a leaf', () => {
  const half = (kind: TranscribedBlock['kind'], text: string) => ({ kind, text })

  it('joins a list item that runs on as a paragraph', () => {
    const doc = assembleBook([
      page(0, [half('list-item', 'Clairvoyance in Time, in which the seer senses events which')]),
      page(1, [half('paragraph', 'have had their original place in past time.')])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]?.text).toBe(
      'Clairvoyance in Time, in which the seer senses events which have had their ' +
        'original place in past time.'
    )
    // The first half's kind wins: an item that runs on is still an item.
    expect(doc.blocks[0]?.kind).toBe('list-item')
    expect(doc.blocks[0]?.sourcePages).toEqual([0, 1])
  })

  it('joins a quotation that runs on as a paragraph', () => {
    const doc = assembleBook([
      page(0, [half('blockquote', '“I dashed in his face some water which I')]),
      page(1, [half('paragraph', 'fortunately had in my flask.”')])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]?.kind).toBe('blockquote')
  })

  /**
   * The guard on the other side. Two list items on one leaf are two items, and
   * the first ending without a full stop is ordinary — merging them would
   * invent a paragraph the book never had.
   */
  it('does not merge two items that merely sit next to each other on one leaf', () => {
    const doc = assembleBook([
      page(0, [
        half('list-item', 'Locations. Begin by finding particular locations in a room'),
        half('list-item', 'large objects. Then begin to find tables, chairs')
      ])
    ])
    expect(doc.blocks).toHaveLength(2)
  })

  it('never joins a heading to anything', () => {
    const doc = assembleBook([
      page(0, [half('list-item', 'something ending open')]),
      page(1, [half('heading', 'lesson iv')])
    ])
    expect(doc.blocks).toHaveLength(2)
  })
})

/**
 * The other side of that relaxation, and a regression it caused once.
 *
 * A long quotation is printed with a quotation mark opening every paragraph and
 * closing only the last, so the pass marks the whole run as continuing — true
 * of the quotation, false of the sentence. With the kinds no longer required to
 * match, that hint was enough to weld two paragraphs of a quoted narrative into
 * one. A block that opens a quotation is starting something.
 */
describe('assembleBook — a quotation that runs over several paragraphs', () => {
  it('keeps its paragraphs apart even though the pass marks them as continuing', () => {
    const doc = assembleBook([
      page(0, [
        {
          kind: 'blockquote',
          text: '“…through the connecting sequence of ether waves of appropriate order.',
          continuesNext: true
        }
      ]),
      page(1, [
        {
          kind: 'paragraph',
          text: '“Roentgen has familiarized us with an order of vibrations.',
          continuesPrevious: true
        }
      ])
    ])
    expect(doc.blocks).toHaveLength(2)
  })

  /** But an abbreviation at the page edge is still one sentence. */
  it('still joins where the break falls inside a name', () => {
    const doc = assembleBook([
      page(0, [
        {
          kind: 'blockquote',
          text: 'poachers who lived in a lonely wood near St.',
          continuesNext: true
        }
      ]),
      page(1, [{ kind: 'paragraph', text: 'Eglos. They wished him good night.' }])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]?.text).toContain('near St. Eglos')
  })
})
