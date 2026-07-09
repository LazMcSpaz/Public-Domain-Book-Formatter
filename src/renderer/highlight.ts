/**
 * Imperative cross-pane highlight controller (SPEC §4 hover-sync + jump-to-flag).
 *
 * Why this exists: hover-sync and flag-jump used to run through React state, so
 * every pointer move (or flag click) re-rendered the *entire book's* worth of
 * word elements — thousands of <span>/<rect> nodes. That was the visible "lag
 * between highlighting on one pane and it reacting on the other." Here we instead
 * toggle a class on just the two affected DOM nodes (the one leaving the
 * highlight and the one entering it), touching nothing else, so React never
 * re-renders on hover at all.
 *
 * Two independent highlight layers, both keyed on `data-token-id` (which both
 * panes already emit — the output <span>s and the source <rect>s):
 *   - HOVER  (`is-hover`)         — follows the pointer; cleared on leave.
 *   - ACTIVE (`is-active-token`)  — the jumped-to flag/tag/TOC token; sticky
 *                                    until the next jump.
 *
 * A tiny observable exposes the hovered token id for the one component that
 * genuinely must react to it (the source-crop popover). Only it subscribes, so
 * the panes stay render-free during hover.
 */

const HOVER_CLASS = 'is-hover'
const ACTIVE_CLASS = 'is-active-token'

let hoverToken: string | null = null
let activeToken: string | null = null

const hoverListeners = new Set<(id: string | null) => void>()

/** All rendered elements (output span + source rect) for a token id. */
function elementsFor(id: string): Element[] {
  if (typeof document === 'undefined') return []
  return Array.from(document.querySelectorAll(`[data-token-id="${CSS.escape(id)}"]`))
}

function toggleClass(id: string | null, cls: string, on: boolean): void {
  if (!id) return
  for (const el of elementsFor(id)) el.classList.toggle(cls, on)
}

/**
 * Set (or clear with null) the hovered token. Only the previously- and
 * newly-hovered nodes are touched, so this is O(matches), not O(book).
 */
export function setHoverToken(id: string | null): void {
  if (id === hoverToken) return
  toggleClass(hoverToken, HOVER_CLASS, false)
  hoverToken = id
  toggleClass(hoverToken, HOVER_CLASS, true)
  for (const cb of hoverListeners) cb(hoverToken)
}

/** Current hovered token id (for imperative readers). */
export function getHoverToken(): string | null {
  return hoverToken
}

/** Subscribe to hover changes; returns an unsubscribe. */
export function subscribeHover(cb: (id: string | null) => void): () => void {
  hoverListeners.add(cb)
  return () => {
    hoverListeners.delete(cb)
  }
}

/**
 * Set (or clear) the sticky "active" token — the one a flag/tag/TOC jump landed
 * on. Persists across pointer moves so the target stays highlighted after the
 * scroll.
 */
export function setActiveToken(id: string | null): void {
  if (id === activeToken) return
  toggleClass(activeToken, ACTIVE_CLASS, false)
  activeToken = id
  toggleClass(activeToken, ACTIVE_CLASS, true)
}

// --- Jump registry ---------------------------------------------------------
// SideBySideView owns the scroll containers, so it registers the actual scroll
// implementation; callers (flags/tags/TOC) just ask to jump to a token id.

type JumpFn = (tokenId: string) => void

let jumpFn: JumpFn | null = null

/** SideBySideView registers how to scroll to a token (null to unregister). */
export function registerJump(fn: JumpFn | null): void {
  jumpFn = fn
}

/**
 * Jump to a token: mark it active (sticky highlight on both panes) and scroll it
 * into view. Highlight applies even if the scroll container isn't registered yet.
 */
export function jumpToToken(tokenId: string): void {
  setActiveToken(tokenId)
  jumpFn?.(tokenId)
}
