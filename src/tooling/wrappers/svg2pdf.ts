/**
 * SVG → vector-PDF wrapper (SPEC §8).
 *
 * Ornaments ship as SVG but XeLaTeX embeds *vector PDF* most reliably, so on
 * export each chosen ornament is converted with `rsvg-convert -f pdf`. The
 * conversion preserves vectors (no rasterization), keeping flourishes crisp at
 * any print size.
 *
 * Runs through the injectable `CommandRunner` seam so it is fully unit-testable
 * with no `rsvg-convert` installed. Whether the binary is actually present is the
 * dependency detector's concern — this wrapper does not probe for it or throw
 * merely because it is missing.
 */
import { runCommand, type CommandRunner } from '../process'

/** Build the rsvg-convert argv (exported for testability). */
export function buildSvg2PdfArgs(svgPath: string, outPdf: string): string[] {
  return ['-f', 'pdf', '-o', outPdf, svgPath]
}

/**
 * Convert `svgPath` to a vector PDF at `outPdf` via `rsvg-convert`. Resolves with
 * `outPdf` so callers can thread the converted path straight into the build.
 */
export async function svgToPdf(
  svgPath: string,
  outPdf: string,
  run: CommandRunner = runCommand,
): Promise<string> {
  const args = buildSvg2PdfArgs(svgPath, outPdf)
  await run('rsvg-convert', args)
  return outPdf
}
