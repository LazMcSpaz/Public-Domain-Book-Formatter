import { describe, it, expect } from 'vitest'
import {
  assembleBook,
  shouldJoin,
  joinText,
  hyphenatedCompounds,
  bookWordCount,
  seamCount,
  stripSoftHyphens,
  footnoteMarkerPattern,
  stripLeadingMarker
} from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'
import type { BookDocument } from '@core/assemble'
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

/**
 * A hyphen at a page break is usually the compositor's line-wrap and is healed
 * away. Sometimes it is the word's own, and healing it corrupts the book's
 * text in a way no per-page check can see: the two halves sit on different
 * leaves, so each leaf reads correctly against its own render, both OCR engines
 * agree, and nothing downstream ever compares the join to how the book spells
 * that word everywhere else.
 *
 * *Thought Vibration* set `thought-` at the foot of page 22 and `habit` at the
 * head of page 23, and the book prints `thought-habit` with the hyphen four
 * times elsewhere. It assembled as `thoughthabit`, and it took a fourth
 * independent witness to notice.
 *
 * The book's own usage is the witness that settles it, and assembly has the
 * whole book in hand — which is exactly what a per-page reader does not.
 */
describe('a page-break hyphen the book itself keeps', () => {
  it('collects the compounds the book sets with a hyphen mid-line', () => {
    const set = hyphenatedCompounds([
      'The force of the thought-habit, or motion-habit, carries it on.',
      'a magnet-like power of attraction',
      'nothing hyphenated here at all'
    ])
    expect(set.has('thought-habit')).toBe(true)
    expect(set.has('motion-habit')).toBe(true)
    expect(set.has('magnet-like')).toBe(true)
    expect(set.size).toBe(3)
  })

  it('keeps the hyphen the book keeps, and heals the one it does not', () => {
    const known = hyphenatedCompounds(['it imparts the thought-habit to the mind'])
    expect(joinText('produces the thought-', 'habit, or motion-habit,', known)).toBe(
      'produces the thought-habit, or motion-habit,'
    )
    // The ordinary case is untouched: `chirurgeon` is one word wherever the
    // book sets it, so nothing vouches for the hyphen and it goes.
    expect(joinText('the chirur-', 'geon his art', known)).toBe('the chirurgeon his art')
  })

  it('matches without regard to case or the punctuation that follows', () => {
    const known = hyphenatedCompounds(['the sound-waves reach us'])
    expect(joinText('of Sound-', 'Waves.', known)).toBe('of Sound-Waves.')
  })

  it('heals everything when nothing is known, which is what it did before', () => {
    expect(joinText('produces the thought-', 'habit, or motion-habit,')).toBe(
      'produces the thoughthabit, or motion-habit,'
    )
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

  /**
   * "LESSON I." over "THE ASTRAL SENSES." is one chapter opening printed on two
   * lines, and the reading brings it back as two heading blocks because on the
   * page that is what it is. Counting it as two chapters listed every chapter
   * twice in the contents, put the lesson number in the running head for a
   * leaf, and — with chapters opening recto — cost two extra leaves per lesson,
   * the first carrying a number and nothing else.
   */
  it('takes a run of consecutive headings as one chapter', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'heading', text: 'LESSON I.' },
        { kind: 'heading', text: 'THE ASTRAL SENSES.' },
        para('The student of occultism.')
      ]),
      page(1, [
        { kind: 'heading', text: 'LESSON II.' },
        { kind: 'heading', text: 'TELEPATHY EXPLAINED.' },
        para('Telepathy is the sending of thought.')
      ])
    ])
    expect(doc.chapters).toHaveLength(2)
    // Named by the last of the run, because the title is what the running head
    // shows and what a recovered synopsis is matched on.
    expect(doc.chapters.map((c) => c.title)).toEqual(['THE ASTRAL SENSES.', 'TELEPATHY EXPLAINED.'])
    expect(doc.chapters.map((c) => c.label)).toEqual(['LESSON I.', 'LESSON II.'])
    // Identified by the first, because that is where the opening starts.
    expect(doc.chapters[0]!.id).toBe(doc.blocks[0]!.id)
    expect(doc.chapters[0]!.blockIndex).toBe(0)
    // Every heading block survives: nothing about this drops text.
    expect(doc.blocks.filter((b) => b.kind === 'heading')).toHaveLength(4)
  })

  it('leaves a lone heading without a label', () => {
    const doc = assembleBook([
      page(0, [{ kind: 'heading', text: 'INTRODUCTION.' }, para('In preparing this series.')])
    ])
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]!.label).toBeUndefined()
    expect(doc.chapters[0]!.title).toBe('INTRODUCTION.')
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

