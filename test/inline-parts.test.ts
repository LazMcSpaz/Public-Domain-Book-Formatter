/**
 * Italic, bold and small capitals over part of a word.
 *
 * The case that made this necessary is on leaf 13 of Barker's Introduction to
 * _The Mahatma Letters_: the page sets `<i>un</i>spiritual`, the prefix and
 * nothing else, and a markup reader working in whole words printed the whole
 * word in italic. The editor's ruling was that the engine must set what the
 * page sets. So the chain is tested link by link — the reader, the writer, the
 * transforms that carry a part across a seam or an edit, the line breaker,
 * the page — and every test here fails with the part taken out of its link.
 */
import { describe, it, expect } from 'vitest'
import {
  joinStyling,
  normalizeMarkup,
  normalizeTable,
  parseInlineMarkup,
  parsePageTranscription,
  settleParts,
  spliceRunInto,
  withMarkup,
  type InlinePart,
  type PageTranscription,
  type TranscribedBlock
} from '@core/transcribe'
import { htmlOfMarkup, markupOfNodes, type RichNode } from '@core/edits/rich-text'
import { applyEdits, findMatches, sweepText } from '@core/edits'
import { assembleBook, type BookBlock, type BookDocument } from '@core/assemble'
import {
  breakParagraph,
  hangPunctuation,
  layout,
  type FontRef,
  type LaidOutBook,
  type PositionedLine,
  type TextMeasurer,
  type TextRun,
  type TextSpan
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { CURRENT_SCHEMA_VERSION, migrateSavedRun } from '@core/project'

const part = (word: number, from: number, to: number, style: InlinePart['style'] = 'italic') => ({
  word,
  from,
  to,
  style
})

describe('the reader: a tag among a word’s letters is a part', () => {
  it('reads <i>un</i>spiritual as the prefix in italic, and no italic word', () => {
    const m = parseInlineMarkup('<i>un</i>spiritual')
    expect(m.text).toBe('unspiritual')
    expect(m.emphasis).toEqual([])
    expect(m.parts).toEqual([part(0, 0, 2)])
  })

  it('reads a run in the middle of a word', () => {
    const m = parseInlineMarkup('it was un<i>doubted</i>ly so')
    expect(m.text).toBe('it was undoubtedly so')
    expect(m.emphasis).toEqual([])
    expect(m.parts).toEqual([part(2, 2, 9)])
  })

  it('keeps a whole word whole where the tag covers every letter of it', () => {
    // The cases the module note names, and the reason the rule is about
    // letters and not characters: punctuation outside a tag is not a split.
    expect(parseInlineMarkup('(pron. <i>pho-o</i>)')).toEqual({
      text: '(pron. pho-o)',
      emphasis: [1],
      strong: [],
      smallCaps: []
    })
    const presence = parseInlineMarkup('the “<i>Presence.</i>”¹ of it')
    expect(presence.emphasis).toEqual([1])
    expect(presence.parts).toBeUndefined()
  })

  it('reads a tag over punctuation alone as the whole word, as it always did', () => {
    const m = parseInlineMarkup('<i>(</i>word) here')
    expect(m.emphasis).toEqual([0])
    expect(m.parts).toBeUndefined()
  })

  it('reads bold and small capitals over part of a word the same way', () => {
    expect(parseInlineMarkup('<b>Theo</b>sophy').parts).toEqual([part(0, 0, 4, 'strong')])
    expect(parseInlineMarkup('un<sc>spirit</sc>ual').parts).toEqual([part(0, 2, 8, 'smallCaps')])
  })

  it('keeps two runs on one word apart', () => {
    expect(parseInlineMarkup('<i>un</i>spir<i>it</i>ual').parts).toEqual([
      part(0, 0, 2),
      part(0, 6, 8)
    ])
  })

  it('takes parts named outright in a batch, and drops ones that name no word', () => {
    const page = parsePageTranscription(
      {
        role: 'body',
        blocks: [
          {
            kind: 'paragraph',
            text: 'an unspiritual man',
            parts: [part(1, 0, 2), part(9, 0, 1), { word: 1, from: 'x', to: 2, style: 'italic' }]
          }
        ],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(page.blocks[0]!.parts).toEqual([part(1, 0, 2)])
  })
})

describe('the writer: a part goes back as the tags it came from', () => {
  const cases = [
    'an <i>un</i>spiritual man',
    'it was un<i>doubted</i>ly so',
    '<b>Theo</b><i>soph</i>y and <i>all of it</i>',
    'the <i>whole word</i> and the <i>un</i>spiritual <i>rest</i>',
    'un<sc>spirit</sc>ual'
  ]

  it('round-trips the notation through the reader', () => {
    for (const raw of cases) {
      const m = parseInlineMarkup(raw)
      expect(withMarkup(m.text, m.emphasis, m.strong, m.smallCaps, m.parts)).toBe(raw)
    }
  })

  it('reproduces the indices and the parts from what it writes', () => {
    const text = 'the unspiritual and undoubtedly whole'
    const emphasis = [4]
    const parts = [part(1, 0, 2), part(3, 2, 9, 'strong')]
    const back = parseInlineMarkup(withMarkup(text, emphasis, undefined, undefined, parts))
    expect(back.text).toBe(text)
    expect(back.emphasis).toEqual(emphasis)
    expect(back.parts).toEqual(parts)
  })

  it('shows a part in the editor’s HTML as it is in the notation, escaped', () => {
    expect(htmlOfMarkup('a <i>un</i>spiritual & <b>Theo</b>sophic man')).toBe(
      'a <i>un</i>spiritual &amp; <b>Theo</b>sophic man'
    )
  })

  it('takes a Ctrl+I over half a word back as a part', () => {
    const el = (name: string, ...children: RichNode[]): RichNode => ({
      nodeType: 1,
      nodeName: name,
      nodeValue: null,
      childNodes: children
    })
    const text = (value: string): RichNode => ({
      nodeType: 3,
      nodeName: '#text',
      nodeValue: value,
      childNodes: []
    })
    const raw = markupOfNodes([text('an '), el('I', text('un')), text('spiritual man')])
    expect(normalizeMarkup<TranscribedBlock>({ kind: 'paragraph', text: raw }).parts).toEqual([
      part(1, 0, 2)
    ])
  })
})

describe('settleParts — the reader’s rule after a change of text', () => {
  it('drops parts on words that are not there and clamps offsets to the word', () => {
    const settled = settleParts('an unspiritual', { parts: [part(5, 0, 2), part(1, 0, 2)] })
    expect(settled.parts).toEqual([part(1, 0, 2)])
    expect(settleParts('an unspiritual', { parts: [part(1, 9, 40)] }).parts).toEqual([
      part(1, 9, 11)
    ])
  })

  it('makes a part that covers every letter of its word the whole word', () => {
    const settled = settleParts('an un, man', { parts: [part(1, 0, 2)] })
    expect(settled.parts).toEqual([])
    expect(settled.emphasis).toEqual([1])
  })

  it('drops a part on a word that is wholly in its style already', () => {
    const settled = settleParts('an unspiritual', { emphasis: [1], parts: [part(1, 0, 2)] })
    expect(settled.parts).toEqual([])
    expect(settled.emphasis).toEqual([1])
  })
})

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

/** A block as `parsePageTranscription` would leave it, from the notation. */
const read = (kind: TranscribedBlock['kind'], raw: string, extra: Partial<TranscribedBlock> = {}) =>
  normalizeMarkup<TranscribedBlock>({ kind, text: raw, ...extra })

const notation = (b: {
  text: string
  emphasis?: number[]
  strong?: number[]
  smallCaps?: number[]
  parts?: InlinePart[]
}): string => withMarkup(b.text, b.emphasis, b.strong, b.smallCaps, b.parts)

describe('assembly carries a part across a seam', () => {
  it('moves a part on the next leaf along by the words before it', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'He thought the writer was', { continuesNext: true })]),
      page(1, [read('paragraph', 'in every way <i>un</i>spiritual, and said so.')])
    ])
    expect(doc.blocks).toHaveLength(1)
    expect(notation(doc.blocks[0]!)).toBe(
      'He thought the writer was in every way <i>un</i>spiritual, and said so.'
    )
  })

  it('puts a part on the far side of a healed hyphen onto the healed word', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'a thoroughly un-', { continuesNext: true })]),
      page(1, [read('paragraph', '<i>spir</i>itual man')])
    ])
    expect(doc.blocks[0]!.text).toBe('a thoroughly unspiritual man')
    // "un" is two letters, so the italic `spir` starts two along.
    expect(doc.blocks[0]!.parts).toEqual([part(2, 2, 6)])
  })

  it('keeps a part on the near side of a healed hyphen where it was', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'a thoroughly <i>un</i>spir-', { continuesNext: true })]),
      page(1, [read('paragraph', 'itual man')])
    ])
    expect(notation(doc.blocks[0]!)).toBe('a thoroughly <i>un</i>spiritual man')
  })

  it('drops a part the union has made redundant on a healed word', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'a thoroughly <i>un-</i>', { continuesNext: true })]),
      page(1, [read('paragraph', '<i>spir</i>itual man')])
    ])
    expect(doc.blocks[0]!.emphasis).toEqual([2])
    expect(doc.blocks[0]!.parts).toBeUndefined()
  })

  it('moves a part back past a soft hyphen taken out of its word', () => {
    const doc = assembleBook([page(0, [read('paragraph', 'an un­spi<i>ritual</i> man')])])
    expect(doc.blocks[0]!.text).toBe('an unspiritual man')
    expect(notation(doc.blocks[0]!)).toBe('an unspi<i>ritual</i> man')
  })

  it('carries a part through a footnote’s marker taken off its first word', () => {
    // The marker printed hard against the word: taking it off moves the
    // word's letters, not the word, so a part counted in words would land two
    // letters late.
    const doc = assembleBook([
      page(0, [
        read('paragraph', 'The text*'),
        read('footnote', '1.<i>Un</i>spiritual, said he.', { marker: '1' })
      ])
    ])
    const note = doc.footnotes[0]!
    expect(note.text).toBe('Unspiritual, said he.')
    expect(note.parts).toEqual([part(0, 0, 2)])
  })

  it('carries a part into a note’s runover', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'The text*'), read('footnote', '* See the')]),
      page(1, [read('footnote', 'quite <i>un</i>spiritual view.')])
    ])
    expect(doc.footnotes).toHaveLength(1)
    expect(notation(doc.footnotes[0]!)).toBe('See the quite <i>un</i>spiritual view.')
  })

  it('joins styling the way assembly does, whole words by union', () => {
    const joined = joinStyling(
      'the un-',
      { emphasis: [1] },
      'spiritual man',
      { strong: [1], parts: [part(0, 0, 4, 'strong')] },
      'the unspiritual man'
    )
    expect(joined.emphasis).toEqual([1])
    expect(joined.strong).toEqual([2])
    expect(joined.parts).toEqual([part(1, 2, 6, 'strong')])
  })
})

