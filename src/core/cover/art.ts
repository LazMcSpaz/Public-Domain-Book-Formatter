/**
 * What a cover's picture costs in pixels.
 *
 * `SPEC §6` and this codebase have one rule about pixels: **never invent
 * resolution.** A 6×9 front cover at KDP's 300 DPI is 1800 × 2700 pixels, and a
 * picture with fewer prints soft however sharp it looks on screen. So the
 * studio says what a picture needs before one is chosen, computed from the
 * arrangement's own frame (`artFrame`).
 *
 * (Making a picture with an outside image service was built on the cover
 * branch, `claude/cover-front-icons`, and is not on `main`: it is a paid
 * service the owner has not decided on. It would come back with a decision
 * record.)
 *
 * Pure: arithmetic.
 */
import type { Rect } from './geometry'

/**
 * The pixels a picture needs to print at `dpi` across a placed rectangle.
 *
 * Rounded *up*, always. Asking for 1799 pixels where 1800 are needed produces a
 * cover that fails the check by a hair and a person who spends an afternoon
 * finding out why.
 */
export function requiredPixels(
  rect: Pick<Rect, 'width' | 'height'>,
  dpi = 300
): { width: number; height: number; megapixels: number } {
  const width = Math.ceil(rect.width * dpi)
  const height = Math.ceil(rect.height * dpi)
  return { width, height, megapixels: (width * height) / 1_000_000 }
}
