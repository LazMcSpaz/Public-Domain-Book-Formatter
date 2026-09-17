/**
 * The book's inline notation, in and out of a rich-text editing surface.
 *
 * The proof step edits emphasis as literal `<i>` tags in a textarea — visible,
 * correctable, and read straight back by `normalizeMarkup`. The book editor
 * shows italic as italic instead, which needs the same notation carried both
 * ways across a `contenteditable`:
 *
 *  - `htmlOfMarkup` renders the notation as HTML that contains nothing but
 *    the notation's own tags — `<i>`, `<b>`, `<sc>`, `<sub>` — and escaped
 *    text, so a block can be shown (and edited) with its emphasis visible
 *    rather than as tags.
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
import { parseInlineMarkup, type MarkRange } from '@core/transcribe'

/** What the serialiser needs of a DOM node. Real nodes satisfy it as-is. */
export interface RichNode {
  /** 1 for an element, 3 for text; anything else is ignored. */
  nodeType: number
  /** Upper-cased by the DOM; compared case-insensitively here anyway. */
  nodeName: string
  nodeValue: string | null
  childNodes: ArrayLike<RichNode>
  /** Elements carry inline style; some editors emit emphasis through it. */
  style?: {
    fontStyle?: string
    fontWeight?: string
    fontVariant?: string
    verticalAlign?: string
  } | null
}

const escapeHtml = (s: string): string =>
  s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

/**
 * The notation as HTML: escaped text with the notation's own tags around the
 * marked word runs, and nothing else — safe to hand to
 * `dangerouslySetInnerHTML` because every character that did not come out of
 * this function's own tags has been escaped.
 *
 * Contiguous marked words share one pair of tags and they nest `<sc>` outside
 * `<b>` outside `<i>`, the same conventions `withMarkup` prints, so the editor
 * shows what the notation means rather than a variant of it.
 */
export function htmlOfMarkup(raw: string): string {
  const { text, emphasis, strong, smallCaps, subscript } = parseInlineMarkup(raw)
  const marks = [
    { words: new Set(strong), tag: 'b', inside: false },
    { words: new Set(emphasis), tag: 'i', inside: false }
  ]

  let out = ''
  let index = 0
  let cursor = 0
  for (const part of text.split(/(\s+)/u)) {
    if (part.length === 0) continue
    if (/^\s+$/u.test(part)) {
      out += part
      cursor += part.length
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
    // `<sc>` and `<sub>` are character ranges: they open and close inside the
    // word, so they nest innermost and the text is escaped either side of the
    // tags rather than around them.
    out += charMarked(part, cursor, smallCaps, subscript)
    cursor += part.length
    index += 1
  }
  for (const mark of [...marks].reverse()) if (mark.inside) out += `</${mark.tag}>`
  return out
}

/**
 * One word with the character-range tags put back, everything else escaped.
 *
 * Both kinds in one walk because they can meet in a word and a piece has to be
 * wholly inside or wholly outside each: cut wherever either answer changes and
 * the nesting falls out, `<sc>` outside `<sub>`. This mirrors `withMarkup`'s
 * own serialiser exactly — the difference is only that this one escapes, being
 * handed to `dangerouslySetInnerHTML`.
 */
function charMarked(
  word: string,
  start: number,
  smallCaps: readonly MarkRange[],
  subscript: readonly MarkRange[]
): string {
  if (smallCaps.length === 0 && subscript.length === 0) return escapeHtml(word)
  const inside = (ranges: readonly MarkRange[], at: number): boolean =>
    ranges.some((r) => r.from <= start + at && r.to > start + at)
  let out = ''
  let sc = false
  let sub = false
  for (let at = 0; at <= word.length; at += 1) {
    const wantSc = at < word.length && inside(smallCaps, at)
    const wantSub = at < word.length && inside(subscript, at)
    if (sub && (!wantSub || wantSc !== sc)) {
      out += '</sub>'
      sub = false
    }
    if (sc && !wantSc) {
      out += '</sc>'
      sc = false
    }
    if (wantSc && !sc) {
      out += '<sc>'
      sc = true
    }
    if (wantSub && !sub) {
      out += '<sub>'
      sub = true
    }
    if (at < word.length) out += escapeHtml(word[at]!)
  }
  return out
}

/** Tag names that mean italic, beyond what inline style may add. */
const ITALIC_NAMES = new Set(['I', 'EM', 'CITE', 'VAR'])
const STRONG_NAMES = new Set(['B', 'STRONG'])
/**
 * Tag names that mean small capitals.
 *
 * `<sc>` is not an HTML element, so nothing in a `contenteditable` produces
 * one by itself — it is here because `htmlOfMarkup` emits it and this walk is
 * what reads that back. A mark the renderer can write and the reader cannot
 * see is not a gap that reports itself: the run would simply be gone from the
 * block the moment the editor touched it, which is the shape of fault the
 * `withMarkup` positional argument had.
 *
 * `font-variant: small-caps` is read too, because that is what a paste from a
 * word processor carries.
 */
const SMALL_CAPS_NAMES = new Set(['SC', 'SMALLCAPS'])
/**
 * Tag names that mean subscript.
 *
 * `execCommand('subscript')` in a `contenteditable` emits `<sub>`, so the
 * galley's own toolbar and a hand-typed tag arrive here as the same thing —
 * which is the property Ctrl+I already has and the reason the notation is read
 * back off the DOM rather than tracked beside it.
 */
const SUBSCRIPT_NAMES = new Set(['SUB'])

const styledSubscript = (node: RichNode): boolean => (node.style?.verticalAlign ?? '') === 'sub'

const styledSmallCaps = (node: RichNode): boolean =>
  (node.style?.fontVariant ?? '').includes('small-caps')

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
  return serialize(nodes, { i: false, b: false, sc: false, sub: false })
}

