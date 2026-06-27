/**
 * SourcePageView — renders one source page: the full-resolution scan (<img> via
 * `assetUrl`) with an absolutely-overlaid <svg> whose viewBox is the page's
 * pixel dimensions, so the word rects line up at any display scale
 * (`preserveAspectRatio="none"`, 100%x100%). Mousemove is converted to
 * source-image pixel coordinates and fed to hover-sync (SPEC §4).
 */
import { useCallback, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { SourcePage } from '@core/model'
import { assetUrl } from '../../utils/asset-url'
import { useHoverSync } from '../../hooks/useHoverSync'
import { WordOverlay } from './WordOverlay'
import { RegionMarkers } from '../ImageMode/RegionMarkers'

export interface SourcePageViewProps {
  page: SourcePage
  projectPath: string
  hoverTokenId: string | null
  confidenceTint: boolean
}

export function SourcePageView({
  page,
  projectPath,
  hoverTokenId,
  confidenceTint
}: SourcePageViewProps): JSX.Element {
  const { setHoverFromSource, clearHover } = useHoverSync()
  const svgRef = useRef<SVGSVGElement>(null)
  // rAF-gate so we dispatch at most once per frame, not once per pixel.
  const frame = useRef<number | null>(null)

  const handleMouseMove = useCallback(
    (e: MouseEvent<SVGSVGElement>): void => {
      const svg = svgRef.current
      if (!svg) return
      const clientX = e.clientX
      const clientY = e.clientY

      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null

        // Preferred path: map client coords through the SVG CTM, which honors
        // the viewBox (image-pixel space) regardless of CSS display scale.
        let x: number
        let y: number
        const ctm = svg.getScreenCTM()
        if (ctm) {
          const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
          x = pt.x
          y = pt.y
        } else {
          // Fallback: bounding-rect ratio scaled to page pixel dimensions.
          const rect = svg.getBoundingClientRect()
          x = ((clientX - rect.left) / rect.width) * page.width
          y = ((clientY - rect.top) / rect.height) * page.height
        }
        setHoverFromSource(page.index, x, y)
      })
    },
    [page.index, page.width, page.height, setHoverFromSource]
  )

  const handleMouseLeave = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    clearHover()
  }, [clearHover])

  return (
    <div
      className="source-page"
      data-page-index={page.index}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      {page.imagePath ? (
        <img
          className="source-page__img"
          src={assetUrl(projectPath, page.imagePath)}
          alt={`Source page ${page.index + 1}`}
          draggable={false}
        />
      ) : (
        <div className="source-page__placeholder">No image for page {page.index + 1}</div>
      )}
      <svg
        ref={svgRef}
        className="source-page__overlay"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <WordOverlay
          page={page}
          hoverTokenId={hoverTokenId}
          confidenceTint={confidenceTint}
        />
        <RegionMarkers page={page} />
      </svg>
    </div>
  )
}