const docOf = (blocks: TranscribedBlock[]): BookDocument => assembleBook([page(0, blocks)])

describe('applyEdits carries a part through a correction', () => {
  it('reads a part out of a corrected text', () => {
    const doc = applyEdits(docOf([read('paragraph', 'an unspiritual man')]), [
      { kind: 'text', blockId: 'p0b0', text: 'an <i>un</i>spiritual man' }
    ])
    expect(doc.blocks[0]!.parts).toEqual([part(1, 0, 2)])
  })

  it('does not keep an old part on a retyped text', () => {
    const doc = applyEdits(docOf([read('paragraph', 'an <i>un</i>spiritual man')]), [
      { kind: 'text', blockId: 'p0b0', text: 'a spiritual woman' }
    ])
    expect(doc.blocks[0]!.parts).toBeUndefined()
  })

  it('keeps a part through a retype', () => {
    const doc = applyEdits(docOf([read('paragraph', 'an <i>un</i>spiritual man')]), [
      { kind: 'retype', blockId: 'p0b0', blockKind: 'blockquote' }
    ])
    expect(doc.blocks[0]!.parts).toEqual([part(1, 0, 2)])
  })

  it('carries a part into the second half of a split', () => {
    const doc = applyEdits(
      docOf([read('paragraph', 'He said. The <i>un</i>spiritual man left.')]),
      [{ kind: 'split', blockId: 'p0b0', at: 'He said. '.length }]
    )
    expect(doc.blocks.map(notation)).toEqual(['He said.', 'The <i>un</i>spiritual man left.'])
  })

  it('cuts a part with a split through the middle of its word', () => {
    // Split between `un` and `spiritual`: the italic `un` is now the whole of
    // the first half's last word, and nothing of it reaches the second.
    const doc = applyEdits(docOf([read('paragraph', 'an <i>un</i>spiritual man')]), [
      { kind: 'split', blockId: 'p0b0', at: 'an un'.length }
    ])
    expect(doc.blocks.map(notation)).toEqual(['an <i>un</i>', 'spiritual man'])
    expect(doc.blocks[0]!.emphasis).toEqual([1])
    expect(doc.blocks[1]!.emphasis).toBeUndefined()
  })

  it('splits a part a split falls inside of between the two ends of its word', () => {
    const doc = applyEdits(docOf([read('paragraph', 'an <i>unspir</i>itual man')]), [
      { kind: 'split', blockId: 'p0b0', at: 'an un'.length }
    ])
    expect(doc.blocks.map(notation)).toEqual(['an <i>un</i>', '<i>spir</i>itual man'])
  })

  it('counts the second half of a mid-word split from the word it cut', () => {
    // A whole-word run after a split inside a word used to land one word
    // early: `dd` is word 1 of the second half, not word 0.
    const doc = applyEdits(docOf([read('paragraph', 'aa bbcc <i>dd</i>')]), [
      { kind: 'split', blockId: 'p0b0', at: 'aa bb'.length }
    ])
    expect(doc.blocks.map(notation)).toEqual(['aa bb', 'cc <i>dd</i>'])
  })

  it('carries a part across a merge', () => {
    const doc = applyEdits(
      docOf([read('paragraph', 'The first.'), read('paragraph', 'An <i>un</i>spiritual man.')]),
      [{ kind: 'merge', blockId: 'p0b0' }]
    )
    expect(doc.blocks.map(notation)).toEqual(['The first. An <i>un</i>spiritual man.'])
  })

  it('reads a part out of a corrected note', () => {
    const doc = applyEdits(docOf([read('paragraph', 'The text*'), read('footnote', '* See it.')]), [
      { kind: 'note-text', noteId: 'fn1', text: 'An <i>un</i>spiritual view.' }
    ])
    expect(doc.footnotes[0]!.parts).toEqual([part(1, 0, 2)])
  })
})

