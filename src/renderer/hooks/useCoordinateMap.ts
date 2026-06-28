/**
 * useCoordinateMap — thin convenience accessor for the coordinate-map lookup
 * index (SPEC §4 backbone). The reducer rebuilds `state.coordinateMap` whenever
 * a project loads, so consumers never construct it themselves; this hook just
 * surfaces it (or null before a project is open).
 */
import { useReview } from '../store/ReviewContext'
import type { CoordinateIndex } from '@core/model'

export function useCoordinateMap(): CoordinateIndex | null {
  return useReview().state.coordinateMap
}
