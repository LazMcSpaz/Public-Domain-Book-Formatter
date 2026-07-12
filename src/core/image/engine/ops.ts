/**
 * Typed constructors for the non-destructive image ops (SPEC §6). These build
 * plain `ImageEditOp` records (the persisted, serializable form). The pixel
 * application of each op lives in apply-ops.ts. Keeping the op *kinds* and their
 * params defined here gives the UI a stable, typed way to append edits.
 *
 * Reliable tools: crop, rotate, straighten, brightness, contrast, levels,
 * curves, grayscale, threshold, despeckle. Best-effort: removeBackground.
 */
import type { ImageEditOp } from '@core/model'

export interface CropParams {
  x: number
  y: number
  width: number
  height: number
}
export const crop = (p: CropParams): ImageEditOp => ({ op: 'crop', params: { ...p } })

/** Rotate by a fixed quarter-turn-friendly angle (degrees, clockwise). */
export const rotate = (degrees: number): ImageEditOp => ({ op: 'rotate', params: { degrees } })

/** Fine de-skew (small degrees, clockwise) to straighten a crooked scan. */
export const straighten = (degrees: number): ImageEditOp => ({
  op: 'straighten',
  params: { degrees }
})

/** Brightness delta, -100..100. */
export const brightness = (amount: number): ImageEditOp => ({
  op: 'brightness',
  params: { amount }
})

/** Contrast delta, -100..100. */
export const contrast = (amount: number): ImageEditOp => ({ op: 'contrast', params: { amount } })

/** Levels: map input black/white points (0..255) with a gamma (>0). */
export interface LevelsParams {
  black: number
  white: number
  gamma: number
}
export const levels = (p: LevelsParams): ImageEditOp => ({ op: 'levels', params: { ...p } })

/**
 * Curves: a tone curve given as control points serialized to JSON (params values
 * must be primitive, so the point array is stringified). Each point is
 * `[inputValue, outputValue]` in 0..255.
 */
export const curves = (points: ReadonlyArray<[number, number]>): ImageEditOp => ({
  op: 'curves',
  params: { points: JSON.stringify(points) }
})

export const grayscale = (): ImageEditOp => ({ op: 'grayscale', params: {} })

/** Binarize at a luminance threshold (0..255) — crisp line art / engravings. */
export const threshold = (level: number): ImageEditOp => ({ op: 'threshold', params: { level } })

/** Despeckle: remove isolated specks within `radius` px (scan-noise cleanup). */
export const despeckle = (radius: number): ImageEditOp => ({
  op: 'despeckle',
  params: { radius }
})

/**
 * Best-effort background removal: flood from the corners, clearing pixels within
 * `tolerance` (0..255) of the sampled background to transparent. Honest about
 * limits (SPEC §6) — reliable on clean uniform backgrounds only.
 */
export const removeBackground = (tolerance: number): ImageEditOp => ({
  op: 'removeBackground',
  params: { tolerance }
})
