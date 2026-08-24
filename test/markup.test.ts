import { describe, it, expect } from 'vitest'
import {
  normalizeMarkup,
  parseInlineMarkup,
  parsePageTranscription,
  withMarkup,
  shiftEmphasis,
  wordCount,
  type TranscribedBlock
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import {
  fixedWidthMeasurer,
  layout,
  type LaidOutBook,
  type LaidOutPage,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { BookBlock, BookDocument } from '@core/assemble'

const measurer = fixedWidthMeasurer(0.5)

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

const run = (document: BookDocument): LaidOutBook =>
  layout(document, defaultStyleProfile(), measurer, {
    edition: { title: 'A Treatise', author: 'R. Boyle' }
  })

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line')

const runsSaying = (book: LaidOutBook, text: string) =>
  book.pages.flatMap((p) => lines(p).flatMap((l) => l.runs.filter((r) => r.text === text)))

/**
 * The vision pass was never asked for markup and produced it anyway, because
 * the original prints those words in italic and the schema gave it no field to
 * say so. Left alone the tags are drawn verbatim — a finished book printing
 * angle brackets.
 */
describe('inline markup becomes emphasis', () => {
  it('takes the tags out and remembers which words they covered', () => {
    const { text, emphasis } = parseInlineMarkup(
      'and next to nothing of a practical nature—<em>how to project the astral body.</em>'
    )
    expect(text).not.toContain('<')
    expect(text).toContain('how to project the astral body.')
    // Word 7 is "nature—how": the em dash is not whitespace, so the breaker
    // treats it as one word and the emphasis takes the whole of it. That is the
    // word-granularity tradeoff, and this is the case where it shows — the
    // alternative is threading character ranges through the hyphenator.
    expect(emphasis).toEqual([7, 8, 9, 10, 11, 12])
  })

  it('keeps a superscript footnote mark as the bare digit the note machinery looks for', () => {
    const { text, emphasis } = parseInlineMarkup(
      'the essential link between the two bodies.<sup>1</sup>'
    )
    expect(text).toBe('the essential link between the two bodies.1')
    expect(emphasis).toEqual([])
  })

  it('handles the tags a model reaches for interchangeably', () => {
    expect(
      parseInlineMarkup('the <i>spontaneous</i> and the <em>experimental</em>').emphasis
    ).toEqual([1, 4])
  })

  it('drops markup that means nothing here rather than printing it', () => {
    const { text } = parseInlineMarkup('a <b>bold</b> <span class="x">claim</span>')
    expect(text).toBe('a bold claim')
  })

  it('survives a tag the model never closed', () => {
    // An unclosed tag emphasises the rest of the block, which is what it asked
    // for and the least surprising reading of a mistake. It must never leave a
    // tag in the text.
    const { text, emphasis } = parseInlineMarkup('plain <i>and then italic to the end')
    expect(text).toBe('plain and then italic to the end')
    expect(emphasis).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('survives a closing tag that was never opened', () => {
    const { text } = parseInlineMarkup('stray </em> tag')
    expect(text).toBe('stray  tag')
  })

  it('allocates nothing for the text that has no markup at all', () => {
    const plain = 'The alembick being set upon a gentle fire.'
    expect(parseInlineMarkup(plain).text).toBe(plain)
    expect(parseInlineMarkup(plain).emphasis).toEqual([])
  })

  it('converts on the way out of the model', () => {
    const page = parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'paragraph', text: 'a <i>foreign</i> phrase' }],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(page.blocks[0]!.text).toBe('a foreign phrase')
    expect(page.blocks[0]!.emphasis).toEqual([1])
  })

  it('heals a block that was stored before any of this existed', () => {
    // The point of `normalizeMarkup`: pages already paid for are fixed on the
    // way back in, so nobody buys the same book twice to stop it printing tags.
    const healed = normalizeMarkup<TranscribedBlock>({
      kind: 'paragraph',
      text: 'a <i>foreign</i> phrase'
    })
    expect(healed.text).toBe('a foreign phrase')
    expect(healed.emphasis).toEqual([1])
  })
})

describe('emphasis survives the journey to the page', () => {
  const block = (text: string, emphasis?: number[]): BookBlock => ({
    id: `b${text.length}`,
    kind: 'paragraph',
    text,
    sourcePages: [0],
    ...(emphasis ? { emphasis } : {})
  })

  it('sets the emphasised words in italic and leaves the rest roman', () => {
    const book = run(doc([block('nothing of a practical nature how to project it', [5, 6, 7, 8])]))
    expect(runsSaying(book, 'how')[0]!.font.style).toBe('italic')
    expect(runsSaying(book, 'project')[0]!.font.style).toBe('italic')
    expect(runsSaying(book, 'practical')[0]!.font.style).toBe('regular')
  })

  it('measures the italic words in italic, or the line breaks in the wrong place', () => {
    // The breaker has to know: italic advances differ from roman, and a
    // paragraph measured in roman then drawn partly in italic sets its lines
    // to the wrong width.
    const wide = fixedWidthMeasurer(0.5)
    const narrow = {
      ...wide,
      widthOf: (t: string, f: { style: string }, s: number) =>
        wide.widthOf(t, f as never, s) * (f.style === 'italic' ? 3 : 1)
    }
    const document = doc([block('word '.repeat(60).trim(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
    const roman = layout(document, defaultStyleProfile(), wide, {
      edition: { title: 'T', author: 'A' }
    })
    const mixed = layout(document, defaultStyleProfile(), narrow as never, {
      edition: { title: 'T', author: 'A' }
    })
    const count = (b: LaidOutBook): number => b.pages.reduce((n, p) => n + lines(p).length, 0)
    expect(count(mixed)).not.toBe(count(roman))
  })

  it('moves the italics along when a paragraph is joined across a page seam', () => {
    // Emphasis is word indices, so the second half's italics have to shift by
    // the first half's word count or they land on the wrong words.
    // Through the real parser, because that is where the tags become emphasis:
    // assembly is handed transcriptions that have already been through it.
    const built = assembleBook([
      parsePageTranscription(
        {
          role: 'body',
          blocks: [{ kind: 'paragraph', text: 'the first four words here', continuesNext: true }],
          uncertain: [],
          furniture: {}
        },
        0
      ),
      parsePageTranscription(
        {
          role: 'body',
          blocks: [{ kind: 'paragraph', text: 'and <i>then</i> more', continuesPrevious: true }],
          uncertain: [],
          furniture: {}
        },
        1
      )
    ])
    expect(built.blocks).toHaveLength(1)
    const joined = built.blocks[0]!
    const words = joined.text.split(/\s+/u)
    expect(joined.emphasis?.map((i) => words[i])).toEqual(['then'])
  })

  it('forgets the emphasis when the user retypes the text', () => {
    // The indices point into the old wording; keeping them would italicise
    // whichever words now happen to sit at those positions.
    const before = doc([block('one two three four', [3])])
    const after = applyEdits(before, [{ kind: 'text', blockId: before.blocks[0]!.id, text: 'a b' }])
    expect(after.blocks[0]!.emphasis).toBeUndefined()
  })

  it('reads a tag the user types by hand in the proof editor', () => {
    const before = doc([block('one two three')])
    const after = applyEdits(before, [
      { kind: 'text', blockId: before.blocks[0]!.id, text: 'one <i>two</i> three' }
    ])
    expect(after.blocks[0]!.text).toBe('one two three')
    expect(after.blocks[0]!.emphasis).toEqual([1])
  })
})

describe('withMarkup — showing the emphasis where it can be edited', () => {
  const round = (raw: string) => {
    const parsed = parseInlineMarkup(raw)
    return withMarkup(parsed.text, parsed.emphasis)
  }

  it('puts the tags back where they were', () => {
    expect(round('a priest called <i>hpho-bo</i> in the original')).toBe(
      'a priest called <i>hpho-bo</i> in the original'
    )
  })

  it('takes the punctuation with the word, and then stops moving', () => {
    // Emphasis is word-granular by design (see the module note), so a tag that
    // ended before a bracket comes back with the bracket inside it. What has to
    // hold is that it settles: showing what was shown parses to the same thing,
    // or a paragraph would creep every time the proof step was opened.
    const once = round('(pron. <i>pho-o</i>)')
    expect(once).toBe('(pron. <i>pho-o)</i>')
    expect(round(once)).toBe(once)
  })

  it('wraps a phrase once rather than tagging each of its words', () => {
    expect(withMarkup('how to project the astral body', [2, 3, 4, 5])).toBe(
      'how to <i>project the astral body</i>'
    )
  })

  it('leaves an unemphasised block completely alone', () => {
    expect(withMarkup('nothing stressed here', [])).toBe('nothing stressed here')
    expect(withMarkup('nothing stressed here', undefined)).toBe('nothing stressed here')
  })

  it('handles emphasis at either end of the block', () => {
    expect(withMarkup('first word only', [0])).toBe('<i>first</i> word only')
    expect(withMarkup('and the last', [2])).toBe('and the <i>last</i>')
    expect(withMarkup('every single word', [0, 1, 2])).toBe('<i>every single word</i>')
  })

  it('survives the round trip both ways', () => {
    // This is what makes the editor safe: what it shows parses back to what it
    // was shown from, so correcting one word cannot move or lose the italics.
    for (const raw of [
      'plain text',
      '<i>all of it</i>',
      'a <i>b</i> c <i>d e</i> f',
      'trailing <i>emphasis</i>'
    ]) {
      expect(round(raw)).toBe(raw)
    }
  })

  it('is idempotent on anything at all, punctuation included', () => {
    for (const raw of ['<i>a,</i> b.', 'x <i>y</i>; z', '“<i>quoted</i>”', 'a <i>b</i>-c']) {
      expect(round(round(raw))).toBe(round(raw))
    }
  })

  it('normalises what the model wrote into what the editor shows', () => {
    // The model reaches for <em> and <cite> as well; both mean italic, and the
    // editor should show one notation rather than three.
    expect(round('an <em>emphasised</em> and a <cite>cited</cite> word')).toBe(
      'an <i>emphasised</i> and a <i>cited</i> word'
    )
  })

  it('round-trips through an edit, which is how the proof editor keeps it', () => {
    const shown = withMarkup('the Lama superintends the withdrawal', [1])
    expect(shown).toBe('the <i>Lama</i> superintends the withdrawal')
    // The user fixes a different word; the emphasis is unharmed because it was
    // never separate from the text they were handed.
    const edited = shown.replace('withdrawal', 'withdrawing')
    const back = parseInlineMarkup(edited)
    expect(back.text).toBe('the Lama superintends the withdrawing')
    expect(back.emphasis).toEqual([1])
  })
})

describe('the small helpers', () => {
  it('counts words the way the line breaker splits them', () => {
    expect(wordCount('  two  words ')).toBe(2)
    expect(wordCount('')).toBe(0)
  })

  it('shifts indices without reordering them', () => {
    expect(shiftEmphasis([0, 2], 5)).toEqual([5, 7])
  })
})

/**
 * `<b>` was transparent — content kept, tag dropped — for as long as nothing
 * downstream could set a bold run. A glossary with 126 headwords is what made
 * it worth having: without it every headword read as body text and the page was
 * a wall.
 */
describe('strong runs', () => {
  it('reads <b> into word indices, like <i>', () => {
    const m = parseInlineMarkup('<b>Aerolite.</b> A stony meteorite.')
    expect(m.text).toBe('Aerolite. A stony meteorite.')
    expect(m.strong).toEqual([0])
    expect(m.emphasis).toEqual([])
  })

  it('reads <strong> the same way', () => {
    expect(parseInlineMarkup('a <strong>very loud</strong> word').strong).toEqual([1, 2])
  })

  it('keeps the two kinds apart in one block', () => {
    const m = parseInlineMarkup('<b>Blavatsky.</b> She wrote <i>Isis Unveiled</i> in 1877.')
    expect(m.text).toBe('Blavatsky. She wrote Isis Unveiled in 1877.')
    expect(m.strong).toEqual([0])
    expect(m.emphasis).toEqual([3, 4])
  })

  it('lets a word be both', () => {
    const m = parseInlineMarkup('<b><i>Isis Unveiled.</i></b> Her first book.')
    expect(m.strong).toEqual([0, 1])
    expect(m.emphasis).toEqual([0, 1])
  })

  it('writes both tags back, nested rather than crossed', () => {
    const round = withMarkup('Blavatsky. She wrote Isis Unveiled in 1877.', [3, 4], [0])
    expect(round).toBe('<b>Blavatsky.</b> She wrote <i>Isis Unveiled</i> in 1877.')
    expect(parseInlineMarkup(round).strong).toEqual([0])
    expect(parseInlineMarkup(round).emphasis).toEqual([3, 4])
  })

  it('round-trips a word that is both', () => {
    const round = withMarkup('Isis Unveiled. Her first book.', [0, 1], [0, 1])
    expect(round).toBe('<b><i>Isis Unveiled.</i></b> Her first book.')
    const back = parseInlineMarkup(round)
    expect(back.text).toBe('Isis Unveiled. Her first book.')
    expect(back.strong).toEqual([0, 1])
    expect(back.emphasis).toEqual([0, 1])
  })

  it('leaves unmarked text alone', () => {
    expect(withMarkup('plain words', undefined, undefined)).toBe('plain words')
    expect(withMarkup('plain words', [], [])).toBe('plain words')
  })
})
