/**
 * What a cover *is*, before anything has been placed.
 *
 * The same split the interior runs on, applied to the outside of the book:
 * a **look** that is banked and reused across a collection, and the **content**
 * of one book — its title, its blurb, its picture. SPEC §7's two levels, on the
 * cover.
 *
 * That split is the whole reason this file exists rather than a free canvas.
 * A drag-and-drop editor makes book two of a series a fresh act of design; an
 * arrangement plus a palette plus a picture makes it one question ("same look
 * as the others?") and three fields. The app interviews you.
 *
 * Pure data and its normalizer. No pixels here — art travels as an id, exactly
 * as `ImageItem` does in the layout engine, and for the same reasons.
 */
import type { ImageEditOp } from '@core/model'
import type { PaperStock } from './geometry'

/**
 * How the front cover is arranged.
 *
 * Deliberately a small closed set. Each is a *typographic tradition* rather
 * than a slot layout, and each degrades sensibly when there is no picture —
 * which matters, because a cover with no art at all is a legitimate and often
 * better answer for a public-domain reprint.
 */
export type Arrangement =
  /** Type centred in the upper third, picture below, rule between. The default. */
  | 'classic-centered'
  /** A framed window of art with the type above and below it, panel borders. */
  | 'plate-window'
  /** A solid band across the top carrying the type, art filling the rest. */
  | 'banded'
  /** Art bled to every edge, type over it in a legible plate. */
  | 'full-bleed'
  /** No picture at all: type, rule and ornament, in the jobbing-printer manner. */
  | 'typographic'

export const ARRANGEMENTS: readonly Arrangement[] = [
  'classic-centered',
  'plate-window',
  'banded',
  'full-bleed',
  'typographic'
]

export const ARRANGEMENT_LABEL: Readonly<Record<Arrangement, string>> = {
  'classic-centered': 'Classic — type above, picture below',
  'plate-window': 'Plate in a window, type around it',
  banded: 'Banded — a title panel over the art',
  'full-bleed': 'Full-bleed art with the type over it',
  typographic: 'Typographic — no picture'
}

/** How a title is set. */
export type TitleCase = 'as-typed' | 'upper' | 'small-caps'

/** A colour as `#rrggbb`. Kept as a string so a profile stays plain JSON. */
export type Hex = string

export interface CoverPalette {
  /** The cover's ground. */
  ground: Hex
  /** Type and rules. */
  ink: Hex
  /** A second colour for rules, bands and ornament. */
  accent: Hex
  /**
   * Ink used where type sits over the picture rather than the ground — which
   * is a different decision, and the one that goes wrong most often.
   */
  overArt: Hex
}

/** A rule under or around the type. */
export type RuleStyle = 'none' | 'single' | 'double' | 'ornamented'

/**
 * The reusable look — what a *collection* shares.
 *
 * Everything here is deliberately free of one book's facts. Nothing in this
 * object names a title, a page count or a picture, which is what makes banking
 * it safe: applying a banked look to the next volume can only change how it
 * looks, never what it says. `BANKED_COVER_KEYS` in `profile.ts` enforces that
 * rather than trusting it.
 */
export interface CoverLook {
  arrangement: Arrangement
  palette: CoverPalette
  /** Family names as `StyleProfile` names them, so the same faces are offered. */
  titleFont: string
  authorFont: string
  /** Back-cover copy and the imprint line. */
  bodyFont: string
  titleCase: TitleCase
  /**
   * Title size in points, or `null` to fit it to the measure.
   *
   * Null is the default and the recommendation: a fitted title is the one
   * setting that makes a five-word title and a fifteen-word title both look
   * deliberate, and a collection of reprints has both.
   */
  titleSizePt: number | null
  rule: RuleStyle
  /** Ornament id from the shipped library, or null. */
  ornamentId: string | null
  /** Whether the spine carries the title and author (thickness permitting). */
  spineText: boolean
  /** Whether the imprint prints at the foot of the front cover. */
  imprintOnFront: boolean
}

/** Where a cover's picture came from — recorded, always, and printed on request. */
export type ArtProvenance =
  /** A plate cut out of this book's own scan. */
  | { kind: 'plate'; pageIndex: number; caption: string }
  /** A file the user supplied. */
  | { kind: 'upload'; fileName: string }
  /**
   * Made by a model.
   *
   * The model, the prompt and the seed are kept because a cover is a public
   * artefact with a claim attached — that this is a faithful reprint of an old
   * book — and a generated picture on it is a thing a reader is entitled to
   * know about. Keeping the record costs a few hundred bytes and makes the
   * credit line in `describeProvenance` a fact rather than a memory.
   */
  | { kind: 'generated'; model: string; prompt: string; seed: number | null }

export interface CoverArt {
  /** Stable id; the renderer resolves pixels by it. Null when there is no art. */
  id: string | null
  /** Source pixel dimensions, for the DPI check. Never guessed — measured. */
  sourceWidthPx: number
  sourceHeightPx: number
  provenance: ArtProvenance | null
  /**
   * The retouching stack, re-applied over the original pixels every time.
   *
   * The same list the interior's illustrations carry, deliberately: a plate
   * that needs straightening on the cover needs the same straightening inside,
   * and one op engine means one set of results.
   */
  ops: ImageEditOp[]
  /** Whether the art fills its frame (cropping) or fits inside it (letterboxing). */
  fit: 'cover' | 'contain'
}

