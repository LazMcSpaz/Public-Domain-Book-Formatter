/**
 * ImageMode barrel (SPEC §6). The integrator mounts `ImageEditor` at the review
 * root (it reads `state.activeImageRegion` and renders null when closed).
 * `RegionMarkers` is mounted by the SourcePane's page view, but is exported here
 * too for any consumer that needs it directly.
 */
export { ImageEditor } from './ImageEditor'
export { RegionMarkers } from './RegionMarkers'
export type { RegionMarkersProps } from './RegionMarkers'
