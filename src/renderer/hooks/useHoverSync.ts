/**
 * useHoverSync — bridges CoordinateMap queries to the shared hover state so a
 * passage and its counterpart highlight together across panes (SPEC §4
 * hover-sync). Source-pane callers pass a page point; output-pane callers pass a
 * char offset. Both resolve to the same `tokenId`.
 */
import { useCallback } from 'react'
import { useReview } from '../store/ReviewContext'

export interface HoverSync {
  /** The currently-highlighted token id (null when nothing is hovered). */
  hoverTokenId: string | null
  /** Hover came from the source image at (pageIndex, x, y) in image pixels. */
  setHoverFromSource(pageIndex: number, x: number, y: number): void
  /** Hover came from the output text at a character offset. */
  setHoverFromOutput(offset: number): void
  clearHover(): void
}

export function useHoverSync(): HoverSync {
  const { state, dispatch } = useReview()
  const map = state.coordinateMap

  const setHoverFromSource = useCallback(
    (pageIndex: number, x: number, y: number) => {
      const entry = map?.atPoint(pageIndex, x, y) ?? null
      dispatch({
        type: 'SET_HOVER',
        hover: {
          tokenId: entry?.tokenId ?? null,
          sourcePageIndex: pageIndex,
          outputOffset: entry?.output.start ?? null
        }
      })
    },
    [map, dispatch]
  )

  const setHoverFromOutput = useCallback(
    (offset: number) => {
      const entry = map?.atOutputOffset(offset) ?? null
      dispatch({
        type: 'SET_HOVER',
        hover: {
          tokenId: entry?.tokenId ?? null,
          sourcePageIndex: entry?.pageIndex ?? null,
          outputOffset: offset
        }
      })
    },
    [map, dispatch]
  )

  const clearHover = useCallback(() => dispatch({ type: 'CLEAR_HOVER' }), [dispatch])

  return {
    hoverTokenId: state.hover.tokenId,
    setHoverFromSource,
    setHoverFromOutput,
    clearHover
  }
}