export function emptyArt(): CoverArt {
  return { id: null, sourceWidthPx: 0, sourceHeightPx: 0, provenance: null, ops: [], fit: 'cover' }
}

/** One book's facts. Never banked. */
export interface CoverContent {
  title: string
  /**
   * The works bound in this volume, when it holds more than one.
   *
   * Empty for an ordinary book, where the volume *is* the work and `title` says
   * so. Two or more entries make it an omnibus, and the composer then sets them
   * at **equal weight** with a rule between and a lowercase italic conjunction,
   * which is what a publisher binding two treatises together actually did.
   *
   * The alternative — putting the second work in `subtitle` — is what this
   * exists to prevent. A subtitle sets smaller and italic, which subordinates
   * the second work to the first, and that is a claim about the book that is
   * simply false. The other way it goes wrong is worse and is the reason the
   * whole category reads as cheap: `2 BOOKS IN 1` on a banner. That is a
   * bundle. This is an edition.
   *
   * `title` stays the volume's own name for metadata and the file name, so a
   * listing and a cover can differ where they should.
   */
  works: string[]
  subtitle: string
  author: string
  /** Series or collection name, printed above the title when set. */
  series: string
  /** Back-cover copy. */
  blurb: string
  /** The imprint line, which *is* banked — carried here as resolved text. */
  imprint: string
  art: CoverArt
}

export interface CoverDocument {
  trimSize: string
  /** The interior's measured page count. Sets the spine; never an estimate. */
  pageCount: number
  paper: PaperStock
  look: CoverLook
  content: CoverContent
}

export function defaultPalette(): CoverPalette {
  return { ground: '#f4efe4', ink: '#22201c', accent: '#7a2e2e', overArt: '#f7f4ec' }
}

export function defaultLook(): CoverLook {
  return {
    arrangement: 'classic-centered',
    palette: defaultPalette(),
    titleFont: 'EB Garamond',
    authorFont: 'EB Garamond',
    bodyFont: 'EB Garamond',
    titleCase: 'small-caps',
    titleSizePt: null,
    rule: 'single',
    ornamentId: null,
    spineText: true,
    imprintOnFront: false
  }
}

export function emptyContent(): CoverContent {
  return {
    title: '',
    works: [],
    subtitle: '',
    author: '',
    series: '',
    blurb: '',
    imprint: '',
    art: emptyArt()
  }
}

export function defaultCover(trimSize = '6x9', pageCount = 0): CoverDocument {
  return {
    trimSize,
    pageCount,
    paper: 'bw-cream',
    look: defaultLook(),
    content: emptyContent()
  }
}

/**
 * How many works a volume announces, in words.
 *
 * Derived rather than typed. A field would be one more thing to keep in step
 * with the list beside it, and the one failure mode — a cover reading "TWO
 * WORKS" over three titles — is exactly the sort of small wrongness that makes
 * a reader doubt everything else on the page.
 */
export function worksLabel(count: number): string {
  const words = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six']
  const word = words[count] ?? String(count)
  return `${word} Works`.toUpperCase()
}

/** A credit line for the art, in the words a reader would want. */
export function describeProvenance(p: ArtProvenance | null): string | null {
  if (!p) return null
  switch (p.kind) {
    case 'plate':
      return `Cover illustration from the original edition, page ${p.pageIndex + 1}.`
    case 'upload':
      return `Cover illustration supplied by the editor (${p.fileName}).`
    case 'generated':
      return `Cover illustration generated with ${p.model}.`
  }
}

const HEX = /^#[0-9a-f]{6}$/i

function hex(v: unknown, fallback: Hex): Hex {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
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
  return {
    arrangement: oneOf(raw['arrangement'], ARRANGEMENTS, d.arrangement),
    palette: {
      ground: hex(rawPalette['ground'], d.palette.ground),
      ink: hex(rawPalette['ink'], d.palette.ink),
      accent: hex(rawPalette['accent'], d.palette.accent),
      overArt: hex(rawPalette['overArt'], d.palette.overArt)
    },
    titleFont: str(raw['titleFont'], d.titleFont),
    authorFont: str(raw['authorFont'], d.authorFont),
    bodyFont: str(raw['bodyFont'], d.bodyFont),
    titleCase: oneOf(raw['titleCase'], ['as-typed', 'upper', 'small-caps'] as const, d.titleCase),
    titleSizePt: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null,
    rule: oneOf(raw['rule'], ['none', 'single', 'double', 'ornamented'] as const, d.rule),
    ornamentId: typeof raw['ornamentId'] === 'string' ? raw['ornamentId'] : null,
    spineText: bool(raw['spineText'], d.spineText),
    imprintOnFront: bool(raw['imprintOnFront'], d.imprintOnFront)
  }
}
