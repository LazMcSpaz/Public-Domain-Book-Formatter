/**
 * Resolve a flag to the token id it should highlight / scroll to (SPEC §4).
 *
 * OCR flags carry a `tokenId` directly. Heuristic flags may carry a `tokenId`
 * and/or an output `range`; when only a range is present we resolve the token
 * that owns the range's start via the coordinate map. Returns null when nothing
 * resolves (the caller then simply doesn't jump).
 */
import type { CoordinateIndex, Flag } from '@core/model'

export function flagTokenId(flag: Flag, map: CoordinateIndex | null): string | null {
  if (flag.kind === 'ocr') return flag.tokenId
  if (flag.tokenId) return flag.tokenId
  if (flag.range) return map?.atOutputOffset(flag.range.start)?.tokenId ?? null
  return null
}
