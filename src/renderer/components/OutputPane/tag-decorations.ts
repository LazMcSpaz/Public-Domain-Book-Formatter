/**
 * tag-decorations — builds a fast per-token decoration lookup from the project's
 * structural tags (SPEC §5), consumed by the OutputPane to decorate WordSpans.
 *
 * A tag's `range` is a half-open `[start, end)` into the markdown; a token
 * (also `[start, end)`) is "covered" when it overlaps that range. The token
 * whose range contains a tag's `start` carries the type badge. The active tag's
 * covered tokens are flagged so the pane can highlight them more strongly.
 *
 * Kept pure (no React) so it's cheap to memoize and easy to reason about.
 */
import type { StructuralTag, StructuralTagType } from '@core/model'

export interface TokenDecoration {
  types: StructuralTagType[]
  badgeType: StructuralTagType | null
  active: boolean
}

/**
 * Lookup over the tags: given a token's `[start, end)`, return its decoration or
 * undefined when no tag touches it. Overlap test is half-open on both sides.
 */
export interface DecorationIndex {
  at(start: number, end: number): TokenDecoration | undefined
}

export function buildDecorationIndex(
  tags: readonly StructuralTag[],
  activeTagId: string | null
): DecorationIndex {
  if (tags.length === 0) {
    return { at: () => undefined }
  }

  return {
    at(start: number, end: number): TokenDecoration | undefined {
      let types: StructuralTagType[] | null = null
      let badgeType: StructuralTagType | null = null
      let active = false

      for (const tag of tags) {
        const { start: ts, end: te } = tag.range
        // Half-open overlap: token [start,end) intersects tag [ts,te).
        if (end <= ts || start >= te) continue

        if (!types) types = []
        if (!types.includes(tag.type)) types.push(tag.type)

        // Badge sits on the token whose range contains the tag's start offset.
        if (badgeType === null && ts >= start && ts < end) badgeType = tag.type

        if (tag.id === activeTagId) active = true
      }

      if (!types) return undefined
      return { types, badgeType, active }
    }
  }
}
