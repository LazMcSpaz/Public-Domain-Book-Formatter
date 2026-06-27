/**
 * DPI awareness for placed images (SPEC §6 print quality).
 *
 * KDP wants ~300 DPI. When an illustration's source pixels are stretched across
 * a placed physical size, the effective DPI drops; we warn before it prints
 * muddy. Pure arithmetic.
 */

/**
 * Effective DPI of a source dimension placed at a physical size.
 * @param sourcePixels source resolution along one axis (px)
 * @param placedInches placed size along that axis (inches)
 */
export function effectiveDpi(sourcePixels: number, placedInches: number): number {
  if (placedInches <= 0) return 0
  return sourcePixels / placedInches
}

/** 'ok' at/above target, 'warn' below it (default target 300 DPI). */
export function dpiStatus(dpi: number, target = 300): 'ok' | 'warn' {
  return dpi >= target ? 'ok' : 'warn'
}
