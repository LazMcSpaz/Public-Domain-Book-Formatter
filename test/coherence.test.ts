import { describe, it, expect } from 'vitest'
import { checkConsistency } from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'

let nextId = 0
function block(text: string, kind: BookBlock['kind'] = 'paragraph', pages = [0]): BookBlock {
  return { id: `p0b${nextId++}`, kind, text, sourcePages: pages }
}

function doc(blocks: BookBlock[], over: Partial<BookDocument> = {}): BookDocument {
  nextId = 0
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: [],
    ...over
  }
}

const kinds = (d: BookDocument) => checkConsistency(d).map((f) => f.kind)

/**
 * A name the scan has garbled by one letter — `y` read as `v`, `e` as `c`, `rn`
 * as `m`. That single substitution is what a scan actually produces, and it is
 * what this check is for.
 *
 * Two edits is deliberately out of range, and the cost is named in the test
 * below rather than hidden: at two, this returned seventeen findings on a
 * finished book of which one was real. See `MAX_NAME_EDITS`.
 */
describe('a name the book spells two ways', () => {
  const withBailly = (rare: string) =>
    doc([
      block(`One of the company was Jean Sylvain Bailly, the astronomer.`),
      block(`The remark of Bailly is often quoted in this connection.`),
      block(`M. Bailly, who was present, said nothing at the time.`),
      block(`It was ${rare} who first perceived the drift of the thing.`)
    ])

  it('reports the rare spelling against the established one', () => {
    // `y` misread as `v` — one substitution, the commonest thing a scan does.
    const found = checkConsistency(withBailly('Baillv')).filter((f) => f.kind === 'name-variant')
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toBe('Baillv')
    expect(found[0]!.against).toContain('Bailly')
    expect(found[0]!.context).toContain('Baillv')
  })

  /**
   * The known miss, kept as a test so nobody re-widens the threshold without
   * meeting the reason it is narrow. `Baillie` for `Bailly` is a real fault in
   * a real book on this shelf and it was found by *reading*. Catching it needs
   * two edits, and two edits is where `India`/`Indians`, `Europe`/`European`
   * and `Marie`/`Market` all start matching too. It belongs to the sense pass.
   */
  it('does not catch a two-edit variant, and that is the deal', () => {
    const found = checkConsistency(withBailly('Baillie')).filter((f) => f.kind === 'name-variant')
    expect(found).toHaveLength(0)
  })

  /** Morphology is not misspelling: one spelling being the front of the other. */
  it('leaves a word and its inflections alone', () => {
    for (const pair of [
      ['India', 'Indians'],
      ['Europe', 'European'],
      ['Highlands', 'Highlanders'],
      ['Crookes', 'Crookes’']
    ]) {
      const [common, rare] = pair as [string, string]
      const d = doc([
        block(`The record of ${common} is long.`),
        block(`He wrote of ${common} at length.`),
        block(`A student of ${common} knows this.`),
        block(`The customs of ${rare} differ.`)
      ])
      expect(kinds(d)).not.toContain('name-variant')
    }
  })

  /** A common noun that happens to be capitalised is not a name being fumbled. */
  it('will not pair a hapax against a word the book uses constantly', () => {
    const blocks = Array.from({ length: 25 }, (_, i) =>
      block(`The Society met again in ${1880 + i}.`)
    )
    blocks.push(block('A note on the Societe astronomique de France.'))
    expect(kinds(doc(blocks))).not.toContain('name-variant')
  })

  it('says nothing when the book is consistent', () => {
    expect(kinds(withBailly('Bailly'))).not.toContain('name-variant')
  })

  it('leaves two genuinely different names alone', () => {
    // Barrett and Bailly are four edits apart; nothing here should pair them.
    expect(kinds(withBailly('Barrett'))).not.toContain('name-variant')
  })

  it('will not pair two names that are each printed once', () => {
    // Neither is established, so the asymmetry that makes this a slip is absent
    // and there is nothing to say which of the two the book meant.
    const d = doc([
      block('A letter from Cazotte reached him that winter.'),
      block('A letter from Cazote reached him that winter.')
    ])
    expect(kinds(d)).not.toContain('name-variant')
  })

  it('ignores headings, which this period sets entirely in capitals', () => {
    const d = doc([
      block('THE ASTRAL SENSES', 'heading'),
      block('Panchadasi returns to the point in the next lesson.'),
      block('Panchadasi is clear about it.'),
      block('Panchadasi says so twice.')
    ])
    expect(kinds(d)).not.toContain('name-variant')
  })
})

