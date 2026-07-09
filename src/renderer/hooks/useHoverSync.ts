/**
 * useHoverSync — bridges CoordinateMap queries to the imperative highlight
 * controller so a passage and its counterpart highlight together across panes
 * (SPEC §4 hover-sync). Source-pane callers pass a page point; output-pane
 * callers pass a char offset. Both resolve to the same `tokenId`, which is then
 * highlighted directly on the two affected DOM nodes — no React re-render, so
 * hovering stays snappy on a whole book's worth of words.
 */
import { useCallback } from 'react'
import { useReview } from '../store/ReviewContext'
import { setHoverToken } from '../highlight'

export interface HoverSync {
  /** Hover came from the source image at (pageIndex, x, y) in image pixels. */
  setHoverFromSource(pageIndex: number, x: number, y: number): void
  /** Hover came from the output text at a character offset. */
  setHoverFromOutput(offset: number): void
  clearHover(): void
}

export function useHoverSync(): HoverSync {
  const { state } = useReview()
  const map = state.coordinateMap

  const setHoverFromSource = useCallback(
    (pageIndex: number, x: number, y: number) => {
      const entry = map?.atPoint(pageIndex, x, y) ?? null
      setHoverToken(entry?.tokenId ?? null)
    },
    [map]
  )

  const setHoverFromOutput = useCallback(
    (offset: number) => {
      const entry = map?.atOutputOffset(offset) ?? null
      setHoverToken(entry?.tokenId ?? null)
    },
    [map]
  )

  const clearHover = useCallback(() => setHoverToken(null), [])

  return {
    setHoverFromSource,
    setHoverFromOutput,
    clearHover
  }
}
