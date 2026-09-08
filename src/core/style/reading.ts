/**
 * The book's own design, as numbers a reading column can be set from.
 *
 * ## The line this does not cross
 *
 * **The preview is the PDF, and there is still no second renderer.** The engine
 * lays the book out and pdf-lib writes it; `PageBrowser` renders those bytes.
 * Nothing here draws a page, claims a page, or lets anything downstream believe
 * it has seen one — a reflowing column in a browser cannot break lines where
 * Knuth–Plass broke them or pages where the paginator broke them, and a view
 * that implied otherwise would make the design gate's approval worthless.
 *
 * What it *can* do, honestly, is wear the book's clothes. A typeface, a size
 * relationship, a leading ratio, a first-line indent, a centred small-capital
 * chapter opening and a measure of so many characters are all properties of the
 * **design**, not of any one page, and reading a book set in a face and measure
 * it will not be printed in is reading a different book. That is what this
 * carries across: the design, not the layout.
 *
 * The distinction is exactly the one `PLAN-editor.md` already draws for the
 * galley's page markers — data from the engine is honest, an approximation of
 * the engine is not. So every number below is read from the profile or from the
 * engine's own constants (`LEADING_RATIO`, `frameFor`), never chosen to look
 * about right.
 *
 * Pure: arithmetic over a `StyleProfile`.
 */
import { LEADING_RATIO, frameFor } from '@core/layout'
import type { StyleProfile } from '@core/model'

/** What a reading column needs in order to be set like the book. */
export interface ReadingStyle {
  /** The family's own name — what the face loader fetches. */
  bodyFontName: string
  headingFontName: string
  /** The body face, with a fallback stack for before the file has loaded. */
  bodyFamily: string
  headingFamily: string
  /** Baseline-to-baseline as a multiple of the type size — the engine's own. */
  lineHeight: number
  /**
   * The printed measure, in ems of the body size.
   *
   * The one number that makes a screen read like the book rather than merely
   * look like it. A 6×9 page with the shipped margins sets about 33 ems to the
   * line, and a column given the same 33 ems breaks at the same *words* even
   * though it cannot break at the same points — so the paragraph has the shape
   * it will have on paper. Expressed in ems rather than inches because the
   * point size belongs to the paper and the proportion belongs to the design:
   * nobody wants 11pt type held at arm's length on a tablet.
   */
  measureEms: number
  /** First-line indent, in ems. Zero is the block-paragraph look. */
  indentEms: number
  /** Space between paragraphs, in ems. Normally zero in a book. */
  spacingEms: number
  /** Justified, as the engine sets it, or ragged right. */
  justify: boolean
  /** Break words at the margin. */
  hyphenate: boolean
  /** Top-level heading size, as a multiple of the body size. */
  headingScale: number
  headingSmallCaps: boolean
  headingCentered: boolean
  /** Open a chapter's first paragraph with a large initial. */
  dropCap: boolean
}

/**
 * Fallbacks for each family, so the column is set in *something* bookish while
 * the real file loads and on any device that refuses it.
 *
 * Named rather than a single generic stack because the faces differ in colour:
 * substituting a modern for a Garamond is a visible change of book, and the
 * nearest system serif is a better lie than the browser's default.
 */
const FALLBACKS: Record<string, string> = {
  'EB Garamond': "'EB Garamond', Garamond, 'Iowan Old Style', Georgia, serif",
  Cardo: "Cardo, 'Palatino Linotype', Palatino, Georgia, serif",
  'IM FELL English': "'IM FELL English', 'Iowan Old Style', Georgia, serif",
  'Libre Baskerville': "'Libre Baskerville', Baskerville, Georgia, serif",
  'Libre Caslon Text': "'Libre Caslon Text', 'Big Caslon', Georgia, serif",
  'Crimson Pro': "'Crimson Pro', 'Iowan Old Style', Georgia, serif",
  Junicode: "Junicode, 'EB Garamond', Georgia, serif"
}

/** The family with its fallbacks, quoted for CSS. */
export function familyStack(name: string): string {
  return FALLBACKS[name] ?? `'${name.replace(/'/gu, '')}', Georgia, serif`
}

/**
 * Read a profile as the design a column should be set in.
 *
 * `frameFor` is the engine's own frame calculation rather than a second copy of
 * the trim-and-margin arithmetic — the measure a reader sees and the measure the
 * book prints have to come from one place, or the column quietly stops matching
 * the book the day a margin changes.
 */
export function readingStyle(profile: StyleProfile): ReadingStyle {
  const frame = frameFor(profile, 'recto')
  const size = profile.bodyFontSize > 0 ? profile.bodyFontSize : 11
  return {
    bodyFontName: profile.bodyFont,
    headingFontName: profile.headingFont,
    bodyFamily: familyStack(profile.bodyFont),
    headingFamily: familyStack(profile.headingFont),
    lineHeight: LEADING_RATIO,
    measureEms: frame.widthPt / size,
    indentEms: Math.max(0, profile.paragraphIndentEms),
    spacingEms: Math.max(0, profile.paragraphSpacingEms),
    // The engine sets justified with Knuth–Plass; a ragged column would be a
    // different book on the page, so this follows the profile rather than
    // preferring whichever reads better on a screen.
    justify: true,
    hyphenate: profile.hyphenate,
    headingScale: profile.headingStyle.scale,
    headingSmallCaps: profile.headingStyle.smallCaps,
    headingCentered: profile.headingStyle.centered,
    dropCap: profile.dropCap
  }
}
