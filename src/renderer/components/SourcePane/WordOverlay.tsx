/**
 * WordOverlay — the per-word <rect> layer drawn inside the page SVG (SPEC §4).
 *
 * Rects are positioned in source-image pixel space, so they sit inside an SVG
 * whose viewBox is the page's pixel dimensions and which is stretched over the
 * <img>. Each rect carries `data-token-id` and `data-page-index` so the
 * integrator's scroll-sync can scan them. Hover / active-flag highlighting is
 * applied imperatively (`is-hover` / `is-active-token` classes toggled by
 * `renderer/highlight.ts`), so hovering never re-renders these rects. When
 * confidence tinting is on, every rect is tinted by OCR confidence.
 */
import { memo } from 'react'
import type { SourcePage } from '@core/model'

export interface WordOverlayProps {
  page: SourcePage
  /** Whether confidence tinting is enabled (SPEC §4, off by default). */
  confidenceTint: boolean
}

/** Tint class by confidence band; null = no tint fill. */
function confidenceClass(confidence: number): string | null {
  if (confidence < 60) return 'word-rect--low'
  if (confidence < 90) return 'word-rect--mid'
  return null
}

// Memoized: a page's rects only change with the tint toggle, not on hover.
export const WordOverlay = memo(function WordOverlay({
  page,
  confidenceTint
}: WordOverlayProps): JSX.Element {
  return (
    <g className="word-overlay">
      {page.words.map((word) => {
        const { x0, y0, x1, y1 } = word.bbox
        const tintClass = confidenceTint ? confidenceClass(word.confidence) : null

        const classes = ['word-rect']
        if (tintClass) classes.push(tintClass)

        return (
          <rect
            key={word.id}
            data-token-id={word.id}
            data-page-index={page.index}
            className={classes.join(' ')}
            x={Math.min(x0, x1)}
            y={Math.min(y0, y1)}
            width={Math.max(0, Math.abs(x1 - x0))}
            height={Math.max(0, Math.abs(y1 - y0))}
          />
        )
      })}
    </g>
  )
})
