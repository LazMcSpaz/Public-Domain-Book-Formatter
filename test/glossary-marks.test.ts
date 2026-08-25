import { describe, expect, it } from 'vitest'
import { checkGlossaryMarks, headwordTerms, type MarkableBlock } from '@core/annotate'

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
