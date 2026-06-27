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
  | 'footnote'
  | 'blockquote'
  | 'verse'
  | 'heading'
  | 'table'
  | 'epigraph'
  | 'caption'
  | 'frontmatter'

export interface StructuralTag {
  id: string
  type: StructuralTagType
  range: OutputRange
  /** Type-specific payload, e.g. footnote ref mark, heading level. */
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Non-destructive image edits (SPEC §6)
// ---------------------------------------------------------------------------

export interface ImageEditOp {
  op: string
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
  tags: StructuralTag[]
  imageEdits: ImageEditDescriptor[]
  config: PerBookConfig
  findReplace: FindReplaceRule[]
  readingProgress: ReadingProgress
}
