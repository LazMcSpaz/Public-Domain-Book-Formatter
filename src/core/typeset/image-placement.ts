/**
 * Image placement for export (SPEC §6/§7).
 *
 * Accepted image regions are cropped from the source scan and dropped into the
 * body as centered figures. These pure helpers decide *where* each image goes in
 * the text, *how wide* it prints (never upscaled past its captured size, so it
 * stays at/above the source DPI), and produce the figure LaTeX. The actual
 * cropping (pdftoppm) and file I/O live in the tooling layer; this module is
 * pure so it can be unit-tested without tools.
 */
import type { MappingEntry, StyleProfile } from '@core/model'
import { parseTrimSize } from './latex-document'

/**
 * Available text width in inches for a profile: trim width minus the inner and
 * outer margins and the binding offset (gutter). Images are capped at this so
 * they never run into the margins.
 */
export function textWidthIn(profile: StyleProfile): number {
  const trim = parseTrimSize(profile.trimSize)
  const m = profile.margins
  const w = trim.widthIn - m.inner - m.outer - profile.gutter
  return w > 0 ? w : trim.widthIn
}

/**
 * Print width for a region: its captured pixel width at the source DPI, capped
 * at the text width. Because we never exceed the captured size, the effective
 * print DPI stays at or above `sourceDpi` (typically 300).
 */
export function figureWidthIn(
  regionWidthPx: number,
  sourceDpi: number,
  maxWidthIn: number
): number {
  const dpi = sourceDpi > 0 ? sourceDpi : 300
  const naturalIn = regionWidthPx / dpi
  const capped = Math.min(naturalIn, maxWidthIn)
  // Guard against degenerate/zero regions.
  return capped > 0 ? Number(capped.toFixed(3)) : Number(maxWidthIn.toFixed(3))
}

/**
 * A centered figure including the cropped image at a fixed print width. The
 * `\IfFileExists` guard means a crop that failed to materialize is silently
 * skipped at typeset time rather than hard-failing the whole compile (an export
 * must never break because one illustration couldn't be produced). Emitted as a
 * `figure` environment so Pandoc passes it through as raw LaTeX.
 */
export function figureLatex(relPath: string, widthIn: number): string {
  const w = Number(widthIn.toFixed(3))
  return [
    '\\begin{figure}[htbp]',
    '\\centering',
    `\\IfFileExists{${relPath}}{\\includegraphics[width=${w}in]{${relPath}}}{}`,
    '\\end{figure}'
  ].join('\n')
}

/**
 * The char offset in the markdown at which a page's images should be inserted:
 * just after that page's last mapped token. Returns a map pageIndex → offset.
 * Pages with no mapped tokens are absent (the caller falls back, e.g. to the
 * end of the document).
 */
export function pageTextEndOffsets(entries: MappingEntry[]): Map<number, number> {
  const ends = new Map<number, number>()
  for (const e of entries) {
    const prev = ends.get(e.pageIndex)
    if (prev === undefined || e.output.end > prev) ends.set(e.pageIndex, e.output.end)
  }
  return ends
}