describe('a part where only whole words are set', () => {
  it('folds a part in a table cell into its word, as every tag was before', () => {
    const table = normalizeTable<TranscribedBlock>({
      kind: 'table',
      text: '',
      cells: [['a', '<i>un</i>spiritual man']]
    })
    expect(table.parts).toBeUndefined()
    // Flattened `a | unspiritual man`: the separator is word 1.
    expect(table.emphasis).toEqual([2])
  })

  it('folds a part a table was handed with its cells clean', () => {
    // The flattened text read with a tag in it gives the block a part; the
    // cells carry none, and the part still has to end up a whole word.
    const table = normalizeTable<TranscribedBlock>({
      kind: 'table',
      text: 'a | unspiritual man',
      cells: [['a', 'unspiritual man']],
      parts: [part(2, 0, 2)]
    })
    expect(table.parts).toBeUndefined()
    expect(table.emphasis).toEqual([2])
  })
})

describe('a recovered passage spliced into a block moves its parts', () => {
  it('shifts a part past the words put back', () => {
    const fixed = spliceRunInto(
      'He was unspiritual.',
      [],
      { text: 'by every measure', after: 'He was', before: '', strength: 'strong' } as never,
      [],
      [],
      [part(2, 0, 2)]
    )
    expect(fixed?.text).toBe('He was by every measure unspiritual.')
    expect(fixed?.parts).toEqual([part(5, 0, 2)])
  })
})

