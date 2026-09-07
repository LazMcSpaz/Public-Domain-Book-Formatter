import { describe, it, expect } from 'vitest'
import { htmlOfMarkup, htmlWithSpans, markupOfNodes, type RichNode } from '@core/edits'
import { normalizeMarkup, type TranscribedBlock } from '@core/transcribe'

/** A text node, as the DOM would hand it over. */
const text = (value: string): RichNode => ({
  nodeType: 3,
  nodeName: '#text',
  nodeValue: value,
  childNodes: []
})

/** An element node. `style` mimics `HTMLElement.style`'s relevant corners. */
const el = (
  name: string,
  children: RichNode[],
  style?: { fontStyle?: string; fontWeight?: string }
): RichNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  nodeValue: null,
  childNodes: children,
  ...(style ? { style } : {})
})

describe('htmlOfMarkup — showing the notation as type', () => {
  it('turns tag runs into real italics and escapes everything else', () => {
    expect(htmlOfMarkup('Read <i>the whole book</i> twice.')).toBe(
      'Read <i>the whole book</i> twice.'
    )
    expect(htmlOfMarkup('Salt & fire, 2 < 3.')).toBe('Salt &amp; fire, 2 &lt; 3.')
  })

  it('nests bold outside italic, the convention withMarkup prints', () => {
    expect(htmlOfMarkup('<b><i>Aether.</i></b> The medium.')).toBe(
      '<b><i>Aether.</i></b> The medium.'
    )
  })

  it('never emits a tag it did not make itself', () => {
    // A block whose text contains something tag-shaped must not reach the
    // editor as live HTML — that is how a stray <img onerror> would run.
    const html = htmlOfMarkup('A <script>alert(1)</script> in the text.')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('markupOfNodes — reading the edited DOM back', () => {
  it('reads i/em/b/strong and their styled equivalents', () => {
    expect(markupOfNodes([text('Read '), el('i', [text('this')]), text(' now.')])).toBe(
      'Read <i>this</i> now.'
    )
    expect(markupOfNodes([el('em', [text('so')])])).toBe('<i>so</i>')
    expect(markupOfNodes([el('strong', [text('Aether.')])])).toBe('<b>Aether.</b>')
    expect(markupOfNodes([el('span', [text('slant')], { fontStyle: 'italic' })])).toBe(
      '<i>slant</i>'
    )
    expect(markupOfNodes([el('span', [text('heavy')], { fontWeight: '700' })])).toBe('<b>heavy</b>')
  })

  it('does not re-open a mark inside itself', () => {
    expect(markupOfNodes([el('i', [text('a '), el('i', [text('b')])])])).toBe('<i>a b</i>')
  })

  it('turns a manual line break into a space, never a break', () => {
    // The one thing this surface refuses to record: the book reflows, so the
    // words rejoin the sentence.
    expect(markupOfNodes([text('one'), el('br', []), text('two')])).toBe('one two')
  })

  it('drops an empty mark and keeps unknown wrappers transparent', () => {
    expect(markupOfNodes([el('i', []), text('plain')])).toBe('plain')
    expect(markupOfNodes([el('font', [text('kept')])])).toBe('kept')
  })

  it('separates pasted block elements with a space', () => {
    expect(markupOfNodes([el('div', [text('one')]), el('div', [text('two')])])).toBe('one two')
  })
})

describe('the round trip', () => {
  it('DOM → notation → normalizeMarkup lands the same words the tags marked', () => {
    const committed = markupOfNodes([
      text('The '),
      el('b', [el('i', [text('Corpus Hermeticum')])]),
      text(' names it.')
    ])
    const block = normalizeMarkup<TranscribedBlock>({ kind: 'paragraph', text: committed })
    expect(block.text).toBe('The Corpus Hermeticum names it.')
    expect(block.emphasis).toEqual([1, 2])
    expect(block.strong).toEqual([1, 2])
  })
})

describe("htmlWithSpans — the book with the editor's marks on it", () => {
  const span = (from: number, to: number, id = 'h1', key = 'tag-note') => ({ from, to, key, id })

  it('tints a stretch of plain text at the offsets it was marked at', () => {
    // "Read the whole book twice." — marking "whole book".
    expect(htmlWithSpans('Read the whole book twice.', [span(9, 19)])).toBe(
      'Read the <mark class="reading-mark tag-note" data-marks="h1">whole book</mark> twice.'
    )
  })

  it('leaves the passage exactly as htmlOfMarkup left it when nothing is marked', () => {
    const raw = 'Read <i>the whole book</i> twice.'
    expect(htmlWithSpans(raw, [])).toBe(htmlOfMarkup(raw))
  })

  it('counts the plain text, not the tags, when emphasis is in the way', () => {
    // The trap. In the rendered HTML "twice" starts at 29 because `<i>` and
    // `</i>` are seven characters there; in the plain text it starts at 20,
    // which is where the highlight was made.
    const out = htmlWithSpans('Read <i>the whole book</i> twice.', [span(20, 25)])
    expect(out).toContain('>twice</mark>')
    expect(out).toContain('<i>the whole book</i>')
  })

  it('closes the tint before a tag and reopens after, so nothing crosses </i>', () => {
    // A highlight running from inside an italic run to outside it. One <mark>
    // spanning </i> would be invalid HTML and the browser would repair it
    // somewhere the editor did not mark.
    const out = htmlWithSpans('Read <i>the whole book</i> twice.', [span(14, 25)])
    expect(out).not.toMatch(/<mark[^>]*>[^<]*<\/i>/u)
    expect(out.match(/<mark/gu)).toHaveLength(2)
    expect(out).toContain('</i>')
  })

  it('splits at every boundary so two overlapping marks are both visible', () => {
    // One winning would tell the editor a passage is marked once when it is
    // marked twice, and the second would stay invisible until the harvest
    // contradicted the page.
    const out = htmlWithSpans('Read the whole book twice.', [
      span(0, 14, 'h1', 'tag-note'),
      span(9, 19, 'h2', 'tag-intro')
    ])
    expect(out).toContain('data-marks="h1"')
    expect(out).toContain('data-marks="h1 h2"')
    expect(out).toContain('data-marks="h2"')
    expect(out).toContain('tag-intro tag-note')
  })

  it('counts an escaped character once, because a reader sees one', () => {
    // `&amp;` is five characters of HTML and one of text. Counting the HTML
    // would slide every mark after an ampersand four characters right.
    const out = htmlWithSpans('Salt & fire, twice.', [span(13, 18)])
    expect(out).toContain('&amp;')
    expect(out).toContain('>twice</mark>')
  })
})