/**
 * The footnote rule applied to the other restoration that can fail.
 *
 * *The Human Aura*'s contents calls chapter V "The Aura Kaleidoscope" while the
 * chapter itself is headed "THE AURIC KALEIDOSCOPE"; three of its ten
 * descriptions fell on the floor for differences of that kind. Nothing looked
 * broken — the contents still prints, only plainer — which is what makes
 * silence here the worst outcome available.
 */
describe('assembleBook — a description that matched no chapter', () => {
  const contents = (...entries: string[]) =>
    page(
      0,
      [
        { kind: 'heading' as const, text: 'CONTENTS' },
        ...entries.flatMap((title, i) => [
          { kind: 'heading' as const, text: `CHAPTER ${i + 1}` },
          { kind: 'heading' as const, text: title },
          para(`What is in the chapter called ${title}, at some useful length.`),
          para(`Page ${13 + i * 15}`)
        ])
      ],
      'table-of-contents'
    )

  it('reports it rather than dropping it', () => {
    const doc = assembleBook([
      contents('THE AURA KALEIDOSCOPE', 'THOUGHT FORMS'),
      page(
        1,
        [{ kind: 'heading', text: 'THE AURIC KALEIDOSCOPE.', level: 1 }, para('Body.')],
        'chapter-opening'
      ),
      page(2, [{ kind: 'heading', text: 'THOUGHT FORMS.', level: 1 }, para('Body.')])
    ])
    expect(doc.synopsesUnmatched.map((s) => s.title)).toEqual(['THE AURA KALEIDOSCOPE'])
    expect(doc.synopsesUnmatched[0]!.synopsis).toContain('AURA KALEIDOSCOPE')
    // And the one that did match is still attached.
    expect(doc.chapters.find((c) => c.title === 'THOUGHT FORMS.')?.synopsis).toBeTruthy()
  })

  it('reports nothing when every description found its chapter', () => {
    const doc = assembleBook([
      contents('OF THE AIR', 'OF THE WATER'),
      page(
        1,
        [{ kind: 'heading', text: 'OF THE AIR', level: 1 }, para('Body.')],
        'chapter-opening'
      ),
      page(2, [{ kind: 'heading', text: 'OF THE WATER', level: 1 }, para('Body.')])
    ])
    expect(doc.synopsesUnmatched).toEqual([])
  })

  it('reports nothing when the parse was refused as unsound', () => {
    // One entry, so `synopsisLooksSound` declines it. Nothing was matched and
    // nothing is claimed to have been lost — the contents was never read.
    const doc = assembleBook([
      contents('OF THE AIR'),
      page(1, [{ kind: 'heading', text: 'SOMETHING ELSE', level: 1 }, para('Body.')])
    ])
    expect(doc.synopsesUnmatched).toEqual([])
  })
})

/**
 * The chapter number, as a second way in.
 *
 * A book can call a chapter two things: *The Human Aura* lists "The Aura
 * Kaleidoscope" in its contents and heads the chapter "THE AURIC
 * KALEIDOSCOPE". Three of its ten descriptions fell on the floor for
 * differences of that kind, and the number is the one name both pages agree on.
 */
