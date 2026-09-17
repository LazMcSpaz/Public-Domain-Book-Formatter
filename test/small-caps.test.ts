import { describe, it, expect } from 'vitest'
import { parseInlineMarkup, withMarkup, parsePageTranscription } from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { applyEdits, htmlOfMarkup, markupOfNodes, sweepText, type RichNode } from '@core/edits'
import { layout, fixedWidthMeasurer, type TextMeasurer, type LaidOutBook } from '@core/layout'
import { defaultStyleProfile } from '@core/style'

/**
 * Small capitals as an inline mark.
 *
 * The one mark here whose meaning depends on the case of the text it covers: a
 * face's `smcp` replaces lower-case letters with small capitals and leaves
 * capitals alone, so `<sc>Hermetist</sc>` sets a full H over small ERMETIST —
 * caps and small caps, which is what an 1877 glossary headword is — while
 * `<sc>HERMETIST</sc>` correctly gets full capitals, there being no lower-case
 * letters in it to replace.
 */
describe('the small-capitals notation', () => {
  it('reads <sc> into word indices and leaves the words alone', () => {
    const parsed = parseInlineMarkup('<sc>Hermetist.</sc>—From Hermes, the god of Wisdom.')
    expect(parsed.text).toBe('Hermetist.—From Hermes, the god of Wisdom.')
    expect(parsed.smallCaps).toEqual([0])
    expect(parsed.emphasis).toEqual([])
  })

  it('takes <smallcaps> as the same tag', () => {
    expect(parseInlineMarkup('a <smallcaps>b c</smallcaps> d').smallCaps).toEqual([1, 2])
  })

  /**
   * Written back and read again, the marks are the same. Not byte-identical to
   * the input, and deliberately not asserted so: the marks are *word* indices,
   * so a tag that closed inside a word comes back around the whole of it —
   * `<i>1875</i>.` is written out as `<i>1875.</i>`. That is the convention
   * every mark here has used since emphasis was added, not something small
   * capitals introduced, and what has to hold is that the notation means the
   * same thing on the way back in.
   */
  it('round-trips through the notation', () => {
    const raw = 'The <sc>Theosophical Society</sc> was founded in <i>1875</i>.'
    const once = parseInlineMarkup(raw)
    const written = withMarkup(once.text, once)
    const twice = parseInlineMarkup(written)
    expect(twice.text).toBe(once.text)
    expect(twice.smallCaps).toEqual(once.smallCaps)
    expect(twice.emphasis).toEqual(once.emphasis)
    expect(withMarkup(twice.text, twice)).toBe(written)
  })

  it('nests with the other marks rather than crossing them', () => {
    const out = withMarkup('Hermes Trismegistus wrote', {
      smallCaps: [0, 1],
      emphasis: [1]
    })
    // Small capitals outermost, so a headword that is also a title reads as a
    // headword; and closed in the right order, never `<sc><i></sc></i>`.
    expect(out).toBe('<sc>Hermes <i>Trismegistus</i></sc> wrote')
    expect(parseInlineMarkup(out).smallCaps).toEqual([0, 1])
    expect(parseInlineMarkup(out).emphasis).toEqual([1])
  })

  it('carries the mark into a parsed page, and out again', () => {
    const page = parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'paragraph', text: '<sc>Kabalist</sc>, from KABALA.' }],
        uncertain: [],
        furniture: {}
      },
      0
    )
    expect(page.blocks[0]?.smallCaps).toEqual([0])
    expect(page.blocks[0]?.text).toBe('Kabalist, from KABALA.')
  })

  /**
   * A batch may carry the field alongside the text, the way it carries
   * `emphasis` — the parser refuses any field it does not know by name, so a
   * mark missing from that list takes the whole leaf down rather than arriving
   * unmarked. What is *kept* is still only what the notation says: the marks
   * are re-derived here as they are on every edit.
   */
  it('accepts a block that carries the field beside its text', () => {
    expect(() =>
      parsePageTranscription(
        {
          role: 'body',
          blocks: [{ kind: 'paragraph', text: '<sc>Kabalist</sc>, from KABALA.', smallCaps: [0] }],
          uncertain: [],
          furniture: {}
        },
        0
      )
    ).not.toThrow()
  })
})

