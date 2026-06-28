/**
 * KDP export validation (SPEC §10).
 *
 * Honest checks, not pass/fail theater: each surfaces a real concern at an
 * appropriate level. Heavier books need more gutter; images below ~300 effective
 * DPI print muddy; XeLaTeX overfull/bad-break warnings get counted; and the
 * final interior page count is reported prominently (the user needs it for the
 * externally-made cover spine).
 *
 * Pure: derives entirely from its inputs.
 */
import type {
  KdpValidationReport,
  StyleProfile,
  ValidationCheck,
  ValidationLevel
} from '@core/model'
import { parseTrimSize } from './latex-document'

export interface ValidateKdpInput {
  profile: StyleProfile
  pageCount: number
  /** Placed images and their effective DPI at print size (null = unknown). */
  images?: { effectiveDpi: number | null }[]
  /** Surfaced XeLaTeX quality warnings (overfull boxes / bad breaks). */
  warnings: string[]
  /** Whether fonts are embedded in the output PDF (XeLaTeX embeds by default). */
  fontsEmbedded?: boolean
}

/** KDP's recommended minimum target DPI for printed images. */
const MIN_DPI = 300

/** Known KDP trim sizes (inches, width×height). */
const KNOWN_TRIMS: ReadonlyArray<[number, number]> = [
  [5, 8],
  [5.06, 7.81],
  [5.25, 8],
  [5.5, 8.5],
  [6, 9],
  [6.14, 9.21],
  [6.69, 9.61],
  [7, 10],
  [7.44, 9.69],
  [7.5, 9.25],
  [8, 10],
  [8.25, 11],
  [8.5, 11]
]

/**
 * KDP's gutter (inside-margin) guidance scales with page count. Returns the
 * minimum inside margin (in inches) the spine binding requires for a given
 * page count.
 */
export function minGutterForPageCount(pageCount: number): number {
  if (pageCount <= 150) return 0.375
  if (pageCount <= 300) return 0.5
  if (pageCount <= 500) return 0.625
  if (pageCount <= 700) return 0.75
  return 0.875
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.02
}

export function validateKdp(input: ValidateKdpInput): KdpValidationReport {
  const checks: ValidationCheck[] = []

  // 1. Embedded fonts.
  {
    const embedded = input.fontsEmbedded ?? true
    checks.push({
      id: 'fonts-embedded',
      label: 'Embedded fonts',
      level: embedded ? 'ok' : 'warn',
      detail: embedded
        ? 'All fonts are embedded (XeLaTeX embeds by default).'
        : 'Fonts may not be fully embedded — KDP requires embedded fonts.'
    })
  }

  // 2. Known/correct trim size.
  {
    const trim = parseTrimSize(input.profile.trimSize)
    const known = KNOWN_TRIMS.some(([w, h]) => close(trim.widthIn, w) && close(trim.heightIn, h))
    checks.push({
      id: 'trim-size',
      label: 'Trim size',
      level: known ? 'ok' : 'warn',
      detail: known
        ? `Trim ${input.profile.trimSize} (${trim.widthIn}×${trim.heightIn} in) is a recognized KDP size.`
        : `Trim ${input.profile.trimSize} (${trim.widthIn}×${trim.heightIn} in) is not a standard KDP size; confirm it is supported.`
    })
  }

  // 3. Adequate gutter for the final page count.
  {
    const required = minGutterForPageCount(input.pageCount)
    const effective = input.profile.margins.inner + input.profile.gutter
    const adequate = effective >= required - 1e-9
    checks.push({
      id: 'gutter',
      label: 'Gutter for page count',
      level: adequate ? 'ok' : 'fail',
      detail: adequate
        ? `Inside margin ${effective.toFixed(3)} in meets the ${required} in minimum for ${input.pageCount} pages.`
        : `Inside margin ${effective.toFixed(3)} in is below the ${required} in minimum for ${input.pageCount} pages; text may be swallowed by the spine.`
    })
  }

  // 4. Image DPI sufficiency.
  {
    const images = input.images ?? []
    const low = images.filter((i) => i.effectiveDpi !== null && i.effectiveDpi < MIN_DPI)
    const unknown = images.filter((i) => i.effectiveDpi === null)
    let level: ValidationLevel = 'ok'
    let detail: string
    if (images.length === 0) {
      detail = 'No placed images to check.'
    } else if (low.length > 0) {
      level = 'warn'
      detail = `${low.length} image(s) below ${MIN_DPI} DPI at placed size and may print muddy.`
    } else if (unknown.length > 0) {
      level = 'warn'
      detail = `${unknown.length} image(s) have unknown effective DPI; verify they meet ${MIN_DPI} DPI.`
    } else {
      detail = `All ${images.length} image(s) meet ${MIN_DPI} DPI at placed size.`
    }
    checks.push({ id: 'image-dpi', label: 'Image DPI', level, detail })
  }

  // 5. Surfaced LaTeX warnings (overfull boxes / bad breaks).
  {
    const count = input.warnings.length
    checks.push({
      id: 'latex-warnings',
      label: 'Typesetting warnings',
      level: count > 0 ? 'warn' : 'ok',
      detail:
        count > 0
          ? `${count} overfull-box / bad-break warning(s) to resolve or acknowledge.`
          : 'No overfull boxes or bad breaks reported.'
    })
  }

  // 6. Final page count — reported prominently as a check (never a failure).
  checks.push({
    id: 'page-count',
    label: 'Final page count',
    level: 'ok',
    detail: `Final interior page count: ${input.pageCount} pages (use for cover spine width).`
  })

  const ready = !checks.some((c) => c.level === 'fail')

  return {
    checks,
    pageCount: input.pageCount,
    ready
  }
}