describe('assembleBook — matching a description by chapter number', () => {
  const contents = page(
    0,
    [
      { kind: 'heading' as const, text: 'CONTENTS' },
      { kind: 'heading' as const, text: 'Chapter V. The Aura Kaleidoscope............ 39' },
      para('What the astral body is composed of. Also the etheric double, at length.'),
      { kind: 'heading' as const, text: 'Chapter VI. Thought Form............ 47' },
      para('What a Thought Form is and what it is made of, described at some length.')
    ],
    'table-of-contents'
  )

  it('finds the chapter the contents named differently', () => {
    const doc = assembleBook([
      contents,
      page(
        1,
        [
          { kind: 'heading', text: 'CHAPTER V.', level: 1 },
          { kind: 'heading', text: 'THE AURIC KALEIDOSCOPE.', level: 1 },
          para('Body.')
        ],
        'chapter-opening'
      ),
      page(2, [
        { kind: 'heading', text: 'CHAPTER VI.', level: 1 },
        { kind: 'heading', text: 'THOUGHT FORMS.', level: 1 },
        para('Body.')
      ])
    ])
    expect(doc.chapters.find((c) => c.title === 'THE AURIC KALEIDOSCOPE.')?.synopsis).toContain(
      'astral body is composed of'
    )
    expect(doc.chapters.find((c) => c.title === 'THOUGHT FORMS.')?.synopsis).toContain(
      'Thought Form is'
    )
    expect(doc.synopsesUnmatched).toEqual([])
  })

  /**
   * Where the two names differ, the contents keeps its own.
   *
   * The regenerated contents takes its titles from the chapter heads, so a book
   * that calls a chapter one thing in its contents and another at its head had
   * the contents name silently replaced by the head's. *Thought Vibration*
   * lists "Thought-Waves and Their Power of Reproduction" and heads the chapter
   * "Process of Reproduction", both set clearly, and the editor's ruling was to
   * keep both where the book puts them.
   *
   * `contentsTitle` is set only when the two actually differ, so a book whose
   * pages agree carries nothing extra and nothing changes shape.
   */
  it('remembers what the contents called a chapter, when that differs', () => {
    const doc = assembleBook([
      contents,
      page(
        1,
        [
          { kind: 'heading', text: 'CHAPTER V.', level: 1 },
          { kind: 'heading', text: 'THE AURIC KALEIDOSCOPE.', level: 1 },
          para('Body.')
        ],
        'chapter-opening'
      ),
      page(2, [
        { kind: 'heading', text: 'CHAPTER VI.', level: 1 },
        { kind: 'heading', text: 'THOUGHT FORMS.', level: 1 },
        para('Body.')
      ])
    ])
    const differs = doc.chapters.find((c) => c.title === 'THE AURIC KALEIDOSCOPE.')!
    expect(differs.contentsTitle).toBe('The Aura Kaleidoscope')

    // A plural against a singular is a real difference and is recorded too:
    // *Thought Vibration* had one of exactly this kind.
    expect(doc.chapters.find((c) => c.title === 'THOUGHT FORMS.')!.contentsTitle).toBe(
      'Thought Form'
    )
  })

  /**
   * Nothing extra where the pages agree. Case and pointing are not a difference
   * in what a chapter is called, which is what `synopsisKey` is for, so a
   * contents that sets the same name differently records nothing.
   */
  it('records nothing when the two names are the same name', () => {
    const doc = assembleBook([
      page(
        0,
        [
          { kind: 'heading' as const, text: 'CONTENTS' },
          { kind: 'heading' as const, text: 'Chapter V. The Auric Kaleidoscope............ 39' },
          para('What the astral body is composed of. Also the etheric double, at length.'),
          { kind: 'heading' as const, text: 'Chapter VI. Thought Forms............ 47' },
          para('What a Thought Form is and what it is made of, described at some length.')
        ],
        'table-of-contents'
      ),
      page(
        1,
        [
          { kind: 'heading', text: 'CHAPTER V.', level: 1 },
          { kind: 'heading', text: 'THE AURIC KALEIDOSCOPE.', level: 1 },
          para('Body.')
        ],
        'chapter-opening'
      ),
      page(2, [
        { kind: 'heading', text: 'CHAPTER VI.', level: 1 },
        { kind: 'heading', text: 'THOUGHT FORMS.', level: 1 },
        para('Body.')
      ])
    ])
    expect(doc.chapters.every((c) => c.contentsTitle === undefined)).toBe(true)
    expect(doc.chapters.filter((c) => c.synopsis).length).toBe(2)
  })

  /** Exact, not fuzzy: a number matches its own number and no other. */
  it('does not hand chapter VI’s description to chapter IV', () => {
    const doc = assembleBook([
      contents,
      page(1, [
        { kind: 'heading', text: 'CHAPTER IV.', level: 1 },
        { kind: 'heading', text: 'SOMETHING ELSE.', level: 1 },
        para('Body.')
      ])
    ])
    expect(doc.chapters.find((c) => c.title === 'SOMETHING ELSE.')?.synopsis).toBeUndefined()
  })

  /** One description reaches one chapter, however many ways it could match. */
  it('never gives the same description to two chapters', () => {
    const doc = assembleBook([
      contents,
      page(1, [
        { kind: 'heading', text: 'CHAPTER V.', level: 1 },
        { kind: 'heading', text: 'THE AURA KALEIDOSCOPE', level: 1 },
        para('Body.')
      ]),
      page(2, [
        { kind: 'heading', text: 'CHAPTER V.', level: 1 },
        { kind: 'heading', text: 'A SECOND ONE.', level: 1 },
        para('Body.')
      ])
    ])
    const withOne = doc.chapters.filter((c) => c.synopsis)
    expect(withOne).toHaveLength(1)
    expect(withOne[0]!.title).toBe('THE AURA KALEIDOSCOPE')
  })
})