/** Which runs the walk is already inside, so a nested mark does not re-open. */
interface Inside {
  i: boolean
  b: boolean
  sc: boolean
  sub: boolean
}

function serialize(nodes: ArrayLike<RichNode>, inside: Inside): string {
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
    const italic = !inside.i && (ITALIC_NAMES.has(name) || styledItalic(node))
    const bold = !inside.b && (STRONG_NAMES.has(name) || styledBold(node))
    const caps = !inside.sc && (SMALL_CAPS_NAMES.has(name) || styledSmallCaps(node))
    const low = !inside.sub && (SUBSCRIPT_NAMES.has(name) || styledSubscript(node))
    let inner = serialize(node.childNodes, {
      i: inside.i || italic,
      b: inside.b || bold,
      sc: inside.sc || caps,
      sub: inside.sub || low
    })
    // Marking nothing is not a mark: an empty <i></i> left behind by an editor
    // would otherwise emit a tag pair the notation reads as an unclosed run.
    if (inner.trim().length > 0) {
      // Innermost, matching how `withMarkup` prints it and how the reader
      // takes it: a subscript lives inside a word, never around one.
      if (low) inner = `<sub>${inner}</sub>`
      if (italic) inner = `<i>${inner}</i>`
      if (bold) inner = `<b>${inner}</b>`
      if (caps) inner = `<sc>${inner}</sc>`
    }
    out += inner
    // Block-level children separate words: two <div> lines pasted in must not
    // fuse their edge words together.
    if ((name === 'DIV' || name === 'P') && i < nodes.length - 1) out += ' '
  }
  return out
}

/** A stretch of a passage to tint, in the block's *plain-text* coordinates. */
export interface TextSpan {
  from: number
  to: number
  /** What kind of tint. Becomes a class, so the surface decides the colour. */
  key: string
  /** Which record this stretch belongs to, for a click on it. */
  id: string
}

/**
 * The notation as HTML, with stretches of it tinted.
 *
 * The reading view shows the book with the editor's marks on it, and the two
 * things it has to combine are measured differently: emphasis is word indices
 * into the notation, and a highlight is a character range in the plain text.
 * Neither can be applied to the other's output by hand without getting the
 * coordinates wrong, which is why this is one function rather than a component
 * splicing strings.
 *
 * It builds on `htmlOfMarkup` rather than beside it — still one renderer for
 * the book's own emphasis — and walks its output counting *plain text*: a tag
 * is not characters, and `&amp;` is one character and not five.
 *
 * Two rules keep the result valid HTML:
 *
 *  - a tint closes before any tag and reopens after it, so a highlight that
 *    starts inside an italic run and ends outside it emits two well-nested
 *    `<mark>`s rather than one that crosses `</i>`;
 *  - **overlapping tints split at every boundary**, each stretch carrying every
 *    record covering it. One winning and the other vanishing would tell the
 *    editor a passage is marked once when it is marked twice, and the second
 *    mark would then be invisible until the harvest contradicted the page.
 */
export function htmlWithSpans(raw: string, spans: readonly TextSpan[]): string {
  const html = htmlOfMarkup(raw)
  if (spans.length === 0) return html

  /** Every record covering a character, as a stable key and an id list. */
  const coverAt = (at: number): { key: string; ids: string } | null => {
    const over = spans.filter((s) => at >= s.from && at < s.to)
    if (over.length === 0) return null
    return {
      key: [...new Set(over.map((s) => s.key))].sort().join(' '),
      ids: over.map((s) => s.id).join(' ')
    }
  }

  interface Cover {
    key: string
    ids: string
  }
  let out = ''
  let plain = 0
  // Held in an object because the two helpers below assign it: TypeScript does
  // not track assignments made inside a closure, so a bare `let` initialised to
  // null stays narrowed to null everywhere it is read.
  const state: { open: Cover | null } = { open: null }
  const close = (): void => {
    if (state.open) out += '</mark>'
    state.open = null
  }
  const openTo = (cover: Cover | null): void => {
    if (cover) out += `<mark class="reading-mark ${cover.key}" data-marks="${cover.ids}">`
    state.open = cover
  }

  for (let i = 0; i < html.length;) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      // `htmlOfMarkup` emits only its own well-formed tags, so an unclosed `<`
      // cannot happen; treating one as text rather than throwing keeps this
      // total if that ever stops being true.
      const stop = end === -1 ? html.length : end + 1
      const was = state.open
      close()
      out += html.slice(i, stop)
      if (was) openTo(was)
      i = stop
      continue
    }
    let token = html[i]!
    let step = 1
    if (token === '&') {
      const end = html.indexOf(';', i)
      if (end !== -1 && end - i <= 6) {
        token = html.slice(i, end + 1)
        step = token.length
      }
    }
    const cover = coverAt(plain)
    const open = state.open
    if (cover?.key !== open?.key || cover?.ids !== open?.ids) {
      close()
      openTo(cover)
    }
    out += token
    plain += 1
    i += step
  }
  close()
  return out
}
