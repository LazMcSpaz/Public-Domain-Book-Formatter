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
import { DEFAULT_FIGURE_OPACITY } from './figures'
import type { Binding, PaperStock } from './geometry'
import { type CoverLook, type CoverPalette } from './document-look'
export {
  ARRANGEMENTS,
  ARRANGEMENT_LABEL,
  type Arrangement,
  type CoverLook,
  type CoverPalette,
  FRAME_STYLES,
  type FrameStyle,
  type Hex,
  type RuleStyle,
  type TitleCase
} from './document-look'
export { normalizeLook } from './document-normalize'

/** A supplied device, as bytes and the proportions to place it by. */
export interface PressMark {
  /** `data:image/svg+xml;base64,…` or `data:image/png;base64,…`. */
  dataUrl: string
  /** The source's own dimensions, for the aspect ratio. */
  widthPx: number
  heightPx: number
  /** What it is, for the studio to show. */
  fileName: string
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
  /**
   * An edition statement, printed under the title rule when set.
   *
   * "Illustrated", "Second Edition", "Complete and Unabridged" — the line a
   * period title page sets under the rule to say what *this* printing is. It
   * is deliberately not the `series`, which names something the book belongs
   * to and therefore sits above the title, and deliberately not the
   * `subtitle`, which is part of the book's name, sets in italic at a share of
   * the title, and would subordinate a volume name to a printing note.
   *
   * Per book rather than banked, because the second volume of a collection may
   * be illustrated where the first was not.
   */
  edition: string
  /** Back-cover copy. */
  blurb: string
  /** The imprint line, which *is* banked — carried here as resolved text. */
  imprint: string
  /**
   * The ISBN-13 this printing is registered under, or empty for none.
   *
   * Per *printing*, never banked: a paperback and a hardcover of one book have
   * different numbers, which is the whole reason this is content and not look.
   * Empty leaves KDP's own barcode area clear, and KDP prints its own there —
   * a black rectangle on white, which is what carrying one avoids.
   */
  isbn: string
  /**
   * The five-digit add-on, if the barcode carries one.
   *
   * `90000` is the convention on a US book and means "no price encoded",
   * which is what KDP's own barcode prints. Empty omits the add-on entirely,
   * which is equally legal and a little narrower.
   */
  isbnAddOn: string
  art: CoverArt
}

export interface CoverDocument {
  trimSize: string
  /** The interior's measured page count. Sets the spine; never an estimate. */
  pageCount: number
  paper: PaperStock
  /**
   * Paperback or hardcover.
   *
   * On the document rather than the look, because one book is published in
   * both and they are the same design on two different objects — banking it
   * would make a collection's look carry a binding, which is a fact about a
   * printing and not about how the series is drawn.
   */
  binding: Binding
  look: CoverLook
  content: CoverContent
}

export function defaultPalette(): CoverPalette {
  return {
    ground: '#f4efe4',
    ink: '#22201c',
    accent: '#7a2e2e',
    overArt: '#f7f4ec',
    figure: '#22201c'
  }
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
    subtitleSizePt: null,
    authorSizePt: null,
    spineSizePt: null,
    subtitleRatio: null,
    rule: 'single',
    frontFrame: 'none',
    blurbSizePt: null,
    blurbBorder: 'none',
    ornamentId: null,
    authorAtFoot: false,
    spineText: true,
    imprintOnFront: false,
    announceWorks: false,
    pressMark: null,
    frontMark: null,
    markOnFront: false,
    groundPattern: null,
    groundPatternOpacity: null,
    groundFigure: null,
    groundFigureOpacity: DEFAULT_FIGURE_OPACITY,
    groundFigureBack: false,
    groundFigureWrap: false,
    groundFigureToEdge: false,
    groundFigureInFrame: false,
    groundFigureInvert: false
  }
}

export function emptyContent(): CoverContent {
  return {
    title: '',
    works: [],
    subtitle: '',
    author: '',
    series: '',
    edition: '',
    blurb: '',
    imprint: '',
    isbn: '',
    isbnAddOn: '90000',
    art: emptyArt()
  }
}

export function defaultCover(trimSize = '6x9', pageCount = 0): CoverDocument {
  return {
    trimSize,
    pageCount,
    paper: 'bw-cream',
    binding: 'paperback',
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
