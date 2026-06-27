/**
 * useScrollSync — keeps the source and output panes tracking each other during a
 * whole-book read (SPEC §4 scroll-sync). Scrolling one pane scrolls the other to
 * the corresponding location, resolved through the coordinate map.
 *
 * STEP 0 STUB: the real implementation (committed in the integration step) reads
 * the topmost visible word in the scrolled pane, maps it via the CoordinateIndex
 * (atPoint / atOutputOffset), and programmatically scrolls the opposite pane —
 * guarded by a lock flag so the induced scroll doesn't echo back. It depends on
 * the source/output pane DOM (data-token-id / data-start markers and per-page
 * elements) which the pane agents provide, so it is wired last. For now it is a
 * safe no-op that establishes the hook signature.
 */
import type { RefObject } from 'react'

export function useScrollSync(
  _sourcePaneRef: RefObject<HTMLElement>,
  _outputPaneRef: RefObject<HTMLElement>
): void {
  // Intentionally empty until the panes expose their scrollable DOM. See above.
}