describe('a stored record', () => {
  const run = (blocks: TranscribedBlock[]) => ({
    schemaVersion: CURRENT_SCHEMA_VERSION - 1,
    key: 'k',
    fileName: 'f.pdf',
    savedAt: '2026-01-01T00:00:00.000Z',
    pageCount: 1,
    transcriptions: [page(0, blocks)],
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    modelId: 'm',
    identityAnswers: {}
  })

  it('makes a stored block’s parts sound, and leaves a block with none alone', () => {
    const plain: TranscribedBlock = { kind: 'paragraph', text: 'a plain block', emphasis: [1] }
    const restored = migrateSavedRun(
      run([
        plain,
        {
          kind: 'paragraph',
          text: 'an unspiritual man',
          parts: [part(1, 0, 2), part(7, 0, 1), { word: 1 } as never, part(2, 0, 3)]
        }
      ])
    )
    const [kept, settled] = restored.transcriptions[0]!.blocks
    expect(kept).toEqual(plain)
    expect(settled!.parts).toEqual([part(1, 0, 2)])
    // A part covering all of `man` is the word.
    expect(settled!.emphasis).toEqual([2])
  })
})

describe('a sweep leaves a part where the change is not', () => {
  it('fixes a letter of a word without taking the italic off its prefix', () => {
    expect(sweepText('an <i>un</i>spirtual man', 'unspirtual', 'unspiritual').text).toBe(
      'an <i>un</i>spiritual man'
    )
  })

  it('finds a word that is partly in small capitals', () => {
    expect(findMatches('an un<sc>spirit</sc>ual man', 'unspiritual')).toHaveLength(1)
  })
})

