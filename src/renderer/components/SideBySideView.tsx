/**
 * SideBySideView — the linked source/output panes (SPEC §4 centerpiece).
 *
 * Owns the two scroll containers, passes their refs to the panes, wires
 * `useScrollSync`, and applies the reading-comfort CSS variables. Hover-sync is
 * driven by the panes themselves through `useHoverSync`.
 *
 * PLACEHOLDER (Phase 2 scaffold). The full implementation (mounting SourcePane /
 * OutputPane and wiring the sync hooks) is committed in the integration step,
 * once the pane components exist. For now it renders a stub so the app boots.
 */
import { useRef, type CSSProperties } from 'react'
import { useReview } from '../store/ReviewContext'
import { useScrollSync } from '../hooks/useScrollSync'

export function SideBySideView(): JSX.Element {
  const { state } = useReview()
  const sourceRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  useScrollSync(sourceRef, outputRef)

  const { fontSize, lineSpacing, lineLength, leftPaneWidthPct } = state.readingPrefs

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
      <div className="pane source-pane" ref={sourceRef}>
        <p className="pane-placeholder">Source pane (pending integration).</p>
      </div>
      <div className="pane output-pane" ref={outputRef}>
        <p className="pane-placeholder">Output pane (pending integration).</p>
      </div>
    </div>
  )
}
