/**
 * Trim-size parsing for the image editor's DPI badge (SPEC §6 "DPI awareness").
 *
 * The effective-DPI arithmetic itself lives in `@core/image` (`effectiveDpi`,
 * `dpiStatus`); this module only adds what's missing there — turning a per-book
 * trim-size token like "6x9" into a placed content width in inches — so the
 * editor component stays free of parsing logic.
 */

/** KDP's recommended print resolution; the badge warns below this (SPEC §6, §10). */
export const MIN_PRINT_DPI = 300

/**
 * Parse the page width (in inches) from a trim-size token like "6x9".
 * Falls back to a 6" content width when the token is missing/unparseable, a
 * sensible default body width for a typical paperback.
 */
export function trimWidthInches(trimSize: string | undefined, fallback = 6): number {
  if (!trimSize) return fallback
  const m = /([0-9]+(?:\.[0-9]+)?)\s*[x×]/i.exec(trimSize)
  if (!m) return fallback
  const w = Number.parseFloat(m[1])
  return Number.isFinite(w) && w > 0 ? w : fallback
}