// ─── The engine ────────────────────────────────────────────────────────────

const REGULAR: FontRef = { family: 'Test', style: 'regular' }
const ITALIC: FontRef = { family: 'Test', style: 'italic' }

/**
 * A measurer whose faces are different widths — roman 0.5 em, italic 0.6, bold
 * 0.7 — so that measuring a stretch in the wrong face moves something.
 * `fixedWidthMeasurer` gives every face one width and could not tell.
 */
const faced: TextMeasurer = {
  widthOf: (text, font, sizePt) =>
    [...text].length * sizePt * (font.style === 'italic' ? 0.6 : font.style === 'bold' ? 0.7 : 0.5),
  metrics: (_font, sizePt) => ({ ascent: sizePt * 0.75, descent: sizePt * 0.25, lineGap: 0 }),
  hasSmallCaps: () => false,
  hasBold: () => true
}

const italicPart = (word: number, from: number, to: number): TextSpan => ({
  words: new Set(),
  font: ITALIC,
  parts: new Map([[word, [[from, to] as const]]])
})

describe('the line breaker sets a word in two faces', () => {
  it('places `un` in italic and `spiritual` in roman, hard against each other', () => {
    const lines = breakParagraph('an unspiritual man', {
      font: REGULAR,
      sizePt: 10,
      measurer: faced,
      lineWidths: 500,
      alignment: 'left',
      spans: [italicPart(1, 0, 2)]
    })
    expect(lines).toHaveLength(1)
    const words = lines[0]!.words
    expect(words.map((w) => w.text)).toEqual(['an', 'un', 'spiritual', 'man'])
    const un = words[1]!
    const rest = words[2]!
    expect(un.font).toEqual(ITALIC)
    expect(rest.font).toEqual(REGULAR)
    // `un` measured in italic: 2 × 10 × 0.6. No interword space follows it.
    expect(rest.xPt).toBeCloseTo(un.xPt + 12, 6)
    // And the word as a whole is the two stretches' widths, so the line is
    // as long as they are: `an` 10, a space 5, `un` 12, `spiritual` 45.
    expect(words[3]!.xPt).toBeCloseTo(10 + 5 + 12 + 45 + 5, 6)
  })

  it('keeps each piece of a word broken by hyphenation in its own faces', () => {
    // `unsp` in italic, the rest roman, broken after `spir`: the line ends
    // `unsp` italic hard against `ir-` roman, and the next starts `itual`.
    const lines = breakParagraph('aaaa unspiritual', {
      font: REGULAR,
      sizePt: 10,
      measurer: faced,
      lineWidths: 66,
      alignment: 'justify',
      hyphenate: (w) => (w === 'unspiritual' ? ['un', 'spir', 'i', 'tual'] : [w]),
      spans: [italicPart(1, 0, 4)]
    })
    expect(lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ['aaaa', 'unsp', 'ir-'],
      ['itual']
    ])
    const [, unsp, ir] = lines[0]!.words
    expect(unsp!.font).toEqual(ITALIC)
    expect(ir!.font).toEqual(REGULAR)
    expect(ir!.xPt).toBeCloseTo(unsp!.xPt + 4 * 6, 6)
    expect(lines[1]!.words[0]!.font).toEqual(REGULAR)
  })

  it('breaks only where the hyphenator says, never where the face changes', () => {
    // Too narrow for the word, and no hyphenation: it stays one unbroken
    // word overfull rather than breaking between `un` and `spiritual`.
    const lines = breakParagraph('unspiritual', {
      font: REGULAR,
      sizePt: 10,
      measurer: faced,
      lineWidths: 20,
      alignment: 'left',
      spans: [italicPart(0, 0, 2)]
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]!.words.map((w) => w.text)).toEqual(['un', 'spiritual'])
  })

  it('does not break between the faces even where the line would fit exactly', () => {
    // `aaaa un` is exactly the measure — 20, a space of 5, `un` 12 in italic —
    // so a break where the face changes would make a perfect line. It is not
    // a place a word may break, so the word stays whole and the line runs over.
    const lines = breakParagraph('aaaa unspiritual', {
      font: REGULAR,
      sizePt: 10,
      measurer: faced,
      lineWidths: 37,
      alignment: 'justify',
      spans: [italicPart(1, 0, 2)]
    })
    expect(lines.map((l) => l.words.map((w) => w.text))).toEqual([['aaaa', 'un', 'spiritual']])
  })
})

