/**
 * useSelectionRange — map the live DOM selection inside the output pane back to
 * an absolute char range into `project.markdown` (SPEC §5 right-click markup).
 *
 * WordSpans carry `data-start`/`data-end` (absolute, half-open offsets into the
 * markdown). To turn a `window.getSelection()` Range into a markdown
 * `OutputRange` we find, for each endpoint, the nearest ancestor element bearing
 * `[data-start]` and add the caret's character offset within that element,
 * clamped to `[data-start, data-end]`. Plain-text gaps between WordSpans have no
 * `data-start`, so an endpoint landing there resolves against the closest mapped
 * word — good enough to anchor a tag, and the offset math is unit-testable in
 * isolation via `resolveSelectionRange`.
 */
import { useCallback, type RefObject } from 'react'
import type { OutputRange } from '@core/model'

/** Minimal view of a DOM node endpoint, decoupled from the real DOM for tests. */
export interface SelectionEndpoint {
  /** Absolute markdown offset of the nearest `[data-start]` element. */
  dataStart: number
  /** Absolute markdown offset (exclusive) of that element's `[data-end]`. */
  dataEnd: number
  /**
   * Character offset of the caret measured from the start of that element's
   * text content (i.e. how many characters precede the caret within it).
   */
  offsetWithinElement: number
}

/**
 * Pure offset math: turn two resolved selection endpoints into a normalized
 * half-open `[start, end)` markdown range. Each endpoint becomes
 * `clamp(dataStart + offsetWithinElement, dataStart, dataEnd)`; the two are then
 * ordered. Returns null for a collapsed (empty) selection.
 */
export function resolveSelectionRange(
  anchor: SelectionEndpoint | null,
  focus: SelectionEndpoint | null
): OutputRange | null {
  if (!anchor || !focus) return null

  const a = clamp(anchor.dataStart + anchor.offsetWithinElement, anchor.dataStart, anchor.dataEnd)
  const f = clamp(focus.dataStart + focus.offsetWithinElement, focus.dataStart, focus.dataEnd)

  const start = Math.min(a, f)
  const end = Math.max(a, f)
  if (end <= start) return null
  return { start, end }
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo
  if (value > hi) return hi
  return value
}

/**
 * Resolve one DOM endpoint (node + offset) to a `SelectionEndpoint` by walking
 * up to the nearest `[data-start]` element and counting the characters that
 * precede the caret within it. Returns null when no mapped element is found
 * inside `root`.
 */
function resolveDomEndpoint(
  root: HTMLElement,
  node: Node | null,
  offset: number
): SelectionEndpoint | null {
  if (!node) return null

  const el = nearestDataStart(root, node)
  if (!el) return null

  const dataStart = Number(el.dataset.start)
  const dataEnd = Number(el.dataset.end)
  if (!Number.isFinite(dataStart) || !Number.isFinite(dataEnd)) return null

  return {
    dataStart,
    dataEnd,
    offsetWithinElement: charsBefore(el, node, offset)
  }
}

/** Nearest ancestor (or self) carrying `data-start`, bounded by `root`. */
function nearestDataStart(root: HTMLElement, node: Node): HTMLElement | null {
  let cur: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  while (cur && cur !== root.parentNode) {
    if (cur instanceof HTMLElement && cur.dataset.start !== undefined) return cur
    cur = cur.parentNode
  }
  return null
}

/**
 * Count characters within `el` that precede the caret at (node, offset). When
 * the caret is in a text node we add that node's local offset; otherwise we sum
 * the text of every preceding text node inside `el`.
 */
function charsBefore(el: HTMLElement, node: Node, offset: number): number {
  let count = 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    // Tag badges (SPEC §5) are decoration-only and not part of the markdown, so
    // their text must not count toward output offsets.
    acceptNode: (n) =>
      n.parentElement?.closest('.tag-badge') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  })
  let cur = walker.nextNode()
  while (cur) {
    if (cur === node) {
      return count + offset
    }
    count += cur.textContent?.length ?? 0
    cur = walker.nextNode()
  }
  // Caret node wasn't a descendant text node (e.g. it's the element itself):
  // an offset of N means after N child nodes — approximate with full length.
  return offset > 0 ? count : 0
}

/**
 * Hook: returns a getter that reads the current selection inside `rootRef` and
 * maps it to an absolute markdown `OutputRange`, or null when there's no
 * non-empty selection within the output root.
 */
export function useSelectionRange(rootRef: RefObject<HTMLElement>): () => OutputRange | null {
  return useCallback(() => {
    const root = rootRef.current
    if (!root) return null

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null

    // Both endpoints must live inside the output root.
    if (!sel.anchorNode || !sel.focusNode) return null
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null

    const anchor = resolveDomEndpoint(root, sel.anchorNode, sel.anchorOffset)
    const focus = resolveDomEndpoint(root, sel.focusNode, sel.focusOffset)
    return resolveSelectionRange(anchor, focus)
  }, [rootRef])
}
