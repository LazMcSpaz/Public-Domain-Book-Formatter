/**
 * Style-profile resolution, normalization, and merging (SPEC §7).
 *
 * Three states: shipped defaults → user tweaks → saved profiles. These helpers
 * move between them safely: `resolveStyle` layers per-book overrides onto a
 * profile, `normalizeStyleProfile` backfills missing fields from defaults when
 * loading saved profiles, and `mergeStyle` applies a shallow patch.
 *
 * Pure: no I/O, no mutation of inputs.
 */
import type {
  Margins,
  PageNumberPosition,
  PerBookConfig,
  RunningHeadMode,
  StyleProfile
} from '@core/model'
import { defaultStyleProfile } from './defaults'

const RUNNING_HEAD_MODES: RunningHeadMode[] = [
  'none',
  'bookTitle',
  'author',
  'chapterTitle',
  'pageNumber'
]

const PAGE_NUMBER_POSITIONS: PageNumberPosition[] = [
  'none',
  'bottomCenter',
  'bottomOuter',
  'topOuter'
]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : fallback
}

/** Deep clone a profile so resolution/merging never mutates inputs. */
function cloneProfile(p: StyleProfile): StyleProfile {
  return {
    ...p,
    margins: { ...p.margins },
    headingStyle: { ...p.headingStyle },
    runningHeads: { ...p.runningHeads },
    ornaments: { ...p.ornaments },
    frontMatter: { ...p.frontMatter }
  }
}

/**
 * Produce the effective style for a book: start from `profile` (or the shipped
 * default when null) and apply per-book overrides. Per SPEC §7, content-specific
 * config can pin certain layout facts — notably the trim size wins for trim.
 */
export function resolveStyle(profile: StyleProfile | null, config: PerBookConfig): StyleProfile {
  const base = cloneProfile(profile ?? defaultStyleProfile())
  if (config.trimSize && config.trimSize.trim().length > 0) {
    base.trimSize = config.trimSize
  }
  return base
}

/**
 * Backfill an untrusted, possibly-partial object (e.g. a saved profile from an
 * older schema) into a complete `StyleProfile`, taking each missing field from
 * the shipped default. Always returns a fresh, fully-populated profile.
 */
export function normalizeStyleProfile(raw: unknown): StyleProfile {
  const d = defaultStyleProfile()
  if (!isRecord(raw)) {
    return d
  }

  const rawMargins = isRecord(raw['margins']) ? raw['margins'] : {}
  const margins: Margins = {
    top: num(rawMargins['top'], d.margins.top),
    bottom: num(rawMargins['bottom'], d.margins.bottom),
    inner: num(rawMargins['inner'], d.margins.inner),
    outer: num(rawMargins['outer'], d.margins.outer)
  }

  const rawHeading = isRecord(raw['headingStyle']) ? raw['headingStyle'] : {}
  const rawRunning = isRecord(raw['runningHeads']) ? raw['runningHeads'] : {}
  const rawOrn = isRecord(raw['ornaments']) ? raw['ornaments'] : {}
  const rawFront = isRecord(raw['frontMatter']) ? raw['frontMatter'] : {}

  return {
    id: str(raw['id'], d.id),
    name: str(raw['name'], d.name),
    trimSize: str(raw['trimSize'], d.trimSize),
    margins,
    gutter: num(raw['gutter'], d.gutter),
    bodyFont: str(raw['bodyFont'], d.bodyFont),
    bodyFontSize: num(raw['bodyFontSize'], d.bodyFontSize),
    headingFont: str(raw['headingFont'], d.headingFont),
    headingStyle: {
      smallCaps: bool(rawHeading['smallCaps'], d.headingStyle.smallCaps),
      centered: bool(rawHeading['centered'], d.headingStyle.centered),
      scale: num(rawHeading['scale'], d.headingStyle.scale)
    },
    runningHeads: {
      verso: oneOf(rawRunning['verso'], RUNNING_HEAD_MODES, d.runningHeads.verso),
      recto: oneOf(rawRunning['recto'], RUNNING_HEAD_MODES, d.runningHeads.recto)
    },
    pageNumber: oneOf(raw['pageNumber'], PAGE_NUMBER_POSITIONS, d.pageNumber),
    ornaments: {
      chapterOpener:
        typeof rawOrn['chapterOpener'] === 'string' ? (rawOrn['chapterOpener'] as string) : null,
      sectionDivider:
        typeof rawOrn['sectionDivider'] === 'string' ? (rawOrn['sectionDivider'] as string) : null,
      pageNumber: typeof rawOrn['pageNumber'] === 'string' ? (rawOrn['pageNumber'] as string) : null
    },
    frontMatter: {
      titlePage: bool(rawFront['titlePage'], d.frontMatter.titlePage),
      copyrightPage: bool(rawFront['copyrightPage'], d.frontMatter.copyrightPage),
      halfTitle: bool(rawFront['halfTitle'], d.frontMatter.halfTitle)
    }
  }
}

/**
 * Apply a shallow patch over a base profile, returning a new profile. Nested
 * objects in the patch fully replace the corresponding base object (callers
 * pass complete nested objects), while top-level scalars override individually.
 */
export function mergeStyle(base: StyleProfile, patch: Partial<StyleProfile>): StyleProfile {
  const next = cloneProfile(base)
  if (patch.id !== undefined) next.id = patch.id
  if (patch.name !== undefined) next.name = patch.name
  if (patch.trimSize !== undefined) next.trimSize = patch.trimSize
  if (patch.gutter !== undefined) next.gutter = patch.gutter
  if (patch.bodyFont !== undefined) next.bodyFont = patch.bodyFont
  if (patch.bodyFontSize !== undefined) next.bodyFontSize = patch.bodyFontSize
  if (patch.headingFont !== undefined) next.headingFont = patch.headingFont
  if (patch.pageNumber !== undefined) next.pageNumber = patch.pageNumber
  if (patch.margins !== undefined) next.margins = { ...next.margins, ...patch.margins }
  if (patch.headingStyle !== undefined) {
    next.headingStyle = { ...next.headingStyle, ...patch.headingStyle }
  }
  if (patch.runningHeads !== undefined) {
    next.runningHeads = { ...next.runningHeads, ...patch.runningHeads }
  }
  if (patch.ornaments !== undefined) next.ornaments = { ...next.ornaments, ...patch.ornaments }
  if (patch.frontMatter !== undefined) {
    next.frontMatter = { ...next.frontMatter, ...patch.frontMatter }
  }
  return next
}
