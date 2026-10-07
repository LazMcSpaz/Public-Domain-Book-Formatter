import { describe, expect, it } from 'vitest'
import {
  checkGlossaryMarks,
  placeMissingMarks,
  glossaryHeadwords,
  headwordTerms,
  withGlossaryMark,
  type MarkableBlock
} from '@core/annotate'

/**
 * The check that would have caught a whole volume shipping with no marks.
 *
 * A glossary nothing points at is a section a reader has no reason to open,
 * and it fails silently: the book file is valid, the export is clean, the KDP
 * checks pass. One volume on this shelf carried 85 marks; the next carried a
 * 74-entry glossary and none, and nothing anywhere said so.
 */
const para = (id: string, text: string): MarkableBlock => ({ id, kind: 'paragraph', text })

describe('every entry the book uses should carry a mark', () => {
  it('finds the entry whose word is in the text with no circle on it', () => {
    const report = checkGlossaryMarks(
      ['Astral body.', 'Prana, vital force.'],
      [
        para('p1b0', 'that which is called by some occultists "the astral body," but this'),
        para('p2b0', 'best known under the Sanscrit term, Prana°, but which may be')
      ]
    )
    expect(report.unmarked.map((v) => v.entry)).toEqual(['Astral body.'])
    expect(report.marked.map((v) => v.entry)).toEqual(['Prana, vital force.'])
    expect(report.absent).toHaveLength(0)
  })

  /**
   * An entry for something the book never names is legitimate, not a fault:
   * the Theosophical "auric egg" is what these books call an egg-shaped aura,
   * and the entry explains a thing the reader meets under another name. The
   * report has to tell the two apart or it cries wolf on every such entry.
   */
  it('separates a word the book never uses from one it uses unmarked', () => {
    const report = checkGlossaryMarks(
      ['Auric egg.', 'Theosophy, the Theosophical Society.', 'Ether.'],
      [para('p1b0', 'surrounded by the egg-shaped aura, and nothing left but the ether')]
    )
    expect(report.absent.map((v) => v.entry)).toEqual([
      'Auric egg.',
      'Theosophy, the Theosophical Society.'
    ])
    expect(report.unmarked.map((v) => v.entry)).toEqual(['Ether.'])
  })

  /**
   * A term the book uses only in a chapter heading counts as absent. A mark
   * there would travel into the running head and the contents, which is no
   * place for a circle.
   */
  it('does not ask for a mark on a heading', () => {
    const report = checkGlossaryMarks(
      ['Auric magnetism.'],
      [
        { id: 'p62b1', kind: 'heading', text: 'AURIC MAGNETISM.' },
        para('p62b2', 'nothing here uses the phrase again')
      ]
    )
    expect(report.absent.map((v) => v.entry)).toEqual(['Auric magnetism.'])
    expect(report.unmarked).toHaveLength(0)
  })

  it('counts a circle in a list item, a quotation or a caption', () => {
    const report = checkGlossaryMarks(
      ['Devachan.', 'Kundalini.', 'Scottish Rite.'],
      [
        para('p1b0', 'Devachan is the heaven world, and Kundalini wakes, at the Scottish Rite.'),
        { id: 'p2b0', kind: 'list-item', text: 'Kama Loka and Devachan°' },
        { id: 'p3b0', kind: 'blockquote', text: 'awakening the Goddess Kundalini°' },
        { id: 'p4b0', kind: 'caption', text: 'given in the Scottish Rite° Auditorium' }
      ]
    )
    expect(report.unmarked).toHaveLength(0)
    expect(report.marked).toHaveLength(3)
  })

  it('reads a headword’s alternatives, and the book’s own spelling', () => {
    expect(headwordTerms('Nimbus, halo.')).toEqual(['Nimbus', 'halo'])
    expect(headwordTerms('Aura, the human aura.')).toEqual(['Aura', 'human aura'])

    // The glossary is in this editor's spelling and the book in its own.
    const report = checkGlossaryMarks(
      ['Astral colours.'],
      [para('p1b0', 'hence bear the name of "the astral colors." Belonging to the')]
    )
    expect(report.unmarked).toHaveLength(1)
    expect(report.absent).toHaveLength(0)
  })

  /**
   * Found by pointing the check at a real book. These two books introduce a
   * term in a run-in heading set in capitals and then name it in the prose
   * below; the circle belongs on the words, not on the heading. Taking the
   * *first* occurrence as the verdict flagged that as unmarked.
   */
  it('accepts a mark on any occurrence, not only the first', () => {
    const report = checkGlossaryMarks(
      ['Artificial entities.'],
      [
        para(
          'p175b3',
          'ARTIFICIAL ENTITIES. In addition to the non-human entities which are ' +
            'perceived by astral vision, there are semi-entities, which occultists ' +
            'know as “artificial entities°.”'
        )
      ]
    )
    expect(report.marked.map((v) => v.entry)).toEqual(['Artificial entities.'])
    expect(report.unmarked).toHaveLength(0)
  })

  /** Also found on a real book: the glossary types ' and the book sets ’. */
  it('reads a curly apostrophe as the straight one the glossary types', () => {
    const report = checkGlossaryMarks(
      ["Dante's Inferno."],
      [para('p159b1', 'a mere stage setting as it were. Dante\u2019s Inferno has its adequate')]
    )
    expect(report.absent).toHaveLength(0)
    expect(report.unmarked.map((v) => v.entry)).toEqual(["Dante's Inferno."])
  })

  it('matches a plural, and a compound the book hyphenates', () => {
    const report = checkGlossaryMarks(
      ['Sub-plane.', 'Thought-form.'],
      [
        para('p1b0', 'each of the Seven Planes has seven sub-planes°; and that each'),
        para('p2b0', 'these are the projected thought forms of which all occultists')
      ]
    )
    expect(report.marked.map((v) => v.entry)).toEqual(['Sub-plane.'])
    expect(report.unmarked.map((v) => v.entry)).toEqual(['Thought-form.'])
  })
})

