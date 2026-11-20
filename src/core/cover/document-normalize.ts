/**
 * Reading a look back from anything (a banked record, a hand-written spec),
 * so an old or partial one cannot half-apply.
 *
 * Pure.
 */
import {
  GROUND_PATTERNS,
  MAX_PATTERN_OPACITY,
  MIN_PATTERN_OPACITY,
  type GroundPattern
} from './patterns'
import { figureOpacity, GROUND_FIGURES, type GroundFigure } from './figures'
import { ARRANGEMENTS, type CoverLook, FRAME_STYLES, type Hex } from './document-look'
import { type PressMark, defaultLook } from './document'

export const HEX = /^#[0-9a-f]{6}$/i

export function hex(v: unknown, fallback: Hex): Hex {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/**
 * Backfill an untrusted, possibly-old look into a complete one.
 *
 * Same contract as `normalizeStyleProfile`: always returns something whole, and
 * takes each missing field from the shipped default. A banked look outlives the
 * version of the app that banked it, and a collection whose second volume
 * failed to open because a field was added is a collection that stops.
 */
export function normalizeLook(raw: unknown): CoverLook {
  const d = defaultLook()
  if (!isRecord(raw)) return d
  const rawPalette = isRecord(raw['palette']) ? raw['palette'] : {}
  const size = raw['titleSizePt']
  const subtitleSize = raw['subtitleSizePt']
  const authorSize = raw['authorSizePt']
  const spineSize = raw['spineSizePt']
  const subtitleRatio = raw['subtitleRatio']
  const blurbSize = raw['blurbSizePt']
  const positive = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  return {
    arrangement: oneOf(raw['arrangement'], ARRANGEMENTS, d.arrangement),
    palette: {
      ground: hex(rawPalette['ground'], d.palette.ground),
      ink: hex(rawPalette['ink'], d.palette.ink),
      accent: hex(rawPalette['accent'], d.palette.accent),
      overArt: hex(rawPalette['overArt'], d.palette.overArt),
      // The ink is the fallback, not the shipped default: a look banked before
      // this role existed had its figure drawn in whatever ink it carried, and
      // taking the default here would repaint it.
      figure: hex(rawPalette['figure'], hex(rawPalette['ink'], d.palette.ink))
    },
    titleFont: str(raw['titleFont'], d.titleFont),
    authorFont: str(raw['authorFont'], d.authorFont),
    bodyFont: str(raw['bodyFont'], d.bodyFont),
    titleCase: oneOf(raw['titleCase'], ['as-typed', 'upper', 'small-caps'] as const, d.titleCase),
    titleSizePt: positive(size),
    subtitleSizePt: positive(subtitleSize),
    authorSizePt: positive(authorSize),
    spineSizePt: positive(spineSize),
    subtitleRatio: positive(subtitleRatio),
    rule: oneOf(raw['rule'], ['none', 'single', 'double', 'ornamented'] as const, d.rule),
    frontFrame: oneOf(raw['frontFrame'], FRAME_STYLES, d.frontFrame),
    blurbSizePt: positive(blurbSize),
    blurbBorder: oneOf(raw['blurbBorder'], FRAME_STYLES, d.blurbBorder),
    ornamentId: typeof raw['ornamentId'] === 'string' ? raw['ornamentId'] : null,
    authorAtFoot: bool(raw['authorAtFoot'], d.authorAtFoot),
    spineText: bool(raw['spineText'], d.spineText),
    imprintOnFront: bool(raw['imprintOnFront'], d.imprintOnFront),
    announceWorks: bool(raw['announceWorks'], d.announceWorks),
    pressMark: normalizeMark(raw['pressMark']),
    frontMark: normalizeMark(raw['frontMark']),
    markOnFront: bool(raw['markOnFront'], d.markOnFront),
    groundPattern: (GROUND_PATTERNS as readonly string[]).includes(raw['groundPattern'] as string)
      ? (raw['groundPattern'] as GroundPattern)
      : null,
    // Clamped here as well as where it is read, so a stored look holds a
    // number a press can print rather than one that is corrected on the way
    // out — `normalizeLook` of a normalized look has to be itself.
    groundPatternOpacity:
      typeof raw['groundPatternOpacity'] === 'number' &&
      Number.isFinite(raw['groundPatternOpacity'])
        ? Math.min(MAX_PATTERN_OPACITY, Math.max(MIN_PATTERN_OPACITY, raw['groundPatternOpacity']))
        : d.groundPatternOpacity,
    groundFigure: (GROUND_FIGURES as readonly string[]).includes(raw['groundFigure'] as string)
      ? (raw['groundFigure'] as GroundFigure)
      : null,
    groundFigureOpacity: figureOpacity(
      typeof raw['groundFigureOpacity'] === 'number'
        ? raw['groundFigureOpacity']
        : d.groundFigureOpacity
    ),
    groundFigureBack: bool(raw['groundFigureBack'], d.groundFigureBack),
    groundFigureInFrame: bool(raw['groundFigureInFrame'], d.groundFigureInFrame),
    groundFigureInvert: bool(raw['groundFigureInvert'], d.groundFigureInvert),
    groundFigureOnRule: bool(raw['groundFigureOnRule'], d.groundFigureOnRule),
    groundFigureWrap: bool(raw['groundFigureWrap'], d.groundFigureWrap),
    groundFigureToEdge: bool(raw['groundFigureToEdge'], d.groundFigureToEdge)
  }
}

/**
 * Read a stored mark back, or nothing.
 *
 * Strict about the data URL's scheme for one reason: this string is handed
 * straight to an `Image`, and a look is a thing that can be shared between
 * people. `data:` is the only scheme that cannot reach off the machine.
 */
export function normalizeMark(raw: unknown): PressMark | null {
  if (!isRecord(raw)) return null
  const dataUrl = raw['dataUrl']
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const width = raw['widthPx']
  const height = raw['heightPx']
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!(width > 0) || !(height > 0)) return null
  return {
    dataUrl,
    widthPx: width,
    heightPx: height,
    fileName: str(raw['fileName'], 'the press mark')
  }
}
