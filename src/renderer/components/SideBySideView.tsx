/**
 * SideBySideView — the linked source/output panes (SPEC §4 centerpiece).
 *
 * Owns the two scroll containers' refs, mounts the panes, wires `useScrollSync`,
 * and applies the reading-comfort CSS variables. Jump-to-flag/tag/TOC is served
 * by registering an imperative scroll with `renderer/highlight.ts`: callers ask
 * to jump to a token id, we scroll the output pane to it, and scroll-sync
 * mirrors the source side. Hover-sync is driven imperatively by the panes.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { useReview } from '../store/ReviewContext'
import { useScrollSync, scrollElementToToken } from '../hooks/useScrollSync'
import { registerJump } from '../highlight'
import { SourcePane } from './SourcePane/SourcePane'
import { OutputPane } from './OutputPane/OutputPane'

export function SideBySideView(): JSX.Element {
  const { state } = useReview()
  const sourceRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  const { fontSize, lineSpacing, lineLength, leftPaneWidthPct, showSource } = state.readingPrefs

  // Scroll-sync only matters when both panes are shown (review mode).
  useScrollSync(sourceRef, outputRef, showSource)

  // Register how to scroll to a token so flags/tags/TOC can jump imperatively,
  // without routing through React state (which used to re-render the whole tree).
  useEffect(() => {
    registerJump((tokenId) => {
      const out = outputRef.current
      if (out) scrollElementToToken(out, tokenId, 48)
    })
    return () => registerJump(null)
  }, [])

  return (
    <div
      className={`side-by-side${showSource ? '' : ' side-by-side--single'}`}
      style={
        {
          '--reading-font-size': `${fontSize}px`,
          '--reading-line-spacing': String(lineSpacing),
          '--reading-line-length': `${lineLength}ch`,
          '--left-pane-width': `${leftPaneWidthPct}%`
        } as CSSProperties
      }
    >
      {showSource ? (
        <div className="sbs-source">
          <SourcePane containerRef={sourceRef} />
        </div>
      ) : null}
      <div className="sbs-output">
        <OutputPane containerRef={outputRef} />
      </div>
    </div>
  )
}
