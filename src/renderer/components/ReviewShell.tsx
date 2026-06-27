/**
 * ReviewShell — the main review layout: control bar on top, the linked panes in
 * the center, and the flag / find-replace panels alongside. Reads everything
 * from ReviewContext.
 *
 * PLACEHOLDER (Phase 2 scaffold). Keep rendering <SideBySideView /> as the
 * center; add ControlBar, FlagPanel, and FindReplacePanel when reimplementing.
 */
import { useReview } from '../store/ReviewContext'
import { SideBySideView } from './SideBySideView'

export function ReviewShell(): JSX.Element {
  const { state, dispatch } = useReview()
  const title = state.project?.config.title || 'Untitled'

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <span className="review-title">{title}</span>
        <span className="review-dirty">{state.isDirty ? '● unsaved' : 'saved'}</span>
        <button type="button" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>
          Close
        </button>
      </header>
      <SideBySideView />
    </div>
  )
}
