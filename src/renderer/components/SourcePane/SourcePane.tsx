/**
 * SourcePane — the left side of the side-by-side review instrument (SPEC §4):
 * the stack of source page scans with word overlays for hover-sync, confidence
 * tinting, and the source-image-on-hover popover.
 *
 * The root scrollable div receives the integrator's `containerRef` (its
 * scroll-sync reads/writes scrollTop and scans `data-page-index` /
 * `data-token-id` attributes emitted by the page views and word rects).
 */
import type { RefObject } from 'react'
import { useReview } from '../../store/ReviewContext'
import { useHoverSync } from '../../hooks/useHoverSync'
import { SourcePageView } from './SourcePageView'
import { ImageCropPopover } from './ImageCropPopover'
import './SourcePane.css'

export interface SourcePaneProps {
  /** Root scrollable element, owned by the integrator's scroll-sync. */
  containerRef: RefObject<HTMLDivElement>
}

export function SourcePane({ containerRef }: SourcePaneProps): JSX.Element | null {
  const { state } = useReview()
  const { hoverTokenId } = useHoverSync()
  const project = state.project
  const projectPath = state.projectPath

  if (!project || !projectPath) return null

  return (
    <div ref={containerRef} className="source-pane-inner">
      {project.pages.map((page) => (
        <SourcePageView
          key={page.index}
          page={page}
          projectPath={projectPath}
          hoverTokenId={hoverTokenId}
          confidenceTint={state.readingPrefs.confidenceTint}
        />
      ))}
      <ImageCropPopover />
    </div>
  )
}