describe('glossaryHeadwords — the one extraction rule', () => {
  it('reads the bolded opening of each entry line', () => {
    const heads = glossaryHeadwords(
      '<b>Alembick.</b> The upper vessel.\n\n<b>Athanor.</b> A furnace.\n\nA paragraph with no headword.'
    )
    expect(heads).toEqual(['Alembick.', 'Athanor.'])
  })
})

describe('withGlossaryMark — placing the circle where the editor pointed', () => {
  it('marks the first unmarked use, directly after the words', () => {
    expect(withGlossaryMark('The alembick being set.', 'Alembick')).toBe('The alembick° being set.')
  })

  it('reads through the notation and marks inside the run', () => {
    expect(withGlossaryMark('the <i>astral body</i> appears', 'astral body')).toBe(
      'the <i>astral body°</i> appears'
    )
  })

  it('skips a use that already carries the mark', () => {
    expect(withGlossaryMark('aura° and aura again', 'aura')).toBe('aura° and aura° again')
  })

  it('returns null when the term has no unmarked use here', () => {
    expect(withGlossaryMark('nothing of the kind', 'aura')).toBeNull()
    expect(withGlossaryMark('the aura° alone', 'aura')).toBeNull()
  })
})

describe('placeMissingMarks — a circle for every entry nothing points at', () => {
  const blocks: MarkableBlock[] = [
    { id: 'h0', kind: 'heading', text: 'Devachan and Kama Loka' },
    para('p1', 'After death the soul passes through Kama Loka to <i>Devachan</i>.'),
    para('p2', 'The Adept° knows this; Devachan is a state.'),
    para('p3', 'calcination°, putrefaction, inhibition, fermentation')
  ]

  it('marks each unmarked entry once, on its first use in prose, crowded or not', () => {
    const got = placeMissingMarks(
      ['Adept.', 'Devachan.', 'Kama Loka.', 'Putrefaction.', 'Inhibition.', 'Lemuria.'],
      blocks
    )
    expect(got.placed.map((p) => [p.entry, p.blockId])).toEqual([
      ['Devachan.', 'p1'],
      ['Kama Loka.', 'p1'],
      ['Putrefaction.', 'p3'],
      ['Inhibition.', 'p3']
    ])
    // Two circles in one block land on the one text, inside the italic run.
    expect(got.blocks).toEqual([
      {
        id: 'p1',
        text: 'After death the soul passes through Kama Loka° to <i>Devachan°</i>.'
      },
      { id: 'p3', text: 'calcination°, putrefaction°, inhibition°, fermentation' }
    ])
    expect(got.absent.map((v) => v.entry)).toEqual(['Lemuria.'])
  })

  it('reads a circle typed after a closing tag as already there', () => {
    const got = placeMissingMarks(['Devachan.'], [para('p1', 'The <i>Devachan</i>° state.')])
    expect(got.placed).toEqual([])
    expect(got.unplaced).toEqual([])
    expect(got.blocks).toEqual([])
  })
})

describe('a person, and a circle after a quote', () => {
  it('reads Surname, Given (dates) as one person, looked for by surname', () => {
    expect(headwordTerms('Balfour, Arthur James (1848-1930).')).toEqual(['Balfour'])
    expect(headwordTerms('Gnome, sylph, undine, salamander.')).toEqual([
      'Gnome',
      'sylph',
      'undine',
      'salamander'
    ])
  })

  it('does not take a surname for a common noun or for another man’s first name', () => {
    const got = placeMissingMarks(
      ['Butler, W. E. (1898-1978).', 'Balfour, Arthur James (1848-1930).'],
      [
        para('p1', 'Then like Pharaoh’s butler, the owner remembered his sins.'),
        para('p2', 'Prof. Balfour Stewart, a Fellow of the Royal Society.'),
        para('p3', 'Rt. Hon. Arthur J. Balfour, and W. E. Butler.')
      ]
    )
    expect(got.blocks).toEqual([
      { id: 'p3', text: 'Rt. Hon. Arthur J. Balfour°, and W. E. Butler°.' }
    ])
  })

  it('places the circle on the name where a common noun comes first in the block', () => {
    const got = placeMissingMarks(
      ['Butler, W. E. (1898-1978).'],
      [para('p4', 'The butler showed in W. E. Butler.')]
    )
    expect(got.blocks).toEqual([{ id: 'p4', text: 'The butler showed in W. E. Butler°.' }])
  })

  it('counts a circle after a closing quote as the word’s circle', () => {
    const report = checkGlossaryMarks(
      ['Hex.'],
      [para('p1', 'threats of employing his "hex"° (witchcraft) powers')]
    )
    expect(report.marked.map((v) => v.entry)).toEqual(['Hex.'])
  })

  it('places a new circle on the word, not after its closing quote', () => {
    expect(withGlossaryMark('his "hex" powers', 'hex')).toBe('his "hex°" powers')
  })
})