/** A book of the given blocks, laid out with `faced`. */
function laid(
  blocks: BookBlock[],
  over: Partial<ReturnType<typeof defaultStyleProfile>> = {},
  footnotes: BookDocument['footnotes'] = [],
  illustrations: BookDocument['illustrations'] = [],
  options: { orphanNotes?: 'omit' | 'collect' } = {}
): LaidOutBook {
  return layout(
    {
      blocks,
      footnotes,
      chapters: [],
      asides: [],
      illustrations,
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    },
    { ...defaultStyleProfile(), bodyFont: 'Test', headingFont: 'Test', dropCap: false, ...over },
    faced,
    { edition: { title: 'Letters', author: 'A. P. Sinnett' }, ...options }
  )
}

const bodyLines = (book: LaidOutBook): PositionedLine[] =>
  book.pages.flatMap((p) => p.items.filter((i): i is PositionedLine => i.kind === 'line'))

/** The runs of the first line that has a run saying `text`. */
function lineWith(book: LaidOutBook, text: string): TextRun[] {
  const line = bodyLines(book).find((l) => l.runs.some((r) => r.text === text))
  expect(line, `a line with a run "${text}"`).toBeDefined()
  return line!.runs
}

const block = (raw: string, kind: BookBlock['kind'] = 'paragraph'): BookBlock => ({
  ...read(kind, raw),
  id: 'p0b0',
  sourcePages: [0]
})

