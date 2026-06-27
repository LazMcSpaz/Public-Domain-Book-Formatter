/**
 * markdown-to-spans — turns the rendered output text plus its coordinate-map
 * entries into a flat list of renderable nodes (SPEC §4 output pane).
 *
 * The pipeline builds `project.markdown` as words joined by single spaces in
 * document order, and each `MappingEntry.output` is a half-open char range
 * `[start, end)` into that string. These helpers walk the string and emit a
 * `WordSpan` node for every mapped region and plain-text nodes for the gaps,
 * so the output pane can render mapped words (hover-sync, confidence tint) while
 * still showing the surrounding punctuation/whitespace verbatim.
 */
import type { MappingEntry } from '@core/model'

/** One renderable chunk: `entry` present → WordSpan, absent → plain text. */
export interface SpanNode {
  text: string
  entry?: MappingEntry
}

/**
 * A paragraph of the output, with its absolute start offset into the full
 * markdown and its pre-sliced span nodes. Offsets inside `nodes[].entry.output`
 * remain absolute into the full markdown, so ParagraphView never recomputes
 * global offsets.
 */
export interface Paragraph {
  text: string
  start: number
  nodes: SpanNode[]
}

/**
 * Produce a flat, in-order list of nodes covering the whole markdown string with
 * no gaps and no overlaps. Entries may arrive unsorted; they are sorted by
 * `output.start`. Entries whose range falls outside the string, is empty, or
 * overlaps the previously-emitted entry are skipped (defensive — the pipeline
 * should never emit those, but the UI must not crash if it does).
 */
export function markdownToSpans(
  markdown: string,
  entries: readonly MappingEntry[]
): SpanNode[] {
  const len = markdown.length
  if (len === 0) return []

  const sorted = [...entries].sort((a, b) => a.output.start - b.output.start)

  const nodes: SpanNode[] = []
  let cursor = 0

  for (const entry of sorted) {
    const { start, end } = entry.output
    // Defensive: skip out-of-range, empty, or overlapping entries.
    if (start < 0 || end > len || end <= start) continue
    if (start < cursor) continue

    if (start > cursor) {
      nodes.push({ text: markdown.slice(cursor, start) })
    }
    nodes.push({ text: markdown.slice(start, end), entry })
    cursor = end
  }

  if (cursor < len) {
    nodes.push({ text: markdown.slice(cursor, len) })
  }

  return nodes
}

/**
 * Split the markdown on blank lines (`\n\n+`) into paragraphs, keeping each
 * paragraph's absolute start offset and pre-slicing the SpanNodes that fall
 * within it. The blank-line separators themselves are not part of any
 * paragraph (ParagraphView re-joins paragraphs with `\n\n`).
 */
export function splitParagraphs(
  markdown: string,
  entries: readonly MappingEntry[]
): Paragraph[] {
  if (markdown.length === 0) return []

  const nodes = markdownToSpans(markdown, entries)
  const paragraphs: Paragraph[] = []

  const separator = /\n{2,}/g
  let segStart = 0
  let match: RegExpExecArray | null

  const pushParagraph = (text: string, start: number): void => {
    paragraphs.push({ text, start, nodes: sliceNodes(nodes, start, start + text.length) })
  }

  while ((match = separator.exec(markdown)) !== null) {
    const text = markdown.slice(segStart, match.index)
    pushParagraph(text, segStart)
    segStart = match.index + match[0].length
  }
  pushParagraph(markdown.slice(segStart), segStart)

  return paragraphs
}

/**
 * Slice the flat node list to the absolute `[from, to)` range, trimming any node
 * that straddles a boundary. Plain-text nodes are sliced freely; entry nodes are
 * only kept when they fall entirely within the range (an entry never spans a
 * paragraph break in well-formed output).
 */
function sliceNodes(nodes: readonly SpanNode[], from: number, to: number): SpanNode[] {
  const out: SpanNode[] = []
  let cursor = 0

  for (const node of nodes) {
    const nodeStart = cursor
    const nodeEnd = cursor + node.text.length
    cursor = nodeEnd

    if (nodeEnd <= from || nodeStart >= to) continue

    const overlapStart = Math.max(nodeStart, from)
    const overlapEnd = Math.min(nodeEnd, to)
    if (overlapEnd <= overlapStart) continue

    if (node.entry) {
      // Keep entry nodes only when fully inside the range.
      if (nodeStart >= from && nodeEnd <= to) {
        out.push(node)
      } else {
        out.push({ text: node.text.slice(overlapStart - nodeStart, overlapEnd - nodeStart) })
      }
    } else {
      out.push({ text: node.text.slice(overlapStart - nodeStart, overlapEnd - nodeStart) })
    }
  }

  return out
}