/**
 * What holds a heading run together is the number line.
 *
 * `CHAPTER XI.` is incomplete on its own and absorbs the title after it.
 * `BOOK TWO — THE ASTRAL WORLD` is complete and absorbs nothing, which is what
 * lets two manuals bound into one volume show as two groups in the contents.
 *
 * Levels are deliberately not the test: `LESSON III.` over
 * `TELEPATHY EXPLAINED.` is tagged 1 over 2 in a book already published from
 * here, and reading a deeper level as subordination split eleven lesson numbers
 * away from their own titles.
 */
describe('deriveChapters — divisions above chapters', () => {
  const heading = (text: string, level?: number): TranscribedBlock => ({
    kind: 'heading',
    text,
    ...(level === undefined ? {} : { level })
  })
  const leaf = (blocks: TranscribedBlock[]): PageTranscription => ({
    pageIndex: 0,
    role: 'chapter-opening',
    blocks,
    uncertain: [],
    furniture: {}
  })

  it('joins a number line to the title after it', () => {
    const doc = assembleBook([
      leaf([
        heading('CHAPTER XI.'),
        heading('ASTRAL ENTITIES.'),
        { kind: 'paragraph', text: 'WITHOUT intending to go deeply.' }
      ])
    ])
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]!.title).toBe('ASTRAL ENTITIES.')
    expect(doc.chapters[0]!.label).toBe('CHAPTER XI.')
  })

  it('joins one tagged a level deeper than its number, as a published book has it', () => {
    const doc = assembleBook([
      leaf([
        heading('LESSON III.', 1),
        heading('TELEPATHY EXPLAINED.', 2),
        { kind: 'paragraph', text: 'The student will now.' }
      ])
    ])
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0]!.title).toBe('TELEPATHY EXPLAINED.')
  })

  it('leaves a complete division standing above the chapter after it', () => {
    const doc = assembleBook([
      leaf([
        heading('BOOK TWO — THE ASTRAL WORLD', 1),
        heading('CHAPTER I.', 2),
        heading('THE SEVEN PLANES.', 2),
        { kind: 'paragraph', text: 'EVERY student of occultism.' }
      ])
    ])
    expect(doc.chapters.map((c) => c.title)).toEqual([
      'BOOK TWO — THE ASTRAL WORLD',
      'THE SEVEN PLANES.'
    ])
    expect(doc.chapters[0]!.level).toBe(1)
    expect(doc.chapters[1]!.level).toBe(2)
    expect(doc.chapters[1]!.label).toBe('CHAPTER I.')
  })

  it('does not run two complete titles together', () => {
    const doc = assembleBook([
      leaf([
        heading('THE END.'),
        heading('THE SEVEN PLANES.'),
        { kind: 'paragraph', text: 'EVERY student.' }
      ])
    ])
    expect(doc.chapters.map((c) => c.title)).toEqual(['THE END.', 'THE SEVEN PLANES.'])
  })
})