describe('a word or a phrase printed twice', () => {
  it('reports a doubled word', () => {
    const found = checkConsistency(
      doc([block('The astral senses are the the senses of the astral body.')])
    ).filter((f) => f.kind === 'doubled-word')
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toMatch(/the\s+the/i)
  })

  it('leaves the words English really does double', () => {
    expect(kinds(doc([block('He knew that that was the whole of it.')]))).not.toContain(
      'doubled-word'
    )
    expect(kinds(doc([block('She had had no warning of any kind.')]))).not.toContain('doubled-word')
  })

  /** What a page seam does when a line is set on both leaves. */
  it('reports a run of words repeated immediately', () => {
    const found = checkConsistency(
      doc([
        block(
          'the mind receives the report of the senses the mind receives the report of the senses and acts upon it.'
        )
      ])
    ).filter((f) => f.kind === 'doubled-phrase')
    expect(found).toHaveLength(1)
    expect(found[0]!.pages).toEqual([0])
  })

  it('does not report ordinary prose as a repeated run', () => {
    expect(
      kinds(doc([block('The senses report to the mind, and the mind reports to the ego.')]))
    ).not.toContain('doubled-phrase')
  })
})

/**
 * A quotation running over several paragraphs opens each and closes only the
 * last — normal typography, and the reason this cannot simply count marks.
 */
describe('a quotation that never closes', () => {
  it('reports an unclosed quotation', () => {
    const found = checkConsistency(
      doc([
        block('He said, “All occultists know that man has seven senses.'),
        block('The next paragraph begins in the ordinary way.')
      ])
    ).filter((f) => f.kind === 'unclosed-quote')
    expect(found).toHaveLength(1)
  })

  it('leaves a quotation continued into the next paragraph', () => {
    const found = checkConsistency(
      doc([
        block('He said, “All occultists know that man has seven senses.'),
        block('“And the additional two are known to few of them.”')
      ])
    ).filter((f) => f.kind === 'unclosed-quote')
    expect(found).toHaveLength(0)
  })

  /**
   * Straight marks cannot be measured — the same character opens and closes —
   * so a book still carrying them is left alone rather than guessed at.
   */
  it('says nothing about a book whose quotes are still typewriter marks', () => {
    const found = checkConsistency(
      doc([block('He said, "All occultists know that man has seven senses.')])
    ).filter((f) => f.kind === 'unclosed-quote')
    expect(found).toHaveLength(0)
  })
})

