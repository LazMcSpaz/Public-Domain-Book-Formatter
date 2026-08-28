import { describe, it, expect } from 'vitest'
import { htmlOfMarkup, markupOfNodes, type RichNode } from '@core/edits'
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
