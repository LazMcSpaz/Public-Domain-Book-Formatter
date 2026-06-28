/**
 * SideBySideView — the linked source/output panes (SPEC §4 centerpiece).
 *
 * Owns the two scroll containers' refs, mounts the panes, wires `useScrollSync`,
 * applies the reading-comfort CSS variables, and scrolls to the active flag when
 * jump-to-next-flag changes it. Hover-sync is driven by the panes themselves.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { useReview } from '../store/ReviewContext'
import { useScrollSync, scrollElementToToken } from '../hooks/useScrollSync'
import { SourcePane } from './SourcePane/SourcePane'
import { OutputPane } from './OutputPane/OutputPane'

export function SideBySideView(): JSX.Element {
  const { state } = useReview()
  const sourceRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  useScrollSync(sourceRef, outputRef)

  const { fontSize, lineSpacing, lineLength, leftPaneWidthPct } = state.readingPrefs
  const { activeFlagIndex, project, coordinateMap } = state

  // Jump-to-flag: scroll the output pane to the active flag's token; scroll-sync
  // mirrors the source side. Heuristic flags without a tokenId fall back to the
  // token owning their output range.
  useEffect(() => {
    if (activeFlagIndex < 0 || !project) return
    const flag = project.flags[activeFlagIndex]
    if (!flag) return
    let tokenId: string | null = flag.tokenId ?? null
    if (!tokenId && flag.kind === 'heuristic' && flag.range) {
      tokenId = coordinateMap?.atOutputOffset(flag.range.start)?.tokenId ?? null
    }
    if (!tokenId) return
    const out = outputRef.current
    if (out) scrollElementToToken(out, tokenId, 48)
  }, [activeFlagIndex, project, coordinateMap])

  return (
    <div
      className="side-by-side"
      style={
        {
          '--reading-font-size': `${fontSize}px`,
          '--reading-line-spacing': String(lineSpacing),
          '--reading-line-length': `${lineLength}ch`,
          '--left-pane-width': `${leftPaneWidthPct}%`
        } as CSSProperties
      }
    >
      <div className="sbs-source">
        <SourcePane containerRef={sourceRef} />
      </div>
      <div className="sbs-output">
        <OutputPane containerRef={outputRef} />
      </div>
    </div>
  )
}