describe('a cross-reference to a chapter the book has not got', () => {
  const chaptered = (reference: string): BookDocument => {
    const blocks = [
      block('LESSON I.', 'heading'),
      block('THE ASTRAL SENSES.', 'heading'),
      block(`The student will find this treated at length in ${reference}.`)
    ]
    return doc(blocks, {
      chapters: [
        {
          id: blocks[0]!.id,
          title: 'THE ASTRAL SENSES.',
          label: 'LESSON I.',
          level: 1,
          blockIndex: 0,
          sourcePage: 0
        }
      ]
    })
  }

  it('reports a numeral the book never prints', () => {
    const found = checkConsistency(chaptered('Lesson XXII')).filter(
      (f) => f.kind === 'missing-chapter'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toMatch(/XXII/)
    expect(found[0]!.against).toContain('I')
  })

  it('leaves a reference to a chapter that exists', () => {
    expect(kinds(chaptered('Lesson I'))).not.toContain('missing-chapter')
  })

  it('says nothing at all when the book numbers no chapters', () => {
    expect(kinds(doc([block('As shown in Lesson IV, the senses are seven.')]))).toHaveLength(0)
  })
})

describe('the shape of the report', () => {
  it('carries the block and its source leaves, so a crop can be cut', () => {
    const d = doc([block('the the astral senses', 'paragraph', [11, 12])])
    const found = checkConsistency(d)
    expect(found[0]!.blockId).toBe('p0b0')
    expect(found[0]!.pages).toEqual([11, 12])
  })

  it('reads the editor’s own written sections too', () => {
    const d = doc([block('Ordinary body text.')], {
      sections: [
        {
          id: 'introduction',
          placement: 'front',
          title: 'Before You Begin',
          blocks: [
            {
              id: 'introduction/b0',
              kind: 'paragraph',
              text: 'It was was printed in Chicago.',
              sourcePages: []
            }
          ]
        }
      ]
    })
    const found = checkConsistency(d).filter((f) => f.kind === 'doubled-word')
    expect(found).toHaveLength(1)
    expect(found[0]!.blockId).toBe('introduction/b0')
  })

  it('comes back in reading order', () => {
    const d = doc([
      block('nothing wrong here at all'),
      block('the the first fault'),
      block('and and the second')
    ])
    const found = checkConsistency(d)
    expect(found.map((f) => f.blockId)).toEqual(['p0b1', 'p0b2'])
  })

  it('finds nothing in a clean book', () => {
    const d = doc([
      block('The student of occultism is familiar with the sceptical attitude.'),
      block('He expresses it in his remark that he believes only what he sees.')
    ])
    expect(checkConsistency(d)).toHaveLength(0)
  })
})

/**
 * A slip the book itself can show you, with no second transcription and no
 * model: a word used once, one dropped letter from a word used dozens of times.
 *
 * Every word here is a real misreading off a real leaf of *Clairvoyance*, and
 * every one of them was missed by comparing two independent readings of the
 * same pixels — because both readers made it. The sense pass caught them by
 * *reading*; this catches them for nothing.
 */
describe('checkConsistency — a spelling the book uses once', () => {
  const bookOf = (stray: string, common: string, uses = 10) => {
    const filler = Array.from({ length: uses }, () =>
      block(`The astral ${common} of the aura is plain to the trained eye.`)
    )
    return doc([...filler, block(`A curious ${stray} appeared upon the plate.`)])
  }
  const strays = (d: BookDocument) => checkConsistency(d).filter((f) => f.kind === 'stray-spelling')

  for (const [stray, common] of [
    ['hundrds', 'hundreds'],
    ['developd', 'developed'],
    ['arrivd', 'arrived'],
    ['discoverd', 'discovered'],
    ['conciously', 'consciously']
  ] as const) {
    it(`flags ${stray} against ${common}`, () => {
      const found = strays(bookOf(stray, common))
      expect(found.map((f) => f.found)).toContain(stray)
      expect(found[0]!.against).toContain(common)
    })
  }

  it('flags a transposition, which Levenshtein scores as two', () => {
    // `perscription` for `prescription`: a compositor reaching into the wrong
    // box, and the shape of a real query on *The Human Aura*.
    expect(strays(bookOf('perscription', 'prescription')).map((f) => f.found)).toContain(
      'perscription'
    )
  })

  /**
   * The measured limit, and the reason this check is worth trusting.
   *
   * Allowing one substitution returned 129 findings on *Clairvoyance* and not
   * one was real — `winds` against `minds`, `crass` against `class`, `chose`
   * against `those`. Changing a letter of an English word very often makes
   * another English word; dropping one rarely does.
   */
  describe('substitutions are out of scope, and deliberately', () => {
    for (const [stray, common] of [
      ['winds', 'minds'],
      ['crass', 'class'],
      ['chose', 'those'],
      ['coarse', 'course']
    ] as const) {
      it(`says nothing about ${stray} against ${common}`, () => {
        expect(strays(bookOf(stray, common))).toEqual([])
      })
    }

    it('and so gives up a real one, which a second reader is for', () => {
      // `snbstance` for `substance` is a substitution. Two engines reading the
      // same ink do not make the same one, so `witness` sees it and this does not.
      expect(strays(bookOf('snbstance', 'substance'))).toEqual([])
    })
  })

  it('says nothing about a plural, which is where the last letter lives', () => {
    expect(strays(bookOf('auras', 'aura'))).toEqual([])
  })

  it('says nothing about a tense', () => {
    expect(strays(bookOf('believed', 'believes'))).toEqual([])
  })

  it('says nothing about an ordinary English word used once', () => {
    expect(strays(bookOf('under', 'understand'))).toEqual([])
  })

  it('says nothing when the neighbour is not this book’s settled spelling', () => {
    // Two uses is not a spelling the book has.
    expect(strays(bookOf('hundrds', 'hundreds', 2))).toEqual([])
  })

  it('says nothing about a word the book uses twice', () => {
    const filler = Array.from({ length: 10 }, () =>
      block('The astral hundreds of the aura is plain to the trained eye.')
    )
    expect(
      strays(doc([...filler, block('A curious hundrds here.'), block('And hundrds again.')]))
    ).toEqual([])
  })

  it('says nothing about a short word, which has too many neighbours', () => {
    expect(strays(bookOf('thc', 'the'))).toEqual([])
  })

  it('carries the leaf and enough of the sentence to find the place', () => {
    const found = strays(bookOf('developd', 'developed'))
    expect(found[0]!.pages.length).toBeGreaterThan(0)
    expect(found[0]!.context).toContain('developd')
  })
})
