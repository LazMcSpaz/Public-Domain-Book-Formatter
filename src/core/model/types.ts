/**
 * Canonical domain types for the Public-Domain Book Reprint Tool.
 *
 * This file is the shared contract between the app shell, the core engine, and
 * the tooling/pipeline. It contains *types only* (no runtime logic) so that every
 * module can compile against a single source of truth. Implementations
 * (coordinate-map queries, hOCR parsing, persistence) live in sibling files.
 *
 * Design principle from SPEC §4: be honest about trust. OCR confidence is a real
 * number; everything the cleanup/structure layers assert is a *heuristic flag*,
 * never dressed up as a probability. The `Flag` union below enforces that split.
 */

// ---------------------------------------------------------------------------
// Geometry — source-image pixel coordinates
// ---------------------------------------------------------------------------

/** Axis-aligned bounding box in source-image pixel space (top-left origin). */
export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

// ---------------------------------------------------------------------------
// The backbone: per-word OCR records (SPEC §2 "hOCR coordinate mapping")
// ---------------------------------------------------------------------------

/**
 * A single OCR'd word. The atomic unit of the coordinate mapping. Retains its
 * source-image position and the engine's true confidence so the review
 * instrument can do hover-sync, confidence tinting, and source-image-on-hover.
 */
export interface WordToken {
  /** Stable unique id (e.g. "p0_w12"). Survives serialization. */
  id: string
  text: string
  /** Bounding box in the source page image. */
  bbox: BBox
  /** Zero-based index of the source page this word came from. */
  pageIndex: number
  /** Tesseract per-word confidence, 0–100. A real probability (SPEC §4). */
  confidence: number
}

/**
 * A candidate illustration region detected by layout analysis. Low trust by
 * design (SPEC §6): `accepted` is null until a human reviews it.
 */
export interface ImageRegion {
  id: string
  pageIndex: number
  bbox: BBox
  /** null = unreviewed candidate, true = kept, false = rejected. */
  accepted: boolean | null
}

/** One source page: its rendered image plus everything OCR found on it. */
export interface SourcePage {
  index: number
  /** Path to the extracted full-resolution page image, relative to the project. */
  imagePath: string | null
  /** Pixel dimensions of the source image. */
  width: number
  height: number
  /** Effective DPI of the source image, if known (drives §6 DPI warnings). */
  dpi: number | null
  words: WordToken[]
  regions: ImageRegion[]
}

/** The OCR'd source document, before cleanup/typesetting. */
export interface SourceDocument {
  /** Absolute or project-relative path to the original PDF. */
  pdfPath: string
  pageCount: number
  pages: SourcePage[]
}

// ---------------------------------------------------------------------------
// Coordinate mapping (source <-> formatted output)
// ---------------------------------------------------------------------------

/** A character-offset range within the cleaned/markdown output text. */
export interface OutputRange {
  /** Inclusive start char offset. */
  start: number
  /** Exclusive end char offset. */
  end: number
}

/**
 * Links one source `WordToken` to its location in the cleaned/markdown output.
 * The serialized form of the coordinate map is just `MappingEntry[]`; the
 * `CoordinateMap` class (see coordinate-map.ts) builds fast lookups over it.
 */
export interface MappingEntry {
  tokenId: string
  pageIndex: number
  bbox: BBox
  /** Where this token's text landed in the output. */
  output: OutputRange
}

/**
 * Read-only query surface over the coordinate map. This is the interface every
 * Phase-2 review feature (hover-sync, scroll-sync, click-to-jump,
 * source-image-on-hover) consumes. Implemented by the `CoordinateMap` class in
 * coordinate-map.ts; constructed via `createCoordinateMap(entries)`.
 */
export interface CoordinateIndex {
  /** All entries, in output order. */
  readonly entries: readonly MappingEntry[]
  /** Source-pane hover: which token sits under this page-image point. */
  atPoint(pageIndex: number, x: number, y: number): MappingEntry | null
  /** Output-pane hover/scroll: which token owns this output char offset. */
  atOutputOffset(offset: number): MappingEntry | null
  /** Output-pane selection: every token overlapping an output range. */
  inOutputRange(range: OutputRange): MappingEntry[]
  /** Direct lookup by token id. */
  byTokenId(id: string): MappingEntry | null
  /** Serialize back to the plain array stored in the project file. */
  toJSON(): MappingEntry[]
}

