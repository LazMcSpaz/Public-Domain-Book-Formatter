/**
 * WordSpan — one mapped output word in the output pane (SPEC §4, §5).
 *
 * Carries the data attributes the integrator's scroll-sync scans
 * (`data-start`/`data-end`/`data-token-id`) plus `data-conf` for CSS-driven
 * confidence tinting (gated under `.tint-on`). Hover / active-flag highlighting
 * is applied imperatively (the `is-hover` / `is-active-token` classes toggled by
 * `renderer/highlight.ts`), so hovering never re-renders this component. Dims/
 * strikes when its token id is dirty (edited → mapping stale).
 *
 * Structural tags (SPEC §5) decorate the word non-destructively: every covering
 * tag type adds a `word-span--tag-<type>` class (colored left-border / underline
 * via CSS), the word covering a tag's start renders a small type badge, and the
 * active tag's words get `word-span--tag-active` for a stronger highlight. None
 * of this changes the text content, so contentEditable inline editing and the
 * parent's caret-preservation logic keep working unchanged.
 *
 * Hover originates here via `setHoverFromOutput(entry.output.start)`; the pane
 * itself clears hover on leave.
 */
import type { MappingEntry, StructuralTagType } from '@core/model'
import { TAG_META } from '../Tagging/tag-meta'

/** Per-token structural-tag decoration data, computed once in OutputPane. */
export interface TagDecoration {
  /** Tag types covering this token. */
  types: StructuralTagType[]
  /** Badge to render at this token (the type whose tag starts here), or null. */
  badgeType: StructuralTagType | null
  /** True when this token is covered by the currently-active tag. */
  active: boolean
}

export interface WordSpanProps {
  entry: MappingEntry
  text: string
  /** OCR confidence 0–100 for this token (defaults high when no OCR flag). */
  confidence: number
  /** True when this token's text was edited and its mapping is stale. */
  isDirty: boolean
  /** Structural-tag decoration for this token, if any. */
  decoration?: TagDecoration
  onHover: (offset: number) => void
}

export function WordSpan({
  entry,
  text,
  confidence,
  isDirty,
  decoration,
  onHover
}: WordSpanProps): JSX.Element {
  const classes = ['word-span']
  if (confidence < 60) classes.push('word-span--conf-low')
  else if (confidence < 90) classes.push('word-span--conf-mid')
  if (isDirty) classes.push('word-span--dirty')

  if (decoration) {
    for (const type of decoration.types) classes.push(`word-span--tag-${type}`)
    if (decoration.active) classes.push('word-span--tag-active')
  }

  const badge =
    decoration?.badgeType != null ? (
      <span
        className="tag-badge"
        contentEditable={false}
        style={{ background: TAG_META[decoration.badgeType].color }}
      >
        {TAG_META[decoration.badgeType].badge}
      </span>
    ) : null

  return (
    <span
      className={classes.join(' ')}
      data-token-id={entry.tokenId}
      data-start={entry.output.start}
      data-end={entry.output.end}
      data-conf={confidence}
      onMouseEnter={() => onHover(entry.output.start)}
    >
      {badge}
      {text}
    </span>
  )
}
