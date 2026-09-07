import { describe, it, expect } from 'vitest'
import { htmlOfMarkup, markupOfNodes, plainOffsetOf, type RichNode } from '@core/edits'
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

describe("plainOffsetOf — where a finger landed, in the book's own coordinates", () => {
  // `Read <i>the whole book</i> twice.` as the DOM holds it after rendering.
  const root = el('div', [text('Read '), el('i', [text('the whole book')]), text(' twice.')])
  const PLAIN = 'Read the whole book twice.'

  it('maps a point in the first text node straight through', () => {
    expect(plainOffsetOf(root, root.childNodes[0]!, 4)).toBe(4)
    expect(PLAIN.slice(0, 4)).toBe('Read')
  })

  it('carries the count across an italic run, whose tags are not characters', () => {
    // The trap the whole function exists for. In the rendered HTML this point
    // is at 22, because `<i>` is three characters there. In the plain text —
    // which is where every anchor in this app is measured — it is 19.
    const inside = (root.childNodes[1] as RichNode).childNodes[0]!
    expect(plainOffsetOf(root, inside, 'the whole book'.length)).toBe(19)
    expect(PLAIN.slice(5, 19)).toBe('the whole book')
  })

  it('counts text nodes before the point, not tags', () => {
    expect(plainOffsetOf(root, root.childNodes[2]!, ' twice.'.length)).toBe(PLAIN.length)
  })

  it('counts an escaped character once, because it counts the text node', () => {
    // `htmlOfMarkup` writes `&amp;`, five characters of HTML. The DOM hands
    // back a text node holding one, and the book's plain text has one.
    const amp = el('div', [text('Salt & fire')])
    expect(plainOffsetOf(amp, amp.childNodes[0]!, 6)).toBe(6)
    expect(htmlOfMarkup('Salt & fire')).toContain('&amp;')
  })

  it('reads an offset into an element as a count of children, not characters', () => {
    // What a selection landing on a tag boundary hands back: the container is
    // the element and the offset is a child index. Selecting the whole
    // italicised phrase ends at <i> child 1 — which is character 19, the end of
    // "the whole book", and not character 6. Reading it as characters would put
    // the anchor a plausible-looking distance from where the finger was, which
    // is the exact fault CLAUDE.md names: coordinates compared before checking
    // what they mean.
    const italic = root.childNodes[1]!
    expect(plainOffsetOf(root, italic, 0)).toBe(5)
    expect(plainOffsetOf(root, italic, 1)).toBe(19)
    expect(PLAIN.slice(5, 19)).toBe('the whole book')
  })

  it('reads an offset into the passage itself the same way', () => {
    // Safari hands back the container element for a selection that spans whole
    // children, so the root is a legitimate target and not an edge case.
    expect(plainOffsetOf(root, root, 0)).toBe(0)
    expect(plainOffsetOf(root, root, 2)).toBe(19)
    expect(plainOffsetOf(root, root, 3)).toBe(PLAIN.length)
  })

  it('returns null for a point outside the passage, rather than a plausible number', () => {
    // A drag that left the block. The honest answer is "not here" — a number
    // measured from the wrong origin is the fault CLAUDE.md names outright.
    expect(plainOffsetOf(root, text('somewhere else'), 3)).toBeNull()
  })
})
