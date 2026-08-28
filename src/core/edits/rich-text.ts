/**
 * The book's inline notation, in and out of a rich-text editing surface.
 *
 * The proof step edits emphasis as literal `<i>` tags in a textarea — visible,
 * correctable, and read straight back by `normalizeMarkup`. The book editor
 * shows italic as italic instead, which needs the same notation carried both
 * ways across a `contenteditable`:
 *
 *  - `htmlOfMarkup` renders the notation as HTML that contains nothing but
 *    `<i>`, `<b>` and escaped text, so a block can be shown (and edited) with
 *    its emphasis visible rather than as tags.
 *  - `markupOfNodes` walks the edited DOM back to the notation, so what the
 *    editor commits is exactly the string a textarea would have held. Ctrl+I
 *    and a hand-typed tag produce the same edit; `normalizeMarkup` remains
 *    the one reader on the way in.
 *
 * Word granularity is inherited from the notation itself: emphasis lands on
 * whitespace-separated words (see `@core/transcribe/markup`), so italicising
 * half a word italicises the word. Books emphasise words, not fragments.
 *
 * Pure: `markupOfNodes` takes a *structural* tree — anything with `nodeType`,
 * `nodeName`, `nodeValue` and `childNodes`, which real DOM nodes satisfy —
 * so the walk is unit-testable without a browser and `src/core` stays free of
 * DOM types.
 */
import { parseInlineMarkup } from '@core/transcribe'

/** What the serialiser needs of a DOM node. Real nodes satisfy it as-is. */
export interface RichNode {
  /** 1 for an element, 3 for text; anything else is ignored. */
  nodeType: number
  /** Upper-cased by the DOM; compared case-insensitively here anyway. */
  nodeName: string
  nodeValue: string | null
  childNodes: ArrayLike<RichNode>
  /** Elements carry inline style; some editors emit emphasis through it. */
  style?: { fontStyle?: string; fontWeight?: string } | null
}

const escapeHtml = (s: string): string =>
  s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

/**
 * The notation as HTML: escaped text with `<i>` and `<b>` around the marked
 * word runs, and nothing else — safe to hand to `dangerouslySetInnerHTML`
 * because every character that did not come out of this function's own two
 * tags has been escaped.
 *
 * Contiguous marked words share one pair of tags and `<b>` nests outside
 * `<i>`, the same conventions `withMarkup` prints, so the editor shows what
 * the notation means rather than a variant of it.
 */
export function htmlOfMarkup(raw: string): string {
  const { text, emphasis, strong } = parseInlineMarkup(raw)
  const marks = [
    { words: new Set(strong), tag: 'b', inside: false },
    { words: new Set(emphasis), tag: 'i', inside: false }
  ]

  let out = ''
  let index = 0
  for (const part of text.split(/(\s+)/u)) {
    if (part.length === 0) continue
    if (/^\s+$/u.test(part)) {
      out += part
      continue
    }
    for (const mark of [...marks].reverse()) {
      if (mark.inside && !mark.words.has(index)) {
        out = out.replace(/(\s*)$/u, `</${mark.tag}>$1`)
        mark.inside = false
      }
    }
    for (const mark of marks) {
      if (!mark.inside && mark.words.has(index)) {
        out += `<${mark.tag}>`
        mark.inside = true
      }
    }
    out += escapeHtml(part)
    index += 1
  }
  for (const mark of [...marks].reverse()) if (mark.inside) out += `</${mark.tag}>`
  return out
}

/** Tag names that mean italic, beyond what inline style may add. */
const ITALIC_NAMES = new Set(['I', 'EM', 'CITE', 'VAR'])
const STRONG_NAMES = new Set(['B', 'STRONG'])

const styledItalic = (node: RichNode): boolean =>
  (node.style?.fontStyle ?? '').startsWith('italic') || node.style?.fontStyle === 'oblique'

const styledBold = (node: RichNode): boolean => {
  const weight = node.style?.fontWeight ?? ''
  return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600
}

/**
 * The edited DOM, back as the notation.
 *
 * Everything unknown is transparent — content kept, wrapper dropped — which is
 * `parseInlineMarkup`'s own posture and what makes a paste from anywhere land
 * as plain words rather than as somebody else's markup. Two shapes need actual
 * decisions:
 *
 *  - `<br>` becomes a space. A manual line break inside a paragraph is the one
 *    thing this surface refuses to record (the book reflows; see the plan), so
 *    the words rejoin the sentence rather than carrying a break nothing will
 *    honour.
 *  - a nested mark does not re-open: `<i>a <i>b</i></i>` is one italic run,
 *    exactly as the notation's reader would take it.
 */
export function markupOfNodes(nodes: ArrayLike<RichNode>): string {
  return serialize(nodes, false, false)
}

function serialize(nodes: ArrayLike<RichNode>, insideI: boolean, insideB: boolean): string {
  let out = ''
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    if (node.nodeType === 3) {
      out += node.nodeValue ?? ''
      continue
    }
    if (node.nodeType !== 1) continue

    const name = node.nodeName.toUpperCase()
    if (name === 'BR') {
      out += ' '
      continue
    }
    const italic = !insideI && (ITALIC_NAMES.has(name) || styledItalic(node))
    const bold = !insideB && (STRONG_NAMES.has(name) || styledBold(node))
    let inner = serialize(node.childNodes, insideI || italic, insideB || bold)
    // Marking nothing is not a mark: an empty <i></i> left behind by an editor
    // would otherwise emit a tag pair the notation reads as an unclosed run.
    if (inner.trim().length > 0) {
      if (italic) inner = `<i>${inner}</i>`
      if (bold) inner = `<b>${inner}</b>`
    }
    out += inner
    // Block-level children separate words: two <div> lines pasted in must not
    // fuse their edge words together.
    if ((name === 'DIV' || name === 'P') && i < nodes.length - 1) out += ' '
  }
  return out
}
