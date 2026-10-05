import { describe, it, expect } from 'vitest'
import { abbreviatedRange, readSynopsis, synopsisKey, synopsisLooksSound } from '@core/pages'

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

/**
 * The run-in shape: *The Mahatma Letters* (1923), whose contents sets each
 * letter as one paragraph — the label run into it and ended by an em dash, the
 * topics joined by dashes, and a page of the 1923 printing after every group
 * of them. Every string below is the shelf's own transcription of leaves 18
 * to 38, cut down where the middle of an entry says nothing new.
 */
describe('a contents that runs each entry into a paragraph', () => {
  const leaf = (page: number, blocks: { kind: string; text: string }[]) =>
    blocks.map((b, i) => ({ ...b, id: `p${page}b${i}`, page }))

  const contents = [
    ...leaf(18, [
      h('CONTENTS'),
      p('Page'),
      p('Compiler’s Preface - - - - - - - - - - - 6'),
      p('Introduction - - - - - - - - - - - - 8'),
      h('SECTION I'),
      h('THE OCCULT WORLD SERIES'),
      p(
        'Letter No. I.—London newspaper Test; 1. Solomons of Science—experimental ' +
          'knowledge—vril of the coming age—skeletons of giants; 2. Hooke—Newton; 3.'
      ),
      p('Letter No. III.—“ Brooch ” phenomenon—postal address in N.W.P.—Pillow incidents; 10.')
    ]),
    ...leaf(20, [p('Letter No. XVI,—The Devachan Letter—Devachan allegorically described')]),
    // The leaf turns in the middle of letter XVI.
    ...leaf(21, [
      p('by Buddha—who goes to Devachan; 100. The Ego enjoys perfect bliss; 101.'),
      p('Letter No. XIX.—Post mortem conditions of suicides and victims of accidents; 123.'),
      p(
        '<sc>Letter No.</sc> XX<sc>a</sc>.—From A. O. Hume to K.H. Queries re ' +
          'spiritualistic phenomena—shells—suicides and accidents; 123. Death by drink; 124.'
      )
    ]),
    ...leaf(29, [
      p('Letter No. LV.—The ordeal of the aspirant; 322. Christian-mission-Coulomb conspiracy—')
    ]),
    // And letter LV turns the leaf on a dash.
    ...leaf(30, [
      p('correspondence with the “ Inner Circle ”—pledge themselves to K.H.; 324.'),
      p('Letter No. LVI.—Condition of A. O. Hume—a fakir; 325. “ Mr. Isaacs ”; 327.'),
      p(
        'Letter No. LVII.—Adepts and their methods not understood; 328; C.C.M. on the ' +
          'list of failures—not a medium—the best of men but lacking in intuition; 4. ' +
          'Europeans on probation—3 fail—probation of societies; 329. Hume and Fern; 330.'
      ),
      p('Letter No. LIX.—Pythagoras and the number 2—the dual monad in manifestation—the per-')
    ]),
    ...leaf(31, [
      p('fect square—the WORD—The Great Deep; 347. Nothing was ever lost by trying; 348.'),
      p('Letter No. LXX.—The probation of A.P.S.'),
      h('SECTION IV'),
      h('THE PHŒNIX VENTURE AND THE CONDITION OF INDIA'),
      p('Letter No. LXXVII.—Colonel Gordon—a Howrah Branch—Eclectic; 377. Women as angels.')
    ]),
    ...leaf(38, [
      p('Letter No. CXLIIb.—Comment by K.H. on Damodar’s memorandum; 488.'),
      p(
        'MARS AND MERCURY. Sinnett reopens the controversy—quotations “ from the Secret ' +
          'Doctrine ”—the whole theory prove false; 489-92.'
      )
    ])
  ]
  const entries = readSynopsis(contents)
  const named = (label: string) => entries.find((e) => e.label === label)!

  it('opens an entry at each label, which ends at the dash', () => {
    expect(entries.map((e) => e.label || e.title)).toEqual([
      'SECTION I',
      'Letter No. I',
      'Letter No. III',
      'Letter No. XVI',
      'Letter No. XIX',
      'Letter No. XXa',
      'Letter No. LV',
      'Letter No. LVI',
      'Letter No. LVII',
      'Letter No. LIX',
      'Letter No. LXX',
      'SECTION IV',
      'Letter No. LXXVII',
      'Letter No. CXLIIb',
      'MARS AND MERCURY'
    ])
    expect(named('Letter No. I')).toMatchObject({ title: '', id: 'p18b6', pages: [18] })
    expect(named('Letter No. I').synopsis).toMatch(/^London newspaper Test; 1\. Solomons/)
  })

  it('reads a comma before the dash as the point it stands for', () => {
    expect(named('Letter No. XVI').synopsis).toMatch(/^The Devachan Letter—/)
  })

  it('reads the label through the small capitals it is set in', () => {
    expect(named('Letter No. XXa').synopsis).toMatch(/^From A\. O\. Hume to K\.H\. Queries/)
    expect(named('Letter No. XXa').synopsis).not.toContain('<sc>')
  })

  /**
   * Letter XVI runs from the foot of leaf 20 to the head of 21, as a
   * paragraph that opens in lower case; letter LIX breaks a word there.
   */
  it('carries an entry over the leaf it ran onto', () => {
    expect(named('Letter No. XVI').synopsis).toBe(
      'The Devachan Letter—Devachan allegorically described by Buddha—who goes to ' +
        'Devachan; 100. The Ego enjoys perfect bliss; 101.'
    )
    expect(named('Letter No. XVI').pages).toEqual([20, 21])
    expect(named('Letter No. LIX').synopsis).toContain('the perfect square—the WORD')
    expect(named('Letter No. LV').synopsis).toContain('conspiracy—correspondence with the')
  })

  it('takes a title in capitals and a point for an entry named rather than numbered', () => {
    const mars = entries.find((e) => e.title === 'MARS AND MERCURY')!
    expect(mars.label).toBe('')
    expect(mars.synopsis).toMatch(/^Sinnett reopens the controversy/)
    expect(mars.references).toEqual([expect.objectContaining({ from: 489, to: 492 })])
  })

  it('keeps a heading over the letters as an entry, closed by the first letter', () => {
    expect(entries[0]).toMatchObject({ label: 'SECTION I', title: 'THE OCCULT WORLD SERIES' })
    expect(entries[0]!.synopsis).toBe('')
    expect(entries[0]!.references).toBeUndefined()
  })

  /**
   * `Compiler’s Preface - - - 6` and `Introduction - - - 8` stand above the
   * first section. They describe nothing and the body lists both itself, so
   * they are not entries — they are read past like anything else before the
   * first one (and the contents prints each once: see the layout tests).
   */
  it('takes nothing from the lines above the first entry', () => {
    expect(entries.some((e) => /Preface|Introduction/u.test(e.title + e.synopsis))).toBe(false)
  })

  it('keeps every reference as structure, in its place in the text', () => {
    const one = named('Letter No. I')
    expect(one.references!.map((r) => [r.from, r.to])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ])
    const [first] = one.references!
    expect(one.synopsis.slice(first!.start, first!.end)).toBe('1')
    expect(one.originalFolio).toBe(1)
  })

  it('expands a range as the book abbreviates it', () => {
    const mars = entries.find((e) => e.title === 'MARS AND MERCURY')!
    const [range] = mars.references!
    expect(mars.synopsis.slice(range!.start, range!.end)).toBe('489-92')
  })

  /**
   * Leaf 30, exactly: `lacking in intuition; 4. Europeans on probation`. The
   * `4.` is a count — "Four Europeans were placed on probation", on the 1923
   * page 328 — and it has every mark of a reference but one. The references
   * around it run 328, 329, 330; a page 4 between them would send the reader
   * from the middle of letter LVII to the first leaf of the book.
   */
  it('does not read a count that opens a group as a page', () => {
    const lvii = named('Letter No. LVII')
    expect(lvii.references!.map((r) => r.from)).toEqual([328, 329, 330])
    expect(lvii.synopsis).toContain('lacking in intuition; 4. Europeans on probation')
    expect(lvii.originalFolio).toBe(328)
  })

  /**
   * Why the sequence is the whole contents and not one entry: put the same
   * count at the head of a letter and, read alone, nothing comes before it to
   * contradict it. The letter before ended at 327, and that is what does.
   */
  it('reads the sequence across entries, not within one', () => {
    const [, lvii] = readSynopsis([
      p('Letter No. LVI.—Condition of A. O. Hume; 325. “ Mr. Isaacs ”; 327.'),
      p('Letter No. LVII.—Lacking in intuition; 4. Europeans on probation; 329. Hume; 330.')
    ])
    expect(lvii!.references!.map((r) => r.from)).toEqual([329, 330])
  })

  it('closes a group on a semicolon as the book sometimes does', () => {
    // `; 328; C.C.M. on the list` — the stop set as a semicolon.
    expect(named('Letter No. LVII').references![0]).toMatchObject({ from: 328, to: 328 })
  })

  it('leaves a letter with no reference without one', () => {
    expect(named('Letter No. LXX')).toMatchObject({
      synopsis: 'The probation of A.P.S.',
      references: [],
      originalFolio: null
    })
  })

  it('is sound, two letters on one page and all', () => {
    // XIX and XXa both begin on the 1923 page 123, and the contents says so.
    expect(named('Letter No. XIX').originalFolio).toBe(123)
    expect(named('Letter No. XXa').originalFolio).toBe(123)
    expect(synopsisLooksSound(entries)).toBe(true)
  })

  it('still refuses two chapters of the older shape claiming one page', () => {
    const two = [
      { label: 'LESSON I', title: 'A', synopsis: 'x'.repeat(50), originalFolio: 5 },
      { label: 'LESSON II', title: 'B', synopsis: 'y'.repeat(50), originalFolio: 5 }
    ]
    expect(synopsisLooksSound(two)).toBe(false)
  })
})

describe('the name a heading with a reference mark goes by', () => {
  it('is the name without the mark', () => {
    expect(synopsisKey('LETTER No. X¹')).toBe(synopsisKey('Letter No. X'))
    expect(synopsisKey('LETTER No. CXXVII¹²')).toBe(synopsisKey('Letter No. CXXVII.'))
  })
})

describe('a range of this edition’s pages, in the book’s own form', () => {
  it('writes the shared leading digits once', () => {
    expect(abbreviatedRange('52', '53')).toBe('52-3')
    expect(abbreviatedRange('178', '179')).toBe('178-9')
    expect(abbreviatedRange('489', '492')).toBe('489-92')
    expect(abbreviatedRange('79', '81')).toBe('79-81')
  })

  it('writes ends of different lengths whole, and one page once', () => {
    expect(abbreviatedRange('99', '100')).toBe('99-100')
    expect(abbreviatedRange('61', '61')).toBe('61')
  })
})
