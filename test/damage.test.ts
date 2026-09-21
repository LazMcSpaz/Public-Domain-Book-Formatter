import { describe, it, expect } from 'vitest'
import { checkDamage, damageSheet, type DamageFinding } from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'

let nextId = 0
function block(text: string, kind: BookBlock['kind'] = 'paragraph', pages = [0]): BookBlock {
  return { id: `p0b${nextId++}`, kind, text, sourcePages: pages }
}

function doc(blocks: BookBlock[], over: Partial<BookDocument> = {}): BookDocument {
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

const build = (texts: string[]): BookDocument => {
  nextId = 0
  return doc(texts.map((t) => block(t)))
}

const of = (d: BookDocument, kind: DamageFinding['kind']) =>
  checkDamage(d).filter((f) => f.kind === kind)

/**
 * A word the conversion broke in half, settled by the book's own vocabulary.
 *
 * The fixture has to carry the joined word elsewhere, because that is the
 * whole witness — without it there is nothing to be right against and the
 * check is required to say nothing.
 */
describe('a word the conversion split', () => {
  const volume = (broken: string) => [
    'The description of the induction follows in the next chapter.',
    'Each description was checked against the recording.',
    broken
  ]

  it('reports it, with the book’s own counts as the evidence', () => {
    const found = of(build(volume('Two general categories of descrip tion apply.')), 'split-word')
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toBe('descrip tion')
    expect(found[0]!.expected).toBe('description')
    expect(found[0]!.confidence).toBe('attested')
    expect(found[0]!.against).toContain('description 2 times')
  })

  it('says nothing when the book never sets the joined word', () => {
    // No `description` anywhere: the volume cannot settle it, so neither can this.
    expect(of(build(['Two general categories of descrip tion apply.']), 'split-word')).toEqual([])
  })

  /**
   * The fault that returned zero findings on a book with ten splits in it.
   *
   * A presence test asks "is `tion` a word this book uses?" and the answer is
   * yes — because the splits themselves are where it uses it. Two splits
   * sharing a fragment must both still be found.
   */
  it('finds both splits when they share a fragment that only they supply', () => {
    const found = of(
      build([
        'The description of the induction follows.',
        'Another description, another induction, another recording.',
        'Two categories of descrip tion apply.',
        'Lines of the induc tion and suggestion.'
      ]),
      'split-word'
    )
    expect(found.map((f) => f.expected).sort()).toEqual(['description', 'induction'])
  })

  /**
   * The fault that hid six of ten findings.
   *
   * `matchAll` consumes what it matches, so scanning `lines of the induc tion`
   * it takes `lines of`, then `the induc`, and never considers `induc tion` as
   * a pair at all. The fixture puts an even number of ordinary words before the
   * split so that a consuming scan lands on the wrong boundary.
   */
  it('finds a split that an even number of words shields from a consuming scan', () => {
    const found = of(
      build([
        'The induction was recorded twice.',
        'She began the induction again.',
        'Here we will extract lines of the induc tion and suggestion.'
      ]),
      'split-word'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toBe('induc tion')
  })

  it('will not join across a line break, which carries no such claim', () => {
    expect(
      of(
        build([
          'The description of the induction follows.',
          'Another description entirely.',
          'Two categories of descrip\ntion apply.'
        ]),
        'split-word'
      )
    ).toEqual([])
  })

  it('leaves two ordinary words alone', () => {
    // `to` and `the` are far too common to be fragments, whatever `tothe` looks like.
    expect(of(build(['He went to the door.', 'She went to the window.']), 'split-word')).toEqual([])
  })
})

/** A full stop no compositor sets. */
describe('a stray full stop', () => {
  it('reports a comma the conversion read as a period', () => {
    const found = of(
      build(['His accomplishments, typically. are either viewed as miracles.']),
      'stray-point'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toBe('typically. are')
    expect(found[0]!.confidence).toBe('shape')
  })

  it('leaves an ordinary sentence boundary alone', () => {
    expect(of(build(['He laughed. The man had gone.']), 'stray-point')).toEqual([])
  })

  /**
   * The fixture has to put a *function word* after the abbreviation.
   *
   * Written first as `vol. ii`, this test passed with the abbreviation list
   * deleted — `ii` opens no sentence either, so the second filter was doing
   * the work and the list was never exercised. `etc. and` is the shape that
   * discriminates, because `and` is exactly what the mid-clause rule fires on.
   */
  it('leaves an abbreviation alone', () => {
    expect(
      of(build(['The list runs to charts, tables, etc. and the notes at the foot.']), 'stray-point')
    ).toEqual([])
  })

  it('reports a doubled stop where a quotation was run in', () => {
    const found = of(
      build(['his formulation of modern transformational linguistics.. . . forms part of it']),
      'stray-point'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toBe('..')
  })

  /**
   * The guard measured off a real contents page.
   *
   * Without the letter before the pair, a page of dot leaders returns a finding
   * per entry — five on the first book this ran against.
   */
  it('is silent on a run of dot leaders', () => {
    expect(
      of(build(['Preview of Patterns. . . . . .. . . . . . …. . . . . . 15']), 'stray-point')
    ).toEqual([])
  })
})

/** An apostrophe standing where a comma belongs. */
describe('a stray apostrophe', () => {
  it('reports one that closes nothing and possesses nothing', () => {
    const found = of(
      build(["When I have reached that part of the examination' I tell my patients so."]),
      'stray-apostrophe'
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.found).toContain("examination' I")
  })

  /**
   * The five false positives the quotation walk removed.
   *
   * Each of these is a mark that closes one that opened earlier in the block,
   * which only a left-to-right walk can know. A pattern match sees a letter, an
   * apostrophe and a space, and reports every one of them.
   */
  it('leaves a closing quotation mark alone', () => {
    expect(
      of(build(["Joe wants to say 'hello' to you, so listen carefully."]), 'stray-apostrophe')
    ).toEqual([])
    expect(
      of(build(["It was just a 'something' that I seemed to feel coming."]), 'stray-apostrophe')
    ).toEqual([])
  })

  it('leaves a possessive alone', () => {
    expect(
      of(build(["It is the authors' intention to present these patterns."]), 'stray-apostrophe')
    ).toEqual([])
  })

  it('leaves a contraction alone', () => {
    expect(of(build(["I'll see you at ten, and we'll begin then."]), 'stray-apostrophe')).toEqual(
      []
    )
  })
})

describe('the sheet', () => {
  const volume = build([
    'The description of the induction follows in the next chapter.',
    'Each description was checked against the recording.',
    'Two general categories of descrip tion apply.',
    'His accomplishments, typically. are either viewed as miracles.'
  ])

  it('separates what the book settled from what needs eyes', () => {
    const text = damageSheet(checkDamage(volume), volume, 'Patterns Vol. I')
    expect(text).toContain('1 settled by the book itself · 1 needing eyes')
    expect(text).toContain('`descrip tion` → `description`')
  })

  /**
   * The whole block, not the window.
   *
   * Three of four findings put to the editor on one book answered themselves
   * once the paragraph was in view. A sheet that quotes sixty characters either
   * side is a sheet that sends those three back out again.
   */
  it('carries the whole block a finding sits in', () => {
    const long = build([
      'The description of the induction follows.',
      'Another description of another induction.',
      'This paragraph opens a good way before the fault and runs on for a while ' +
        'afterwards, so that a reader is given the sentence that settles it. Two ' +
        'general categories of descrip tion apply here. The next sentence names them ' +
        'both and is the reason the whole block travels rather than a window onto it.'
    ])
    const text = damageSheet(checkDamage(long), long)
    expect(text).toContain('This paragraph opens a good way before the fault')
    expect(text).toContain('the reason the whole block travels')
  })

  /**
   * The case `drive.mjs damage --check` depends on to be usable as a gate.
   *
   * A gate that throws on a clean book fails every run after the one that
   * fixed it, which is worse than no gate: it teaches everyone to pass `|| true`.
   */
  it('builds a sheet for a book with nothing wrong with it', () => {
    const clean = build(['The description of the induction follows in the next chapter.'])
    const found = checkDamage(clean)
    expect(found).toEqual([])
    const text = damageSheet(found, clean)
    expect(text).toContain('0 settled by the book itself · 0 needing eyes')
    expect(text.match(/\*None\.\*/gu)).toHaveLength(2)
  })

  it('never puts the hypothesis into the book', () => {
    // The sheet may say `description`; nothing in this module writes it anywhere.
    const findings = checkDamage(volume)
    expect(findings.every((f) => f.expected === undefined || f.confidence === 'attested')).toBe(
      true
    )
    expect(volume.blocks.map((b) => b.text).join(' ')).toContain('descrip tion')
  })
})
