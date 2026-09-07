/**
 * Where a point in the rendered column falls in a passage's **plain text**.
 *
 * Three coordinate systems meet whenever a finger or a caret lands on the page,
 * and they are different numbers for the same place: the *notation* an edit is
 * written in (`withMarkup`, which contains `<i>` and `<b>`), the *plain text*
 * every anchor in this app is measured in — a note's `at`, a `split`, a memo, a
 * highlight's `from` and `to` — and the *rendered HTML*, whose offsets count
 * tag characters. A DOM range hands back the third.
 *
 * The browser converts between them exactly, through `Range.toString()`, which
 * is why there is no arithmetic here to get wrong. A pure re-implementation was
 * written for this and thrown away: it duplicated what the Range API already
 * does, it was longer, and it had a bug in its first version. Two functions that
 * can disagree about where a selection is would be the same class of fault this
 * repository keeps closing — so this is the one place any of it is worked out,
 * and both the galley and the reading view come here for it.
 *
 * Browser-only by nature, so it lives in `src/app` rather than in core.
 */

/**
 * The plain-text offset of one DOM point, or null when it is outside `root`.
 *
 * Null rather than a fallback, because a selection dragged out of a passage and
 * a selection at its start are different things, and a number measured from the
 * wrong origin is exactly the fault CLAUDE.md names.
 */
export function offsetIn(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(container, offset)
  } catch {
    // A stale node, or an offset past the container's end — both mean the point
    // is not one this passage can answer for.
    return null
  }
  return range.toString().length
}

/** Plain-text caret offset of the current selection inside `root`. */
export function caretOffset(root: HTMLElement): number {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  return offsetIn(root, range.startContainer, range.startOffset) ?? 0
}

/**
 * The selection's two ends inside one passage, or null.
 *
 * Null when there is no selection, when it is collapsed to a caret — reading is
 * done by dragging over words, and a tap is not a mark — or when either end
 * lies outside this passage. That last case is a selection dragged across a
 * paragraph boundary, and refusing it is deliberate: a highlight names one
 * block, so the honest answer is that this is not a mark rather than a mark
 * silently truncated at an edge the reader cannot see.
 */
export function selectionSpan(root: HTMLElement): { from: number; to: number } | null {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const from = offsetIn(root, range.startContainer, range.startOffset)
  const to = offsetIn(root, range.endContainer, range.endOffset)
  if (from === null || to === null || from === to) return null
  return from < to ? { from, to } : { from: to, to: from }
}

/**
 * Where in a passage's plain text a click landed, so opening it for editing
 * puts the caret under the pointer rather than at the start.
 */
export function offsetAtPoint(root: HTMLElement, x: number, y: number): number {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y)
    if (position) {
      node = position.offsetNode
      offset = position.offset
    }
  }
  if (!node) return 0
  return offsetIn(root, node, offset) ?? 0
}

/** Put the caret at a plain-text offset inside `root`. */
export function setCaret(root: HTMLElement, offset: number): void {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel) return
  let remaining = offset
  const walk = (node: Node): boolean => {
    if (node.nodeType === 3) {
      const length = node.nodeValue?.length ?? 0
      if (remaining <= length) {
        sel.collapse(node, remaining)
        return true
      }
      remaining -= length
      return false
    }
    for (const child of Array.from(node.childNodes)) if (walk(child)) return true
    return false
  }
  if (!walk(root)) sel.collapse(root, root.childNodes.length)
}
