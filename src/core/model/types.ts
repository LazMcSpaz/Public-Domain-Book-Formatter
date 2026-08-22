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

// ---------------------------------------------------------------------------
// Per-book config (SPEC §7)
// ---------------------------------------------------------------------------

/**
 * Content-specific, never reused across books (SPEC §7). The other half of the
 * two-level separation: everything here is a fact about *this* book, so none of
 * it may be banked into a `StyleProfile`.
 */
export interface PerBookConfig {
  title: string
  author: string
  isbn: string | null
  editionDate: string | null
  /** Trim size token, e.g. "6x9". */
  trimSize: string
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
  /**
   * Open each chapter's first paragraph with a large initial (a drop cap).
   * Traditional in reprints of early-modern books, and mutually intelligible
   * with — not exclusive of — a chapter-opener ornament.
   */
  dropCap: boolean
  /**
   * First-line indent of a paragraph, in ems of the body size.
   *
   * Was a constant in the paginator, which made the most ordinary typographic
   * preference there is — how far a paragraph steps in — the one thing nobody
   * could change. Zero gives the block-paragraph look, which wants
   * `paragraphSpacing` above zero to stay readable.
   */
  paragraphIndentEms: number
  /**
   * Blank space between paragraphs, in ems. Normally zero in a book: the indent
   * does the work and spacing as well as an indent reads as a manuscript.
   */
  paragraphSpacingEms: number
  /**
   * Break words at the margin. On for justified text, where the alternative is
   * rivers of white space — but a real preference, and some editors will not
   * have it at any price.
   */
  hyphenate: boolean
  /**
   * Hang punctuation past the margin so the *ink* lines up rather than the box.
   *
   * The cheapest thing that makes set text look set rather than typed. Applied
   * after line breaking, so switching it changes no break and no page count —
   * only where the last glyph of some lines sits.
   */
  opticalMargins: boolean
  /**
   * Start every chapter on a right-hand page, inserting a blank verso where
   * needed. Traditional, and it costs paper: a book of short chapters can gain
   * thirty leaves this way.
   */
  chaptersOpenRecto: boolean
  pageNumber: PageNumberPosition
  /**
   * Set each chapter's description under its contents entry, where the original
   * book printed one.
   *
   * An analytical contents — this book's own name for it is "SYNOPSIS OF THE
   * LESSONS" — gives a paragraph under each chapter saying what is in it, and
   * that paragraph is the reason such a page is read rather than scanned. It is
   * recovered from the scanned contents, which is otherwise discarded for its
   * stale page numbers alone.
   *
   * A preference, not a fact about the book: the descriptions are long, and a
   * contents that was one leaf becomes four. Does nothing on a book whose
   * contents had no descriptions to recover.
   */
  contentsSynopsis: boolean
  ornaments: OrnamentChoices
  /** Front-matter visual toggles. */
  frontMatter: {
    titlePage: boolean
    copyrightPage: boolean
    halfTitle: boolean
  }
}

// ---------------------------------------------------------------------------
// KDP export validation (SPEC §10)
// ---------------------------------------------------------------------------

/**
 * `pending` is not a soft warning — it means the check has not been run yet
 * (typically because the book has not been typeset). Reporting it as `ok` would
 * be a green tick nothing earned, and as `warn` would cry wolf.
 */
export type ValidationLevel = 'ok' | 'warn' | 'fail' | 'pending'

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
