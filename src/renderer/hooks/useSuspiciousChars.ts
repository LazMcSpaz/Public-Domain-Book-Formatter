/**
 * useSuspiciousChars — memoized suspicious-character scan over the given
 * markdown (SPEC §4). Re-scans only when the markdown changes, so panels can
 * surface live results without rescanning on every render.
 */
import { useMemo } from 'react'
import type { Flag } from '@core/model'
import { scanSuspiciousChars } from '../utils/suspicious-chars'

export function useSuspiciousChars(markdown: string): Flag[] {
  return useMemo(() => scanSuspiciousChars(markdown), [markdown])
}
