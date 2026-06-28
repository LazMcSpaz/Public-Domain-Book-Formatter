/**
 * ReviewShell — the main review layout (SPEC §4): a ControlBar on top, the
 * linked SideBySideView filling the center, and a collapsible right sidebar
 * holding the FlagPanel and FindReplacePanel. Reads everything from
 * ReviewContext.
 *
 * SideBySideView is owned by the integrator and rendered, not edited, here.
 */
import { useState } from 'react'
import type { ActiveView } from '../store/types'
import { useReview } from '../store/ReviewContext'
import { SideBySideView } from './SideBySideView'
import { ControlBar } from './ControlBar/ControlBar'
import { FlagPanel } from './FlagPanel/FlagPanel'
import { FindReplacePanel } from './FindReplacePanel/FindReplacePanel'
import { StructurePanel } from './Tagging'
import { ImageEditor } from './ImageMode'
import { StyleEditor, ProfileManager } from './StyleEditor'
import { FrontMatter } from './FrontMatter'
import { ExportPanel } from './ExportPanel'
import './ReviewShell.css'

const VIEW_TABS: { id: ActiveView; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'style', label: 'Design' },
  { id: 'export', label: 'Export' }
]

export function ReviewShell(): JSX.Element {
  const { state, dispatch } = useReview()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const title = state.project?.config.title || 'Untitled'
  const view = state.activeView

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <span className="review-title">{title}</span>
        <nav className="review-nav">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`review-nav-tab${view === tab.id ? ' review-nav-tab--active' : ''}`}
              aria-pressed={view === tab.id}
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', view: tab.id })}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <span className="review-dirty">{state.isDirty ? '● unsaved' : 'saved'}</span>
        {view === 'review' && (
          <button
            type="button"
            className="review-sidebar-toggle"
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? 'Hide panels ▸' : '◂ Show panels'}
          </button>
        )}
        <button type="button" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>
          Close
        </button>
      </header>

      {view === 'review' && (
        <>
          <ControlBar />
          <div className="review-body">
            <div className="review-center">
              <SideBySideView />
            </div>
            {sidebarOpen ? (
              <aside className="review-sidebar">
                <StructurePanel />
                <FlagPanel />
                <FindReplacePanel />
              </aside>
            ) : null}
          </div>
        </>
      )}

      {view === 'style' && (
        <div className="review-scroll-view">
          <ProfileManager />
          <StyleEditor />
          <FrontMatter />
        </div>
      )}

      {view === 'export' && (
        <div className="review-scroll-view">
          <ExportPanel />
        </div>
      )}

      <ImageEditor />
    </div>
  )
}
