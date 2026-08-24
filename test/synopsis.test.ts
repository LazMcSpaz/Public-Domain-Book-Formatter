import { describe, it, expect } from 'vitest'
import { readSynopsis, synopsisKey, synopsisLooksSound } from '@core/pages'

/**
 * The original contents page, read for its prose.
 *
 * Front matter is replaced rather than transcribed, and the scanned contents is
 * the clearest case of it — but the *reason* is narrow: its page numbers
 * describe a pagination this edition does not have. An analytical contents also
 * carries a paragraph under each chapter saying what is in it, which is
 * editorial work and is the whole reason such a page is read rather than
 * scanned. Throwing that away with the numbers was throwing away the wrong half.
 *
 * The shape here is taken from a real book — Panchadasi's *Clairvoyance and
 * Occult Powers* (1916), whose contents page calls itself "SYNOPSIS OF THE
 * LESSONS" — including the two things that make it awkward: an entry whose
 * description runs across a leaf boundary, and a page number transcribed as a
 * caption on some leaves and a paragraph on others.
 */
const p = (text: string) => ({ kind: 'paragraph', text })
const h = (text: string) => ({ kind: 'heading', text })
const c = (text: string) => ({ kind: 'caption', text })

describe('reading the original contents', () => {
  it('takes the label, the title, the description and the stale folio', () => {
    const entries = readSynopsis([
      h('SYNOPSIS OF THE LESSONS'),
      h('LESSON I'),
      h('THE ASTRAL SENSES'),
      p('The skeptical person who "believes only the evidence of his senses."'),
      p('Page 13')
    ])
    expect(entries).toEqual([
      {
        label: 'LESSON I',
        title: 'THE ASTRAL SENSES',
        synopsis: 'The skeptical person who "believes only the evidence of his senses."',
        originalFolio: 13
      }
    ])
  })

  it('does not mistake the contents’ own title for an entry', () => {
    const entries = readSynopsis([h('CONTENTS'), h('CHAPTER I'), h('THE BEGINNING'), p('Page 1')])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.title).toBe('THE BEGINNING')
  })

  /**
   * The case a per-leaf parser gets wrong and never notices: an entry opened on
   * one leaf and finished on the next. Handed the leaves singly it would
   * truncate one description per leaf boundary and report success.
   */
  it('joins a description that ran onto the next leaf', () => {
    const entries = readSynopsis([
      h('LESSON XI'),
      h('CLAIRVOYANCE OF THE PAST'),
      p('The clairvoyant perception of past time. The Akashic Records may be read'),
      // leaf boundary falls here
      p('like a book. Analogies in physical science.'),
      c('Page 167')
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.synopsis).toBe(
      'The clairvoyant perception of past time. The Akashic Records may be read ' +
        'like a book. Analogies in physical science.'
    )
    expect(entries[0]?.originalFolio).toBe(167)
  })

  /**
   * Read on what the line says, never on what the block was called: the same
   * page furniture came back as a paragraph on three leaves and a caption on
   * three others, from one pass over one book.
   */
  it('takes the folio however the page was read', () => {
    const asParagraph = readSynopsis([h('LESSON I'), h('A'), p('desc'), p('Page 13')])
    const asCaption = readSynopsis([h('LESSON I'), h('A'), p('desc'), c('Page 13')])
    expect(asParagraph).toEqual(asCaption)
  })

  it('closes an entry whose folio never arrived, rather than running two together', () => {
    const entries = readSynopsis([
      h('LESSON X'),
      h('FIRST'),
      p('about the first'),
      // no folio here — it was lost in transcription
      h('LESSON XI'),
      h('SECOND'),
      p('about the second'),
      p('Page 182')
    ])
    expect(entries.map((e) => e.title)).toEqual(['FIRST', 'SECOND'])
    expect(entries[0]?.synopsis).toBe('about the first')
    expect(entries[0]?.originalFolio).toBeNull()
    expect(entries[1]?.synopsis).toBe('about the second')
  })

  it('reads roman folios', () => {
    const entries = readSynopsis([h('CHAPTER I'), h('A'), p('desc'), p('Page xiv')])
    expect(entries[0]?.originalFolio).toBe(14)
  })

  it('invents nothing from a page with no entries on it', () => {
    expect(readSynopsis([p('a stray running head'), p('Page 4')])).toEqual([])
    expect(readSynopsis([])).toEqual([])
  })
})