describe('the page sets the word in two faces', () => {
  it('draws `un` in the italic face and `spiritual` in roman, with no gap', () => {
    const runs = lineWith(laid([block('The writer is <i>un</i>spiritual in all.')]), 'un')
    const un = runs.find((r) => r.text === 'un')!
    const rest = runs[runs.indexOf(un) + 1]!
    expect(rest.text).toBe('spiritual')
    expect(un.font).toEqual({ family: 'Test', style: 'italic' })
    expect(rest.font).toEqual({ family: 'Test', style: 'regular' })
    expect(rest.xPt - un.xPt).toBeCloseTo(faced.widthOf('un', un.font, un.sizePt), 3)
  })

  it('keeps the stretches of one word together when punctuation hangs', () => {
    // An opening quotation mark hangs into the left margin, and the shift is
    // shared out along the line. Shared between *runs*, the `“`, the `un` and
    // the `spiritual` of one word moved by different amounts and opened gaps.
    const runs = lineWith(
      laid([block('“<i>un</i>spiritual” and more words besides')], { opticalMargins: true }),
      'un'
    )
    const at = runs.findIndex((r) => r.text === 'un')
    const [quote, un, rest] = [runs[at - 1]!, runs[at]!, runs[at + 1]!]
    expect(quote.text).toBe('“')
    expect(rest.text).toBe('spiritual”')
    expect(un.xPt - quote.xPt).toBeCloseTo(faced.widthOf('“', quote.font, quote.sizePt), 3)
    expect(rest.xPt - un.xPt).toBeCloseTo(faced.widthOf('un', un.font, un.sizePt), 3)
  })

  it('sets a bold part in the bold face', () => {
    const runs = lineWith(laid([block('<b>Theo</b>sophy is a word.')]), 'Theo')
    expect(runs.find((r) => r.text === 'Theo')!.font.style).toBe('bold')
    expect(runs.find((r) => r.text === 'sophy')!.font.style).toBe('regular')
  })

  it('sets a part of a word in small capitals as capitals where no face has them', () => {
    // `faced` has no small capitals, so the letters marked print as capitals
    // and only those: the rest of the word is as written.
    const book = laid([block('the un<sc>spirit</sc>ual man')])
    expect(lineWith(book, 'unSPIRITual')).toBeDefined()
  })

  it('sets a part in a footnote', () => {
    const doc = assembleBook([
      page(0, [read('paragraph', 'The text*'), read('footnote', '* An <i>un</i>spiritual view.')])
    ])
    const runs = lineWith(laid(doc.blocks, {}, doc.footnotes), 'un')
    expect(runs.find((r) => r.text === 'un')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'spiritual')!.font.style).toBe('regular')
  })

  it('sets a part in a line of verse', () => {
    // The second line's words are counted from its own first word, and its
    // part with them.
    const verse = laid([block('The first line,\nan <i>un</i>spiritual second.', 'verse')])
    expect(lineWith(verse, 'un').find((r) => r.text === 'un')!.font.style).toBe('italic')
  })

  it('sets a part on either side of a figure drawn mid-sentence', () => {
    const host = 'The <i>un</i>spiritual by the symbol which <i>un</i>does three things.'
    const read0 = read('paragraph', host)
    const hostBlock: BookBlock = { ...read0, id: 'p0b1', sourcePages: [0] }
    const book = layout(
      {
        blocks: [{ ...block('Before it.'), id: 'p0b0' }, hostBlock],
        footnotes: [],
        chapters: [],
        asides: [],
        illustrations: [
          {
            id: 'fig1',
            pageIndex: -1,
            sourceWidth: 300,
            sourceHeight: 300,
            caption: null,
            anchorAfterBlockId: 'p0b1',
            origin: 'supplied',
            placement: { kind: 'within', widthIn: 0.5, at: read0.text.indexOf('which') }
          }
        ],
        sections: [],
        skipped: [],
        synopsesUnmatched: []
      },
      { ...defaultStyleProfile(), bodyFont: 'Test', headingFont: 'Test', dropCap: false },
      faced,
      { edition: { title: 'Letters', author: 'A. P. Sinnett' } }
    )
    const runs = bodyLines(book).flatMap((l) => l.runs)
    // One before the figure, one after it, each in italic and each hard
    // against the roman rest of its word.
    expect(runs.filter((r) => r.text === 'un').map((r) => r.font.style)).toEqual([
      'italic',
      'italic'
    ])
    expect(runs.find((r) => r.text === 'does')!.font.style).toBe('regular')
  })

  it('sets a part in a figure’s key', () => {
    const doc = assembleBook([page(0, [read('paragraph', 'The diagram follows.')])], {
      illustrations: [{ id: 'i1', pageIndex: 0, sourceWidth: 1200, sourceHeight: 400 }]
    })
    doc.illustrations[0]!.caption = '* The <i>un</i>spiritual world.\n† The archetypal world.'
    const runs = lineWith(laid(doc.blocks, {}, [], doc.illustrations), 'un')
    expect(runs.find((r) => r.text === 'un')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'spiritual')!.font.style).toBe('regular')
  })

  it('sets a part in a note collected at the back for want of a mark', () => {
    const doc = assembleBook([
      page(0, [
        read('paragraph', 'The text has no mark.'),
        read('footnote', '§ An <i>un</i>spiritual view.')
      ])
    ])
    const book = laid(doc.blocks, {}, doc.footnotes, [], { orphanNotes: 'collect' })
    // Set after its printed marker, so every word moved along by one.
    const runs = lineWith(book, 'un')
    expect(runs.find((r) => r.text === 'un')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'An')!.font.style).toBe('regular')
  })

  it('sets a part in a list item whose number is stored apart from its words', () => {
    const item: BookBlock = { ...block('an <i>un</i>spiritual item', 'list-item'), marker: '1.' }
    const runs = lineWith(laid([item]), 'un')
    expect(runs.find((r) => r.text === 'un')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'an')!.font.style).toBe('regular')
  })

  it('sets a part in a heading printed in capitals', () => {
    // No small capitals in this face, so the heading is set in capitals —
    // and the part is carried through the casing onto the same letters.
    const heading: BookBlock = { ...block('Of <i>un</i>spiritual matters', 'heading'), level: 2 }
    const runs = lineWith(laid([heading]), 'UN')
    expect(runs.find((r) => r.text === 'UN')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'SPIRITUAL')!.font.style).toBe('regular')
  })

  it('carries a part through a capital that is two letters', () => {
    // `ß` is `SS` in capitals, so every letter after it moves one along, and a
    // part counted in the old letters would set `SARTI` in italic.
    const heading: BookBlock = { ...block('Ein groß<i>artig</i>es Werk', 'heading'), level: 2 }
    const runs = lineWith(laid([heading]), 'ARTIG')
    expect(runs.map((r) => `${r.text}/${r.font.style}`)).toEqual([
      'EIN/regular',
      'GROSS/regular',
      'ARTIG/italic',
      'ES/regular',
      'WERK/regular'
    ])
  })

  it('sets a part that has come to cover the whole of its word', () => {
    // `1` is a digit, so the italic over `Presence.` alone is a part — and
    // once the mark is lifted off for the footnote, it covers all that is
    // left of the word, which must still be set in italic.
    const doc = assembleBook([
      page(0, [
        read('paragraph', 'the <i>Presence.</i>1 here'),
        read('footnote', 'A note.', { marker: '1' })
      ])
    ])
    const runs = lineWith(laid(doc.blocks, {}, doc.footnotes), 'Presence.')
    expect(runs.find((r) => r.text === 'Presence.')!.font.style).toBe('italic')
  })
})

describe('optical margins share a hang between words, not between stretches', () => {
  it('moves the stretches of one word by the same amount', () => {
    const run = (text: string, xPt: number): TextRun => ({ text, xPt, font: REGULAR, sizePt: 10 })
    const runs = [run('“un', 0), run('spiritual', 15), run('word', 70)]
    const hung = hangPunctuation(runs, faced, REGULAR, {
      flushRight: false,
      joined: [false, true, false]
    })
    expect(hung[1]!.xPt - hung[0]!.xPt).toBeCloseTo(15, 6)
  })
})
