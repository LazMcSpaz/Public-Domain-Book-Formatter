/**
 * ReviewShell — the main review layout (SPEC §4): a ControlBar on top, the
 * linked SideBySideView filling the center, and a collapsible right sidebar
 * holding the FlagPanel and FindReplacePanel. Reads everything from
 * ReviewContext.
 *
 * SideBySideView is owned by the integrator and rendered, not edited, here.
 */
import { useState } from 'react'
import { useReview } from '../store/ReviewContext'
import { SideBySideView } from './SideBySideView'
import { ControlBar } from './ControlBar/ControlBar'
import { FlagPanel } from './FlagPanel/FlagPanel'
import { FindReplacePanel } from './FindReplacePanel/FindReplacePanel'
import './ReviewShell.css'

export function ReviewShell(): JSX.Element {
  const { state, dispatch } = useReview()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const title = state.project?.config.title || 'Untitled'

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <span className="review-title">{title}</span>
        <span className="review-dirty">{state.isDirty ? '● unsaved' : 'saved'}</span>
        <button
          type="button"
          className="review-sidebar-toggle"
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? 'Hide panels ▸' : '◂ Show panels'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>
          Close
        </button>
      </header>

      <ControlBar />

      <div className="review-body">
        <div className="review-center">
          <SideBySideView />
        </div>
        {sidebarOpen ? (
          <aside className="review-sidebar">
            <FlagPanel />
            <FindReplacePanel />
          </aside>
        ) : null}
      </div>
    </div>
  )
}