// ---------------------------------------------------------------------------
// Flags — honest tiers (SPEC §4)
// ---------------------------------------------------------------------------

/** What produced a heuristic flag. */
export type HeuristicSource = 'cleanup' | 'structure' | 'typeset'

/**
 * A review signal. Discriminated so real numbers and heuristics can never be
 * confused: only `kind: 'ocr'` carries a confidence number.
 */
export type Flag =
  | {
      kind: 'ocr'
      tokenId: string
      /** 0–100 engine confidence. */
      confidence: number
    }
  | {
      kind: 'heuristic'
      source: HeuristicSource
      /** Human-readable label, e.g. "de-hyphenated", "probable heading". */
      label: string
      /** Optional anchor to a token and/or an output range. */
      tokenId?: string
      range?: OutputRange
    }

// ---------------------------------------------------------------------------
// Structural tags (SPEC §5)
// ---------------------------------------------------------------------------

export type StructuralTagType =
  'footnote' | 'blockquote' | 'verse' | 'heading' | 'table' | 'epigraph' | 'caption' | 'frontmatter'

export interface StructuralTag {
  id: string
  type: StructuralTagType
  range: OutputRange
  /** Type-specific payload, e.g. footnote ref mark, heading level. */
  data?: Record<string, unknown>
}

/**
 * A probable heading found by structure detection (SPEC §12 #11). Low-trust: the
 * user confirms it in review, which promotes it to a `heading` StructuralTag.
 */
export interface HeadingCandidate {
  /** Output range of the heading text in `ProjectFile.markdown`. */
  range: OutputRange
  /** Verbatim heading text. */
  text: string
  /** Heuristic nesting level (1 = top). */
  level: number
  /** Page the heading was found on. */
  pageIndex: number
}

/**
 * One auto-generated table-of-contents entry (SPEC §7). Built from confirmed
 * heading tags in document order. The *edition* page number is filled in after
 * typesetting (Phase 4); during review only the output offset is known.
 */
export interface TocEntry {
  title: string
  level: number
  /** Char offset of the heading in `ProjectFile.markdown`. */
  outputOffset: number
  /** Final printed page number, set after typesetting; null until then. */
  pageNumber: number | null
}

// ---------------------------------------------------------------------------
// Non-destructive image edits (SPEC §6)
// ---------------------------------------------------------------------------

/**
 * Known non-destructive edit operations (SPEC §6). The image engine applies an
 * ordered op list over the original pixels, so the source is never mutated.
 * `crop`/`rotate`/`straighten`/`grayscale`/`threshold`/`despeckle` are the
 * reliable tools; `removeBackground` is best-effort with a tolerance param.
 */
export type ImageEditOpKind =
  | 'crop'
  | 'rotate'
  | 'straighten'
  | 'brightness'
  | 'contrast'
  | 'levels'
  | 'curves'
  | 'grayscale'
  | 'threshold'
  | 'despeckle'
  | 'removeBackground'

export interface ImageEditOp {
  op: ImageEditOpKind
  params: Record<string, number | string | boolean>
}

/** Edits for one region, always re-derivable from the original pixels. */
export interface ImageEditDescriptor {
  regionId: string
  ops: ImageEditOp[]
}

// ---------------------------------------------------------------------------
// Per-book config & review state (SPEC §7, §9)
// ---------------------------------------------------------------------------

/** Content-specific, never reused across books (SPEC §7). */
export interface PerBookConfig {
  title: string
  author: string
  isbn: string | null
  editionDate: string | null
  /** Trim size token, e.g. "6x9". */
  trimSize: string
}

/** A saved find-replace rule applied throughout the book (SPEC §4). */
export interface FindReplaceRule {
  id: string
  find: string
  replace: string
  /** Treat `find` as a regular expression. */
  regex: boolean
  note?: string
}

/** Reading-progress persistence — distinct from edit state (SPEC §9). */
export interface ReadingProgress {
  /** Page the user last read to. */
  lastPageIndex: number
  /** Pages marked "reviewed/approved". */
  approvedPages: number[]
}

// ---------------------------------------------------------------------------
// Style system & typesetting (SPEC §7, §8) — the reusable look
// ---------------------------------------------------------------------------

/** Page margins in inches. `inner` is the spine/gutter side. */
export interface Margins {
  top: number
  bottom: number
  inner: number
  outer: number
}