/**
 * Two works bound into one volume, each with its own contents page.
 *
 * Both faults here appeared the first time two manuals were bound together, and
 * neither is visible in a book with one contents page.
 */
describe('a volume that binds two works', () => {
  const entry = (label: string, title: string, folio: number): TranscribedBlock[] => [
    { kind: 'heading', text: `${label} ${title}.......... ${folio}` },
    {
      kind: 'paragraph',
      text: `A description of ${title} long enough to count as a real one, of the kind these pages carry.`
    }
  ]
  const contents = (n: number, ...blocks: TranscribedBlock[][]): PageTranscription => ({
    pageIndex: n,
    role: 'table-of-contents',
    blocks: [{ kind: 'heading', text: 'CONTENTS' }, ...blocks.flat()],
    uncertain: [],
    furniture: {}
  })
  const opening = (n: number, label: string, title: string): PageTranscription => ({
    pageIndex: n,
    role: 'chapter-opening',
    blocks: [
      { kind: 'heading', text: label },
      { kind: 'heading', text: title },
      { kind: 'paragraph', text: 'The chapter begins here and runs on for a while.' }
    ],
    uncertain: [],
    furniture: {}
  })

  const volume = (): BookDocument =>
    assembleBook([
      contents(0, entry('Chapter I.', 'Of the Aura', 5), entry('Chapter II.', 'Of Colour', 15)),
      opening(1, 'CHAPTER I.', 'OF THE AURA'),
      opening(2, 'CHAPTER II.', 'OF COLOUR'),
      // The second work's contents. Its folios start again at 5.
      contents(3, entry('Chapter I.', 'Of the Planes', 5), entry('Chapter II.', 'Of Regions', 12)),
      opening(4, 'CHAPTER I.', 'OF THE PLANES'),
      opening(5, 'CHAPTER II.', 'OF REGIONS')
    ])

  it('keeps both contents, whose folios ascend twice', () => {
    // Read as one sequence the folios go 5, 15, 5, 12 and the parse was refused
    // whole, so both works lost the analytical contents that is the only reason
    // to read such a page at all.
    const doc = volume()
    expect(doc.chapters.filter((c) => c.synopsis)).toHaveLength(4)
    expect(doc.synopsesUnmatched).toEqual([])
  })

  it('gives each work its own Chapter I rather than the last one read', () => {
    const doc = volume()
    const byTitle = new Map<string, string>(doc.chapters.map((c) => [c.title, c.synopsis ?? '']))
    expect(byTitle.get('OF THE AURA')).toContain('Of the Aura')
    expect(byTitle.get('OF THE PLANES')).toContain('Of the Planes')
  })

  it('still refuses a single ragged contents', () => {
    // The guard that matters is unchanged: within one work the folios must
    // ascend, because out of order means the page was stitched together wrongly.
    const doc = assembleBook([
      contents(
        0,
        entry('Chapter I.', 'Of the Aura', 5),
        entry('Chapter II.', 'Of Colour', 40),
        entry('Chapter III.', 'Of Light', 2),
        entry('Chapter IV.', 'Of Shade', 60)
      ),
      opening(1, 'CHAPTER I.', 'OF THE AURA')
    ])
    expect(doc.chapters.filter((c) => c.synopsis)).toHaveLength(0)
  })
})