/** A measurer that reports a face carrying `smcp`, which the stub does not. */
function withSmallCaps(inner: TextMeasurer): TextMeasurer {
  return { ...inner, hasSmallCaps: () => true }
}

const EDITION = { title: 'Isis Unveiled', author: 'H. P. Blavatsky', editionDate: '2026' }

function bookSaying(text: string) {
  return assembleBook([
    parsePageTranscription(
      {
        role: 'body',
        blocks: [{ kind: 'paragraph', text }],
        uncertain: [],
        furniture: {}
      },
      0
    )
  ])
}

/** Every run the book draws, flattened. */
function runsOf(book: LaidOutBook) {
  return book.pages
    .flatMap((p) => p.items)
    .filter((i): i is Extract<typeof i, { kind: 'line' }> => i.kind === 'line')
    .flatMap((l) => l.runs)
}

describe('what a small-capitals run is set in', () => {
  const stub = fixedWidthMeasurer(0.5)
  const doc = bookSaying('The <sc>Hermetist</sc> spoke.')

  it('uses the face’s own small capitals where it has them', () => {
    const book = layout(doc, defaultStyleProfile(), withSmallCaps(stub), { edition: EDITION })
    const word = runsOf(book).find((r) => r.text === 'Hermetist')
    expect(word).toBeDefined()
    expect(word?.font.smallCaps).toBe(true)
    // The word itself is untouched: `smcp` does the work, not a case change.
    expect(runsOf(book).some((r) => r.text === 'HERMETIST')).toBe(false)
  })

  /**
   * Five of the seven faces offered carry no `smcp`. What a printer with none
   * in the case would do is set full capitals, which is also what `smcp` does
   * to a letter that is already one — so the fallback has the same shape as
   * the real thing. Never capitals scaled down.
   */
  it('sets full capitals in a face that has none, and never scales capitals down', () => {
    const book = layout(doc, defaultStyleProfile(), stub, { edition: EDITION })
    const word = runsOf(book).find((r) => r.text === 'HERMETIST')
    expect(word).toBeDefined()
    expect(word?.font.smallCaps).toBeUndefined()
    // Same size as the text around it: a scaled-down capital is a forgery.
    const body = runsOf(book).find((r) => r.text === 'spoke.')
    expect(word?.sizePt).toBe(body?.sizePt)
  })

  /**
   * A subscript is a character range into the same string, so a fallback that
   * lengthened a word would put a figure under the wrong letter. `ß` uppercases
   * to `SS`; the word is left as written rather than shifted.
   */
  it('leaves a word alone where capitalising it would change its length', () => {
    const book = layout(bookSaying('Die <sc>Straße</sc> ist lang.'), defaultStyleProfile(), stub, {
      edition: EDITION
    })
    expect(runsOf(book).some((r) => r.text === 'Straße')).toBe(true)
    expect(runsOf(book).some((r) => r.text === 'STRASSE')).toBe(false)
  })
})

describe('the mark survives the journey', () => {
  it('is carried across a page seam', () => {
    const book = assembleBook([
      parsePageTranscription(
        {
          role: 'body',
          blocks: [
            { kind: 'paragraph', text: 'A sentence that runs on about the', continuesNext: true }
          ],
          uncertain: [],
          furniture: {}
        },
        0
      ),
      parsePageTranscription(
        {
          role: 'body',
          blocks: [
            {
              kind: 'paragraph',
              text: '<sc>Hermetist</sc> and his wisdom.',
              continuesPrevious: true
            }
          ],
          uncertain: [],
          furniture: {}
        },
        1
      )
    ])
    const joined = book.blocks[0]
    expect(joined?.text).toContain('Hermetist')
    // The seam shifts the indices by the words already in the block: the
    // seventh word of the join, not the first.
    const words = (joined?.text ?? '').split(/\s+/u)
    expect(joined?.smallCaps?.map((i) => words[i])).toEqual(['Hermetist'])
  })

  it('is re-derived when a passage is corrected', () => {
    const book = bookSaying('The Hermetist spoke.')
    const corrected = applyEdits(book, [
      { kind: 'text', blockId: 'p0b0', text: 'The <sc>Hermetist</sc> spoke plainly.' }
    ])
    expect(corrected.blocks[0]?.smallCaps).toEqual([1])
    expect(corrected.blocks[0]?.text).toBe('The Hermetist spoke plainly.')
  })

  /**
   * And taken away when the tag is. A correction is retyped text, so the old
   * word indices describe a wording that no longer exists — keeping them would
   * set whichever words now sit at those positions in small capitals.
   */
  it('is cleared when the correction drops the tag', () => {
    const book = bookSaying('The <sc>Hermetist</sc> spoke.')
    expect(book.blocks[0]?.smallCaps).toEqual([1])
    const corrected = applyEdits(book, [
      { kind: 'text', blockId: 'p0b0', text: 'The Hermetist spoke plainly.' }
    ])
    expect(corrected.blocks[0]?.smallCaps).toBeUndefined()
  })
})

