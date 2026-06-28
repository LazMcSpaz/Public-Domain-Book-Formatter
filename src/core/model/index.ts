/**
 * Public surface of the core domain model.
 *
 * Types come from `types.ts` (the shared contract). Runtime implementations
 * (the CoordinateMap class + factory) are re-exported here once added by the
 * core-model module so consumers can import everything from `@core/model`.
 */
export * from './types'
export * from './coordinate-map'
