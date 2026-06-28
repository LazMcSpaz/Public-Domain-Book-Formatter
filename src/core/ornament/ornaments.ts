/**
 * Ornament model (SPEC §8).
 *
 * Ornaments are period-appropriate printer's flourishes shipped as vector SVG
 * files (plus user uploads). On export each chosen SVG is converted to a vector
 * PDF (XeLaTeX embeds vector PDF most reliably) and dropped into the build dir;
 * the LaTeX preamble then `\includegraphics`-es the converted PDF.
 *
 * This module is pure: it exposes the builtin library, looks ornaments up by id,
 * and maps a profile's ornament choices to the converted-PDF paths they will
 * have in the build directory. No I/O, no conversion — that is the orchestrator's
 * job (see `@tooling/export`).
 */
import * as path from 'node:path'
import type { OrnamentChoices, OrnamentRef } from '@core/model'
import manifest from '../../../resources/ornaments/manifest.json'

/** The shipped ornament library, loaded from the resources manifest. */
export const BUILTIN_ORNAMENTS: OrnamentRef[] = manifest as OrnamentRef[]

/** Find an ornament by id within a library, or null if absent. */
export function findOrnament(id: string, library: OrnamentRef[]): OrnamentRef | null {
  return library.find((o) => o.id === id) ?? null
}

/** The converted-PDF paths an ornament selection resolves to in the build dir. */
export interface ResolvedOrnamentPaths {
  chapterOpener: string | null
  sectionDivider: string | null
  pageNumber: string | null
}

/**
 * Swap an ornament's source `.svg` filename for the `.pdf` it becomes after
 * conversion, located under `pdfDir`. Any non-`.svg` filename gets `.pdf`
 * appended-after-replace too, so the path is always a build-dir PDF.
 */
function toPdfPath(file: string, pdfDir: string): string {
  const base = path.basename(file).replace(/\.svg$/i, '') + '.pdf'
  return path.join(pdfDir, base)
}

/**
 * Map a profile's ornament-choice ids to the converted-PDF paths they will have
 * in `pdfDir`. An unset choice (null) or an id missing from `library` passes
 * through as null. Pure.
 */
export function resolveOrnamentPaths(
  choices: OrnamentChoices,
  library: OrnamentRef[],
  pdfDir: string
): ResolvedOrnamentPaths {
  const resolve = (id: string | null): string | null => {
    if (!id) return null
    const ornament = findOrnament(id, library)
    if (!ornament) return null
    return toPdfPath(ornament.file, pdfDir)
  }
  return {
    chapterOpener: resolve(choices.chapterOpener),
    sectionDivider: resolve(choices.sectionDivider),
    pageNumber: resolve(choices.pageNumber)
  }
}