/** A text node, as the DOM would hand it over. */
const textNode = (value: string): RichNode => ({
  nodeType: 3,
  nodeName: '#text',
  nodeValue: value,
  childNodes: []
})

const el = (name: string, children: RichNode[], style?: { fontVariant?: string }): RichNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  nodeValue: null,
  childNodes: children,
  ...(style ? { style } : {})
})

/** The notation as a tree, near enough for the walk: tags become elements. */
function nodesOf(raw: string): RichNode[] {
  const out: RichNode[] = []
  const stack: RichNode[][] = [out]
  for (const part of raw.split(/(<\/?[a-z]+>)/u)) {
    if (part.length === 0) continue
    if (/^<\/[a-z]+>$/u.test(part)) {
      stack.pop()
      continue
    }
    const open = /^<([a-z]+)>$/u.exec(part)
    if (open) {
      const node = el(open[1]!, [])
      stack[stack.length - 1]!.push(node)
      stack.push(node.childNodes as RichNode[])
      continue
    }
    stack[stack.length - 1]!.push(textNode(part))
  }
  return out
}

/**
 * The galley is a `contenteditable`, so the notation crosses it twice: out as
 * HTML and back off the DOM. A mark the renderer can write and the walk cannot
 * read does not report itself — the run is simply gone from the block the
 * moment the editor touches it, which is what `<b>` did in an EPUB before the
 * serialiser learnt to write one.
 */
describe('the mark crosses the galley', () => {
  it('is shown as a tag the walk knows', () => {
    expect(htmlOfMarkup('<sc>Hermetist.</sc> From Hermes.')).toBe(
      '<sc>Hermetist.</sc> From Hermes.'
    )
  })

  it('is read back off the edited DOM', () => {
    expect(markupOfNodes([el('sc', [textNode('Kabalist.')]), textNode(' From KABALA.')])).toBe(
      '<sc>Kabalist.</sc> From KABALA.'
    )
    // What a paste from a word processor carries instead of an element.
    expect(markupOfNodes([el('span', [textNode('Adept.')], { fontVariant: 'small-caps' })])).toBe(
      '<sc>Adept.</sc>'
    )
  })

  it('comes back as the string it went out as', () => {
    const raw = 'The <sc>Hermetist</sc> read <i>Isis</i> twice.'
    expect(markupOfNodes(nodesOf(htmlOfMarkup(raw)))).toBe(raw)
  })
})

/**
 * A find-and-replace that swallows a tag re-balances it, so the words outside
 * the match keep their marking. The rebalancer took the tag's name by slicing
 * the string, which worked while every tag here was one letter long and reads
 * `</sc>` as a closer for a `<s>` that was never opened.
 */
describe('a sweep over a small-capitals run', () => {
  it('re-balances a closing tag the match swallowed', () => {
    const swept = sweepText('A <sc>Kabalist adept</sc> spoke', 'adept spoke', 'adept replied')
    expect(swept.count).toBe(1)
    const parsed = parseInlineMarkup(swept.text)
    expect(parsed.text).toBe('A Kabalist adept replied')
    // The replaced words take no marking — that is what a replacement is — but
    // `Kabalist`, which sat inside the run and outside the match, keeps its
    // own. A rebalancer blind to `</sc>` leaves the run open instead, and an
    // unclosed tag marks everything after it: [1, 2, 3].
    expect(parsed.smallCaps).toEqual([1])
  })
})