describe('whether a parse is worth offering', () => {
  const good = Array.from({ length: 6 }, (_, i) => ({
    label: `LESSON ${i}`,
    title: `TITLE ${i}`,
    synopsis: 'A description long enough to be a real one, of the kind these pages carry.',
    originalFolio: (i + 1) * 15
  }))

  it('accepts a regular contents', () => {
    expect(synopsisLooksSound(good)).toBe(true)
  })

  it('refuses one whose folios do not ascend', () => {
    // Out of order means the reader has stitched the page together wrongly —
    // and a mangled contents printed under the author's name is worse than the
    // plain one this replaces.
    const jumbled = good.map((e, i) => ({ ...e, originalFolio: i === 3 ? 2 : e.originalFolio }))
    expect(synopsisLooksSound(jumbled)).toBe(false)
  })

  it('refuses one where the descriptions are mostly missing', () => {
    const bare = good.map((e, i) => (i > 1 ? { ...e, synopsis: '' } : e))
    expect(synopsisLooksSound(bare)).toBe(false)
  })

  it('refuses a contents of one entry, which is not evidence of anything', () => {
    expect(synopsisLooksSound(good.slice(0, 1))).toBe(false)
  })
})

describe('matching a description to the chapter the body prints', () => {
  /**
   * The real difference between the two, in this book: a hyphen the contents
   * sets and the chapter opening does not, and a full stop after the title.
   * Neither is a difference in what the chapter is called.
   */
  it('ignores hyphenation, punctuation and case', () => {
    expect(synopsisKey('MIND-READING, AND BEYOND')).toBe(synopsisKey('MIND READING, AND BEYOND.'))
    expect(synopsisKey('CLAIRVOYANT CRYSTAL-GAZING')).toBe(
      synopsisKey('Clairvoyant Crystal Gazing.')
    )
    expect(synopsisKey('LESSON I')).toBe(synopsisKey('Lesson I.'))
  })

  it('still tells two different chapters apart', () => {
    expect(synopsisKey('SIMPLE CLAIRVOYANCE')).not.toBe(synopsisKey('CLAIRVOYANCE OF THE PAST'))
  })
})

/**
 * The other shape a contents page comes in, and the one this shelf's books
 * actually use: the folio at the end of the entry's line after a row of leader
 * dots, and the chapter number in front of the title rather than above it.
 *
 * The numbers are *The Human Aura*'s own contents leaves.
 */
describe('a contents set with leader dots', () => {
  const leaves = [
    { kind: 'heading', text: 'CONTENTS' },
    { kind: 'heading', text: 'Chapter I. What Is the Human Aura............. 5' },
    {
      kind: 'paragraph',
      text:
        'The subtle, invisible emanation radiating from every individual. An ethereal ' +
        'radiation. The egg-shaped human nebula. Psychic atmosphere sensed by everyone.'
    },
    { kind: 'heading', text: 'Chapter II. The Prana Aura.................. 15' },
    {
      kind: 'paragraph',
      text:
        'Prana, the Vital Force, Life Essence. How it affects the human aura. Health Aura. ' +
        'Physical Aura. Health Magnetism. Peculiar appearance of Prana Aura.'
    },
    { kind: 'heading', text: 'Chapter III. The Astral Colors.............. 23' },
    {
      kind: 'paragraph',
      text:
        'Each mental or emotional state has its own astral hue, tint, shade or color. The ' +
        'Primary Colors, Red, Blue and Yellow. The Secondary Colors, Green, Orange and Purple.'
    }
  ]
  const entries = readSynopsis(leaves)

  it('reads the folio off the end of the line', () => {
    expect(entries.map((e) => e.originalFolio)).toEqual([5, 15, 23])
  })

  it('keeps the number as the label and the title without it', () => {
    expect(entries[2]).toMatchObject({ label: 'Chapter III.', title: 'The Astral Colors' })
  })

  it('matches the body, which names its chapters without the number', () => {
    expect(synopsisKey(entries[2]!.title)).toBe(synopsisKey('THE ASTRAL COLORS.'))
  })

  it('is sound, which the same page was not before the dots were read', () => {
    expect(synopsisLooksSound(entries)).toBe(true)
  })

  /**
   * The dots are required. Without them this would take the `4` off
   * `Chapter IV` and the year off any title that ends in one.
   */
  it('does not mistake a roman numeral for a folio', () => {
    const [entry] = readSynopsis([
      { kind: 'heading', text: 'Chapter IV. The Astral Colors (Continued)' },
      { kind: 'paragraph', text: 'Interpretations of the Astral Color Group.' }
    ])
    expect(entry!.originalFolio).toBeNull()
    expect(entry!.title).toBe('The Astral Colors (Continued)')
  })

  it('still reads a contents that sets its folio on a line of its own', () => {
    const [entry] = readSynopsis([
      { kind: 'heading', text: 'LESSON I' },
      { kind: 'heading', text: 'THE ASTRAL SENSES' },
      { kind: 'paragraph', text: 'What the astral senses are and how they are unfolded.' },
      { kind: 'caption', text: 'Page 9' }
    ])
    expect(entry).toMatchObject({ label: 'LESSON I', title: 'THE ASTRAL SENSES', originalFolio: 9 })
  })
})
