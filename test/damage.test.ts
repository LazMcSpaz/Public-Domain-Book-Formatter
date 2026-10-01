import { describe, it, expect } from 'vitest'
import { checkDamage, damageSheet, honourRulings, type DamageFinding } from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'
import ENGLISH from './fixtures/english-words.json'

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

/**
 * The loose tier: a split one of whose halves is a common word or a letter.
 *
 * All four came out of _Patterns_ Vol. I after the strict rule had reported
 * nothing on it. Each fixture carries the halves often enough that the strict
 * rule is blind to it, which is the condition the tier exists for.
 */
describe('a word split where one half is an ordinary word', () => {
  const common = [
    'It was before the war, and before the flood, and before anything.',
    'Let it be. Let it be so. Let it be said. Let it be.',
    'The letters were read. The letters were burnt.',
    'He knew that it was so, and that it was late, and that it was over.',
    'I think it is. I know it is. I said it is.'
  ]
  const found = (line: string) => of(build([...common, line]), 'split-word')

  it.each([
    ['as he had been be fore the trance', 'be fore', 'before'],
    ['repeating the let ters of the alphabet', 'let ters', 'letters'],
    ['this suggests t hat one of the differences', 't hat', 'that'],
    ['in a deep trance, i t would be difficult', 'i t', 'it']
  ])('finds `%s`, as a place to look rather than a verdict', (line, split, joined) => {
    const hits = found(line)
    expect(hits.map((f) => f.found)).toEqual([split])
    expect(hits[0]!.expected).toBe(joined)
    expect(hits[0]!.confidence).toBe('shape')
  })

  it('keeps a split with two rare halves attested', () => {
    const hits = of(
      build(['The description was long.', 'Another description.', 'Two of descrip tion.']),
      'split-word'
    )
    expect(hits[0]!.confidence).toBe('attested')
  })

  it('leaves a letter named as a letter alone', () => {
    const words = ['The theme was them.', 'Then them, then them again.']
    expect(of(build([...words, 'Here the m and the n are convertible.']), 'split-word')).toEqual([])
  })

  it('leaves an abbreviation after a word alone', () => {
    // `see` is no article, so only the stop after the letter tells `see p.`
    // from `seep`.
    const words = ['The water will seep.', 'It will seep again.']
    expect(of(build([...words, 'For the rest, see p. 47 of it.']), 'split-word')).toEqual([])
  })

  it('leaves an ordinal alone, whose letters the walk sees without their digits', () => {
    const words = ['A thin line.', 'Very thin indeed.']
    expect(
      of(build([...words, 'Given the week beginning Oct. 19th in the Hall.']), 'split-word')
    ).toEqual([])
  })

  it('leaves a two-word name alone', () => {
    const words = ['The sakyamuni legend.', 'Of sakyamuni again.']
    expect(of(build([...words, 'A biography of Sakya Muni, the Buddha.']), 'split-word')).toEqual(
      []
    )
  })

  it('leaves a word beside an article alone', () => {
    // `a` is a word, never the rare half: `a part` is two words.
    const words = ['It was apart from us.', 'We stood apart.', 'A part of it.']
    expect(of(build([...words, 'He was a part of the whole.']), 'split-word')).toEqual([])
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

  // A Modern Panarion, leaf 332: the period sets "per cent." with its stop,
  // and a figure rather than a word follows `per`, so only the list catches it.
  it('leaves “per cent.” alone', () => {
    expect(
      of(build(['together with 1½ per cent. to the chief assayer, were deposited.']), 'stray-point')
    ).toEqual([])
  })

  // The Theosophical Glossary, leaves 161, 229 and 260: all three as printed.
  it('leaves a roman chapter number and an abbreviated title alone', () => {
    for (const text of [
      'In Genesis xxxii. the God-Sun first strives with Jacob.',
      '(Hieronymus’ Comment. to Matthew, Book II., chapter xii.)',
      '(See A Dict. of Christian Biography, Vol. IV.)'
    ])
      expect(of(build([text]), 'stray-point')).toEqual([])
  })

  it('still reports a stop before a word no roman numeral spells', () => {
    expect(of(build(['He was ill. the doctor came at once.']), 'stray-point')).toHaveLength(1)
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

  it('leaves the possessive of a name ending in z alone', () => {
    expect(
      of(
        build(['from the German annalist Archenholz\u2019 work on England (1788)']),
        'stray-apostrophe'
      )
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

describe('the false positives Isis Vol. I turned up', () => {
  // Measured on `reference/blavatsky/isis-vol1.txt`: 40 findings and about
  // eighteen of them false, which is a check nobody would keep running.
  const kinds = (text: string) => checkDamage(build([text])).map((f) => f.kind)

  it('does not call a closing curly quote a stray apostrophe', () => {
    // The walk tracked ' and ’ but never ‘, so an opening curly quote did not
    // open anything and its closing partner looked like a comma mis-read.
    expect(
      kinds('Professor Thury’s ectenic force, and his own ‘psychic force’ are equivalent terms.')
    ).not.toContain('stray-apostrophe')
    expect(kinds('there is no doubt that ‘tukki’ is simply the old Tamil word.')).not.toContain(
      'stray-apostrophe'
    )
  })

  it('still catches a real stray apostrophe', () => {
    // The class this check exists for, and the one the fix must not lose.
    expect(kinds('after the examination’ I tell him to open his eyes.')).toContain(
      'stray-apostrophe'
    )
  })

  it('does not call a citation abbreviation a stray point', () => {
    expect(
      kinds('shares with “Simpl. in Phys.,” 143 ; “The Chaldean Oracles,” Cory.')
    ).not.toContain('stray-point')
    expect(
      kinds(
        'had belonged to the Alexandrian school of Platonists, “Hist. of Magic,” vol. i., p. 9.'
      )
    ).not.toContain('stray-point')
  })

  it('does not read a running head as a sentence', () => {
    // Widening the capture to take a capitalised word — needed so that
    // `Simpl.` could be recognised as an abbreviation at all — made the
    // running head at the top of every page into a finding. On *A Modern
    // Panarion* that was sixty of eighty-four: `A MODERN PANARION.` followed
    // by the first lower-case word of the body. A word in full capitals
    // before a stop is a head or an initialism, never a mis-read comma.
    expect(kinds('A MODERN PANARION. with the Kabalah in his hand he went on.')).not.toContain(
      'stray-point'
    )
    expect(kinds('thirty years after his death his MSS. and his notes were lost.')).not.toContain(
      'stray-point'
    )
  })

  it('still catches a comma the conversion read as a full stop', () => {
    expect(
      kinds('It states that from æther have come all things. and to it all will return.')
    ).toContain('stray-point')
  })
})

/**
 * Two stops the trade does set: the Latin of a citation and a month in a date.
 *
 * Both came off *The Secret Doctrine* Vol. I, where the gate failed the book
 * on `1 et seq. for easier reading` and `Nos. 10 and 11, of Jan. and Feb.`.
 */
describe('abbreviations a citation uses', () => {
  it('lets `et seq.` and a month pass', () => {
    const d = build([
      'The latter are made to run from 1 et seq. for easier reading.',
      'See PATH, Nos. 10 and 11, of Jan. and Feb. 1887, on the subject.'
    ])
    expect(of(d, 'stray-point')).toEqual([])
  })

  it('still catches the comma read as a stop beside them', () => {
    const d = build([
      'The latter are made to run from 1 et seq. for easier reading. It is fine. the rest'
    ])
    expect(of(d, 'stray-point').map((f) => f.found)).toEqual(['fine. the'])
  })
})

/**
 * A ruling the editor filed on the leaf takes the finding out of the count.
 *
 * `“Egg’ or` on leaf 377 of *The Secret Doctrine*: a double mark opens and a
 * single one closes, the render shows exactly that, and the editor ruled it
 * as printed. The gate has to be able to hear that, and only that.
 */
describe('a finding under an as-printed ruling', () => {
  const egg = () => {
    nextId = 0
    return doc([
      block('The Mundane Egg’ or the Circle, is a symbol of the world.', 'paragraph', [377]),
      block('It is fine. the rest', 'paragraph', [378])
    ])
  }

  it('is honoured when the ruling is on its leaf and over its words', () => {
    const d = egg()
    const all = checkDamage(d)
    expect(all.map((f) => f.found)).toEqual(['Egg’ or', 'fine. the'])
    const { kept, honoured } = honourRulings(
      all,
      // Typed from the screen with a straight quote and a different curl: the
      // match has to fold both, or the ruling never reaches the finding.
      [{ pageIndex: 377, quote: "Egg 'or the Circle", decision: 'as-printed' }],
      d
    )
    expect(honoured.map((h) => h.finding.found)).toEqual(['Egg’ or'])
    expect(kept.map((f) => f.found)).toEqual(['fine. the'])
  })

  it('is kept under a ruling on another leaf, over other words, or that corrects', () => {
    const d = egg()
    const all = checkDamage(d)
    const keptUnder = (r: Parameters<typeof honourRulings>[1][number]) =>
      honourRulings(all, [r], d).kept.length
    expect(keptUnder({ pageIndex: 378, quote: 'Egg ‘or the Circle', decision: 'as-printed' })).toBe(
      2
    )
    expect(
      keptUnder({ pageIndex: 377, quote: 'symbol of the world', decision: 'as-printed' })
    ).toBe(2)
    expect(keptUnder({ pageIndex: 377, quote: 'Egg ‘or the Circle', decision: 'corrected' })).toBe(
      2
    )
    // A standing ruling holds the query for approval; it files nothing yet.
    expect(
      keptUnder({ pageIndex: null, quote: 'Egg ‘or the Circle', decision: 'as-printed' })
    ).toBe(2)
  })

  it('is listed on the sheet rather than dropped', () => {
    const d = egg()
    const { kept, honoured } = honourRulings(
      checkDamage(d),
      [{ pageIndex: 377, quote: 'Egg ‘or the Circle', decision: 'as-printed' }],
      d
    )
    const sheet = damageSheet(kept, d, 'Test', honoured)
    expect(sheet).toContain('1 honoured by a ruling')
    expect(sheet).toContain('## Honoured by a ruling')
    expect(sheet).toContain('`Egg’ or` — p0b0, leaf 377')
  })
})

describe('a note that prints its own mark', () => {
  const note = (text: string, marker = '*') => ({
    id: 'fn7',
    originalMarker: marker,
    text,
    pageIndex: 330,
    orphaned: false
  })

  it('reports a mark the scan ran into the first word', () => {
    const d = doc([], { footnotes: [note('*Eve is the trinity of nature.')] })
    const found = of(d, 'marked-note')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ blockId: 'fn7', found: '*', pages: [330] })
  })

  it('leaves a note whose text starts with its words alone', () => {
    const d = doc([], { footnotes: [note('Eve is the trinity of nature.')] })
    expect(of(d, 'marked-note')).toHaveLength(0)
  })

  it('leaves the editor’s own note alone, which has no printed mark', () => {
    const d = doc([], { footnotes: [note('* is how the original marks it.', '')] })
    expect(of(d, 'marked-note')).toHaveLength(0)
  })
})

describe('a paragraph a page break split where the seam rule cannot see', () => {
  const pair = (end: string, opens: string, pages: [number, number] = [120, 121]) => {
    nextId = 0
    return doc([block(end, 'paragraph', [pages[0]]), block(opens, 'paragraph', [pages[1]])])
  }

  it('reports a next leaf that opens on a quotation mark and a lower-case word', () => {
    const d = pair(
      '“It was enough,” exclaims the professor,',
      '“to make David Hume turn in his grave.'
    )
    const found = of(d, 'seam-split')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ blockId: 'p0b0', pages: [120, 121] })
  })

  it('reports a next leaf that opens on an ellipsis', () => {
    const d = pair(
      'impressions of all our actions ;',
      '. . . it may be, too, that there are tests.'
    )
    expect(of(d, 'seam-split')).toHaveLength(1)
  })

  it('leaves a quotation that opens a new sentence alone', () => {
    const d = pair('He was content with that.', '“to be or not to be” was all he said.')
    expect(of(d, 'seam-split')).toHaveLength(0)
  })

  it('leaves two paragraphs on one leaf alone', () => {
    const d = pair('he adds,', '“much more deserving of the term.', [121, 121])
    expect(of(d, 'seam-split')).toHaveLength(0)
  })

  it('leaves a capitalised quotation alone, which the seam rule is right not to join', () => {
    const d = pair('he said,', '“Many are called.')
    expect(of(d, 'seam-split')).toHaveLength(0)
  })
})

describe('characters no compositor set', () => {
  const found = (text: string) => of(build([text]), 'garbled').map((f) => f.found)

  it('reports a replacement character', () => {
    expect(found('the cycle of Men Exist ago� Spontaneous')).toEqual(['ago�'])
  })

  it('reports a letter fused with a symbol no word carries', () => {
    expect(found('the Bishop of C<esarea—that self-constituted')).toEqual(['C<esarea—that'])
    expect(found('\\Vhat is the meaning')).toEqual(['\\Vhat'])
  })

  it('reports letters and digits interleaved, as a date read as letters is', () => {
    expect(found('London, October, r8S8.')).toEqual(['r8S8'])
    expect(found('the Greek Av8pw11 or man')).toEqual(['Av8pw11'])
  })

  it('reports small capitals read as two cases, and a capital I for an l', () => {
    expect(found('STANZA V.—THE EvoLUTION OF THE SECOND RACE')).toEqual(['EvoLUTION'])
    expect(found('the pIan of the work')).toEqual(['pIan'])
  })

  it('leaves ordinals, formats, formulas and names alone', () => {
    expect(
      found(
        'the 3rd and 21st, a 3me partie, an 8vo of 1877, NA2CO3 and 2HKC4H4O6, ' +
          'McDONALD, FitzEdward Hall, an eBay listing, 2π and 2α, 10ⁿ, 2bc, ' +
          '13deg. 10m. 35sec., 1d. 23h. 20min.'
      )
    ).toEqual([])
  })

  it('reports in the book’s own footnotes, keyed by the note', () => {
    const d = doc([], {
      footnotes: [
        {
          id: 'fn9',
          originalMarker: '*',
          text: 'Max Mi.iller, in C<esarea.',
          pageIndex: 4,
          orphaned: false
        }
      ]
    })
    expect(of(d, 'garbled').map((f) => [f.blockId, f.found])).toEqual([['fn9', 'C<esarea.']])
  })
})

describe('punctuation set inside a word', () => {
  const found = (t: string) => of(build([t]), 'garbled').map((f) => f.found)

  it('reports a bang, a semicolon or a colon between letters', () => {
    expect(found('respectively called AOT, AOAI, om, OT!JAB, “the fifth')).toEqual(['OT!JAB,'])
    expect(found('the demi-hero 1-‘Li;apxa:yhas. (See Plutarch')).toEqual(['1-‘Li;apxa:yhas.'])
  })

  it('leaves a formula alone, where the bracket is the notation', () => {
    expect(found('the general term [(k + 1)/k]ᵏ, and [a² + b² + ab]h/3, respectively')).toEqual([])
  })
})

/**
 * Greek read as Latin letters alone. The check learns English from the book,
 * so the fixture has to be a book's English: every lower-case word of _The
 * Key to Theosophy_, set as often as that book sets it up to six times. The
 * rare words matter as much as the common ones, because a word set once is
 * judged against the trigrams the rest of the book shares with it. The words
 * under test were taken out of it, or they would be scored as the book's own.
 */
describe('Greek the conversion read as Latin letters', () => {
  const filler = (): string[] => {
    const words = (ENGLISH as [string, number][]).flatMap(([w, n]) => Array<string>(n).fill(w))
    const out: string[] = []
    for (let i = 0; i < words.length; i += 12) out.push(words.slice(i, i + 12).join(' ') + '.')
    return out
  }
  const greek = (...texts: string[]) =>
    of(build([...filler(), ...texts]), 'greek').map((f) => [f.found, f.expected ?? null])

  it('reports a Greek word read as Latin letters', () => {
    expect(greek('Saturn is not only Xpbvos, time, but also the father.')).toEqual([
      ['Xpbvos', null]
    ])
  })

  it('names the Greek word a garbling matches, through a reading no transliterator writes', () => {
    // `ρ` read as `p`: the one tell in `Moipa`.
    expect(greek('The Greeks called her Moipa, the allotted portion.')).toEqual([
      ['Moipa', 'Μοῖρα']
    ])
  })

  it('leaves a transliteration alone, which romanises the word on purpose', () => {
    expect(
      greek(
        'Socrates had a daimonion, and the powers were called Dunameis.',
        // `Δήλιος` reaches it, through five readings no transliterator writes.
        'Hazy as the rambling imagination of a pulpit orator.'
      )
    ).toEqual([])
  })

  it('leaves an English word the book sets once alone', () => {
    expect(
      greek('In the spring the odor was faint, the data were few and the count was zero.')
    ).toEqual([])
  })

  it('reports a whole run once its worst word is Greek-shaped', () => {
    expect(
      greek('the Keys of the Empire of the Dead, TOU Oavrirov apx-,J, to that day').map((r) => r[0])
    ).toEqual(['TOU', 'Oavrirov', 'apx-,J'])
  })

  it('is listed for reading and counted apart from the conversion damage', () => {
    const findings = of(build([...filler(), 'Saturn is not only Xpbvos, time.']), 'greek')
    expect(findings.every((f) => f.confidence === 'shape')).toBe(true)
  })
})