/** What a running head shows on a given page side (SPEC §8). */
export type RunningHeadMode = 'none' | 'bookTitle' | 'author' | 'chapterTitle' | 'pageNumber'

/** Where/how page numbers are set. */
export type PageNumberPosition = 'none' | 'bottomCenter' | 'bottomOuter' | 'topOuter'

/** A reusable ornament (printer's flourish / rule / fleuron), SPEC §8. */
export interface OrnamentRef {
  id: string
  name: string
  /** `page` = repeats across the book; `chapter` = once per chapter opener; `divider` = section break. */
  kind: 'page' | 'chapter' | 'divider'
  source: 'builtin' | 'user'
  /** Path to the ornament's vector file (SVG source or converted PDF). */
  file: string
}

/** Ornament selections for a profile. Any may be null (no ornament). */
export interface OrnamentChoices {
  chapterOpener: string | null
  sectionDivider: string | null
  pageNumber: string | null
}

/**
 * The reusable *look*, divorced from content (SPEC §7). Banked once and applied
 * across books/series. Shipped defaults → user tweaks → saved profiles.
 */
export interface StyleProfile {
  id: string
  name: string
  /** Trim size token, e.g. "6x9". */
  trimSize: string
  margins: Margins
  /** Extra inner margin added for binding, in inches. */
  gutter: number
  bodyFont: string
  bodyFontSize: number
  headingFont: string
  /** Heading style knobs (LaTeX-friendly). */
  headingStyle: {
    smallCaps: boolean
    centered: boolean
    /** Scale factor relative to body size for top-level headings. */
    scale: number
  }
  runningHeads: {
    verso: RunningHeadMode
    recto: RunningHeadMode
  }
  pageNumber: PageNumberPosition
  ornaments: OrnamentChoices
  /** Front-matter visual toggles. */
  frontMatter: {
    titlePage: boolean
    copyrightPage: boolean
    halfTitle: boolean
  }
}

/** Templated front/back-matter fill-ins, content-specific (SPEC §7). */
export interface FrontMatterFields {
  isbn: string | null
  publicationDate: string | null
  editionStatement: string | null
  imprint: string | null
  copyrightHolder: string | null
  /** Extra free-text lines for the copyright page. */
  notices: string[]
}

// ---------------------------------------------------------------------------
// KDP export validation (SPEC §10)
// ---------------------------------------------------------------------------

export type ValidationLevel = 'ok' | 'warn' | 'fail'

export interface ValidationCheck {
  id: string
  label: string
  level: ValidationLevel
  detail: string
}

/** The export readiness report; honest checks, not pass/fail theater (SPEC §10). */
export interface KdpValidationReport {
  checks: ValidationCheck[]
  /** Final interior page count — input for the user's externally-made spine. */
  pageCount: number
  /** True when no check is at 'fail'. */
  ready: boolean
}

/** Result of an export run. */
export interface ExportResult {
  pdfPath: string | null
  pageCount: number
  validation: KdpValidationReport
}

// ---------------------------------------------------------------------------
// Project file (SPEC §9) — the save/resume unit
// ---------------------------------------------------------------------------

/**
 * The full serializable state of a book project. Persisted as a manifest
 * (`project.json`) alongside an assets directory (page images, etc.).
 * `schemaVersion` drives migration on load.
 */
export interface ProjectFile {
  schemaVersion: number
  source: {
    pdfPath: string
    pageCount: number
  }
  pages: SourcePage[]
  /**
   * The cleaned, formatted output text (Markdown intermediate, SPEC §3). This is
   * what the review instrument renders in the output pane; every `MappingEntry`'s
   * `output` range indexes into char offsets of this string.
   */
  markdown: string
  /** Serialized coordinate map. */
  coordinateMap: MappingEntry[]
  flags: Flag[]
  /**
   * Token ids the user has reviewed and marked "good" (SPEC §4). Their flags are
   * hidden from the flag list and skipped by jump-to-next-flag, and their
   * confidence tint is suppressed — so a vetted word stops drawing attention.
   */
  resolvedTokenIds: string[]
  tags: StructuralTag[]
  imageEdits: ImageEditDescriptor[]
  config: PerBookConfig
  findReplace: FindReplaceRule[]
  readingProgress: ReadingProgress
  /** Id of the applied saved style profile (SPEC §7); null = shipped default. */
  styleProfileId: string | null
  /** Templated front/back-matter content for this book (SPEC §7). */
  frontMatter: FrontMatterFields
}
