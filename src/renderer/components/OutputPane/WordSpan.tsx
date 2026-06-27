/**
 * WordSpan — one mapped output word in the output pane (SPEC §4).
 *
 * Carries the data attributes the integrator's scroll-sync scans
 * (`data-start`/`data-end`/`data-token-id`) plus `data-conf` for CSS-driven
 * confidence tinting (gated under `.tint-on`). Highlights when it is the hovered
 * token; dims/strikes when its token id is dirty (edited → mapping stale).
 *
 * Hover originates here via `setHoverFromOutput(entry.output.start)`; the pane
 * itself clears hover on leave.
 */
import type { MappingEntry } from '@core/model'

export interface WordSpanProps {
  entry: MappingEntry
  text: string
  /** OCR confidence 0–100 for this token (defaults high when no OCR flag). */
  confidence: number
  /** True when this token is the one currently hovered (either pane). */
  isHovered: boolean
  /** True when this token's text was edited and its mapping is stale. */
  isDirty: boolean
  onHover: (offset: number) => void
}

export function WordSpan({
  entry,
  text,
  confidence,
  isHovered,
  isDirty,
  onHover
}: WordSpanProps): JSX.Element {
  const classes = ['word-span']
  if (confidence < 60) classes.push('word-span--conf-low')
  else if (confidence < 90) classes.push('word-span--conf-mid')
  if (isHovered) classes.push('word-span--hover')
  if (isDirty) classes.push('word-span--dirty')

  return (
    <span
      className={classes.join(' ')}
      data-token-id={entry.tokenId}
      data-start={entry.output.start}
      data-end={entry.output.end}
      data-conf={confidence}
      onMouseEnter={() => onHover(entry.output.start)}
    >
      {text}
    </span>
  )
}
