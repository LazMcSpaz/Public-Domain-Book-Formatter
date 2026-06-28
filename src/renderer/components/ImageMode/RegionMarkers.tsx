/**
 * RegionMarkers — the accept/reject layer for detected illustration regions
 * (SPEC §6 "Detection (low trust)").
 *
 * Rendered as a <g> inside the SourcePageView's page <svg> (viewBox = page pixel
 * dimensions), so each region's bbox lines up with the scan at any display scale.
 * Detection is a *first guess*, so unreviewed regions get a dashed "candidate"
 * frame with Accept / Reject controls; accepted regions get a solid frame with
 * an "Edit image…" button (opens the non-destructive editor); rejected regions
 * fade to a faint outline so the page stays uncluttered.
 *
 * Controls are real HTML buttons placed via <foreignObject> at the bbox so they
 * are clickable and keyboard-focusable even though they live in SVG space.
 */
import type { ImageRegion, SourcePage } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import './RegionMarkers.css'

export interface RegionMarkersProps {
  page: SourcePage
}

/** Toolbar height (in source-image pixels) reserved under each region frame. */
const TOOLBAR_PX = 64

export function RegionMarkers({ page }: RegionMarkersProps): JSX.Element {
  const { dispatch } = useReview()

  return (
    <g className="region-markers" data-page-index={page.index}>
      {page.regions.map((region) => (
        <RegionMarker
          key={region.id}
          region={region}
          onAccept={() =>
            dispatch({
              type: 'SET_REGION_ACCEPTED',
              pageIndex: page.index,
              regionId: region.id,
              accepted: true
            })
          }
          onReject={() =>
            dispatch({
              type: 'SET_REGION_ACCEPTED',
              pageIndex: page.index,
              regionId: region.id,
              accepted: false
            })
          }
          onReset={() =>
            dispatch({
              type: 'SET_REGION_ACCEPTED',
              pageIndex: page.index,
              regionId: region.id,
              accepted: null
            })
          }
          onEdit={() =>
            dispatch({
              type: 'OPEN_IMAGE_EDITOR',
              pageIndex: page.index,
              regionId: region.id
            })
          }
        />
      ))}
    </g>
  )
}

interface RegionMarkerProps {
  region: ImageRegion
  onAccept: () => void
  onReject: () => void
  onReset: () => void
  onEdit: () => void
}

function RegionMarker({
  region,
  onAccept,
  onReject,
  onReset,
  onEdit
}: RegionMarkerProps): JSX.Element {
  const { x0, y0, x1, y1 } = region.bbox
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const w = Math.max(0, Math.abs(x1 - x0))
  const h = Math.max(0, Math.abs(y1 - y0))

  const status = region.accepted === null ? 'candidate' : region.accepted ? 'accepted' : 'rejected'

  const frameClass = `region-marker__frame region-marker__frame--${status}`

  // Place the toolbar just below the frame, clamped so it never reads upside-down
  // or off the top. Sized in page-pixel space to match the viewBox.
  const toolbarY = y + h + 4

  return (
    <g className="region-marker" data-region-id={region.id} data-status={status}>
      <rect className={frameClass} x={x} y={y} width={w} height={h} rx={2} />

      <foreignObject
        x={x}
        y={toolbarY}
        width={Math.max(w, 240)}
        height={TOOLBAR_PX}
        className="region-marker__fo"
      >
        <div className="region-toolbar" data-status={status}>
          {status === 'candidate' && (
            <>
              <span className="region-toolbar__label" title="Auto-detected — please confirm">
                Possible image (auto-detected)
              </span>
              <span className="region-toolbar__actions">
                <button type="button" className="region-btn region-btn--accept" onClick={onAccept}>
                  Accept
                </button>
                <button type="button" className="region-btn region-btn--reject" onClick={onReject}>
                  Reject
                </button>
              </span>
            </>
          )}

          {status === 'accepted' && (
            <>
              <span className="region-toolbar__label">Image</span>
              <span className="region-toolbar__actions">
                <button type="button" className="region-btn region-btn--edit" onClick={onEdit}>
                  Edit image…
                </button>
                <button type="button" className="region-btn region-btn--ghost" onClick={onReset}>
                  Unconfirm
                </button>
              </span>
            </>
          )}

          {status === 'rejected' && (
            <span className="region-toolbar__actions">
              <button type="button" className="region-btn region-btn--ghost" onClick={onReset}>
                Restore region
              </button>
            </span>
          )}
        </div>
      </foreignObject>
    </g>
  )
}
