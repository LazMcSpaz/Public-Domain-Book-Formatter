/**
 * Flowing a book onto pages.
 *
 * This is the one pass that owns the finished page: it turns a `BookDocument`
 * and a `StyleProfile` into `LaidOutPage[]`, which the PDF writer draws and the
 * preview renders. There is no second layout anywhere, so what the user
 * approves at the design gate is what the exported file contains.
 *
 * Two properties are load-bearing and deliberate:
 *
 * 1. **It is a pure function of its inputs.** Both of the circular problems
 *    still to come — a footnote whose height changes where its reference falls,
 *    and a table of contents whose page numbers only exist after layout — are
 *    then solved by *running it again* with different inputs, rather than by
 *    threading mutable state through the flow.
 * 2. **It sets on a baseline grid.** Every line, heading and gap is a whole
 *    number of slots, which is how a book is actually set (facing pages line
 *    up) and what makes widow and orphan control integer arithmetic instead of
 *    accumulated floating-point.
 *
 * Pure: no DOM, no I/O. Text measurement arrives through `TextMeasurer`.
 */
import type { StyleProfile } from '@core/model'
import { findOrnament, type OrnamentArt } from '@core/ornament'
import { headingRunEnd } from '@core/assemble'
import type { BookBlock, BookDocument, BookSection, Illustration } from '@core/assemble'
import { effectiveDpi } from '@core/image'
import { rebaseRanges, shiftRanges, type SubscriptRange } from '@core/transcribe'
import {
  breakParagraph,
  breakVerse,
  fontForWord,
  type Alignment,
  type Attachment,
  type BrokenLine,
  type TextSpan
} from './break-lines'
import { prepareFootnotes, type NoteReference, type PreparedNote } from './footnotes'
import { anchorIllustrations } from './illustrations'
import { typographicQuotes, withTypographicQuotes } from './quotes'
import {
  bottomFolioBaseline,
  frameFor,
  leadingFor,
  linesPerFrame,
  runningHeadBaseline,
  trimToPoints
} from './frames'
import type { TextMeasurer } from './measure'
import { hangPunctuation } from './optical'
import {
  PT_PER_INCH,
  type FontRef,
  type FontStyle,
  type LaidOutBook,
  type LayoutWarning,
  type PageKind,
  type LaidOutPage,
  type PageFrame,
  type PageItem,
  type PageSection,
  type PageSide,
  type PlacedImage,
  type PositionedLine,
  type TextRun
} from './types'

/** The edition facts the page furniture needs. */
/**
 * One work on a title page that carries more than one.
 *
 * A reprint that binds two books together has no way to say so otherwise: set
 * from `title` alone it reads as a single book with a run-on name, which is
 * what "The Human Aura and The Astral World" looked like. Each work gets its
 * own line, its own rule under it, and its own subtitle, the way the originals
 * were set.
 */
export interface TitlePageWork {
  title: string
  subtitle?: string | null
}

export interface LayoutEdition {
  title: string
  author: string
  /**
   * The three lines this period put above a title: what the book is one of,
   * and the publisher's motto under it. Optional, and drawn only on a title
   * page that has room — they belong inside the ruled border.
   */
  seriesLine?: string | null
  epigraph?: string | null
  /**
   * The works bound in this volume. One or none means the title page is set
   * from `title` as before; two or more are set in turn, joined by "and".
   */
  works?: TitlePageWork[]
  /** A line under the imprint — what the imprint is for. */
  imprintLine?: string | null
  imprint?: string | null
  copyrightHolder?: string | null
  isbn?: string | null
  editionDate?: string | null
  editionStatement?: string | null
  notices?: string[]
}

export interface LayoutOptions {
  edition: LayoutEdition
  /** Splits words at legal hyphenation points. Omit to set without hyphenation. */
  hyphenate?: (word: string) => string[]
  /**
   * Lay out only the first N body pages. The design preview needs four pages,
   * not four hundred, and paying for the whole book on every radio-button
   * change would make the gate unusable.
   */
  maxBodyPages?: number
  /**
   * What to do with a note whose reference mark is nowhere in the body.
   *
   * `omit` leaves it out — it cannot be set at the foot of a page, because
   * there is no page to attach it to. `collect` gathers them into a short
   * back-matter section instead, which is the structure gate's other answer and
   * the only way the author's words survive at all.
   *
   * Either way they are reported. Default `omit`.
   */
  orphanNotes?: 'omit' | 'collect'
  /**
   * Contents entries to set in the front matter. Omit for no contents page.
   *
   * The folios are supplied by the caller because they only exist after a
   * layout has been run — see `layoutWithToc`, which runs this function twice.
   */
  toc?: readonly TocLine[]
}

/** One line of the table of contents. */
/** One topic line under a contents entry, and the place it points at. */
export interface TocTopic {
  text: string
  /** The block whose page this entry's number is. */
  blockId: string
  /** The measured folio, or null on the first pass when it isn't known yet. */
  folio: string | null
}

export interface TocLine {
  /** The heading this entry is, so its folio can be matched back by identity. */
  id: string
  title: string
  /**
   * The chapter's number, where the book prints one over the title.
   *
   * Set on the same line as the title in the contents — "LESSON I. THE ASTRAL
   * SENSES." — rather than on a line of its own. A contents is a list of
   * places to go, and giving each entry two lines doubles its length to say
   * nothing the one line did not.
   */
  label?: string
  level: number
  /** The printed folio, or null on the first pass when it isn't known yet. */
  folio: string | null
  /**
   * The chapter's description from the original contents, where the book had
   * one and the style asks for it.
   *
   * Safe for the two-pass scheme because it comes from the *document*, not from
   * a layout: it is identical in both passes, so it cannot change the contents'
   * length between them. The guard in `layoutWithToc` checks that rather than
   * trusting it.
   */
  synopsis?: string
  /**
   * The topics the original analytical contents listed under this entry.
   *
   * Each names a block, and the folio beside it is filled in by the second pass
   * exactly as the entry's own is — see `layoutWithToc`. `folio` is null on the
   * first pass and the line is set either way, which is what keeps the two
   * passes the same length: the number sits in a lane reserved whether or not
   * there is a number to put in it.
   */
  topics?: readonly TocTopic[]
}

/** The heading over collected endnotes, and the contents entry for them. */
export const ENDNOTES_TITLE = 'Notes'

/** How far a chapter title sinks from the top of its page, in line slots. */
const CHAPTER_SINK_SLOTS = 4
/** Blank slots between a chapter title and the first line of its text. */
const CHAPTER_GAP_SLOTS = 2
/** Lines a drop capital spans. Three is the traditional depth. */
const DROP_CAP_LINES = 3
/** Gap between a drop capital and the text beside it, as a fraction of its size. */
const DROP_CAP_GAP_RATIO = 0.06

/** Footnotes are set smaller than the body, as a fraction of the body size. */
const NOTE_SIZE_RATIO = 0.82
/** Baseline-to-baseline within a note, as a fraction of the note size. */
const NOTE_LEADING_RATIO = 1.22
/** The separator rule's length, as a fraction of the measure. */
const NOTE_RULE_WIDTH_RATIO = 0.28
const NOTE_RULE_THICKNESS = 0.5
/** Space between the last body line and the separator rule, in body leadings. */
const NOTE_RULE_GAP_ABOVE = 0.7
/** Space between the rule and the first note line, in note sizes. */
const NOTE_RULE_GAP_BELOW = 0.9
/** A reference mark's size and lift, as fractions of the text it sits in. */
const MARK_SIZE_RATIO = 0.62
const MARK_RISE_RATIO = 0.33
/** Gap between a note's mark and its text, as a fraction of the note size. */
const NOTE_HANG_GAP_RATIO = 0.35

/**
 * How wide a chapter ornament is set, as a fraction of the measure.
 *
 * Under half: a flourish that runs the full width of the text block competes
 * with the title above it instead of sitting under it.
 */
const ORNAMENT_WIDTH_RATIO = 0.45

/**
 * How far a list is indented from the measure, and how far its marker hangs
 * back out of that indent.
 *
 * A list item was set flush, so "12. The chirurgeon examined…" wrapped with the
 * second line hard under the "1" and there was no way to see where one item
 * ended and the next began. Hanging the marker is what a printed list does, and
 * it costs one negative first-line indent.
 */
const LIST_INDENT_EMS = 2.4
const LIST_HANG_EMS = 1.4

/**
 * A table is set a little smaller than the body it interrupts.
 *
 * Not for the sake of fitting — the columns are measured and fitted either way
 * — but because a table is apparatus rather than prose, and matching the body
 * size exactly makes a page of figures shout over the text around it.
 */
const TABLE_SIZE_RATIO = 0.92
/** Space between columns, in ems of the table's own size. */
const TABLE_GUTTER_EMS = 1.4
/** The narrowest a column may be squeezed, in ems, before it is left to overflow. */
const TABLE_MIN_COLUMN_EMS = 2.5
const TABLE_RULE_THICKNESS = 0.5
/** How far a table's rule sits below the baseline it hangs from, in ems. */
const TABLE_RULE_DROP_EMS = 0.34

/** A caption is set smaller than the body, and in italic, as captions are. */
const CAPTION_SIZE_RATIO = 0.85

/**
 * How big a chapter's number is set beside its name.
 *
 * Smaller than the title, which is the ordinary relation: "LESSON I." announces
 * which chapter this is, and "THE ASTRAL SENSES." says what it is about, so the
 * second is the one the eye should land on.
 */
const SUPERSCRIPTION_SIZE_RATIO = 0.55

/**
 * How wide the mark on a blank verso is set, as a fraction of the measure.
 *
 * Smaller than a chapter's. That leaf carries nothing else, so the mark is
 * doing the work of a dinkus rather than of a heading rule, and at the chapter
 * width it reads as the top of a chapter opening that never arrives.
 */
const BLANK_PAGE_ORNAMENT_RATIO = 0.34

/** How wide the title page's divider ornament is set, as a fraction of the measure. */
const TITLE_ORNAMENT_WIDTH_RATIO = 0.3
/** Blank slots between an illustration and the caption under it. */
const CAPTION_GAP_SLOTS = 1
/** Blank slots above and below an illustration set in the text flow. */
const IMAGE_SPACE_SLOTS = 1
/**
 * How tall an illustration may be before it stops sharing a page.
 *
 * Past roughly three-fifths of the frame, whatever text fits around it is a
 * stub — two or three lines stranded above a picture, which reads worse than
 * the picture having the leaf to itself. Old books made the same call and
 * called the result a plate.
 */
const PLATE_HEIGHT_RATIO = 0.62
/**
 * White between a run-around figure and the text beside it, in ems of the
 * body size. Measured off the leaf this was built for: the column stopped an
 * em short of the engraving, which is also the gap a reader expects.
 */
const BESIDE_GUTTER_EMS = 1
/**
 * How much of the measure the text beside a figure must keep.
 *
 * Below three-tenths a column is a few words a line, which is not text run
 * beside a picture but a picture with a ragged fringe. Such a figure is set
 * on a line of its own instead, and the fallback is reported.
 */
const BESIDE_MIN_TEXT_RATIO = 0.3

/**
 * A block turned into placeable lines, with the rules about where it may break.
 * Line x offsets are relative to the *frame*, not the page, because the frame
 * moves between verso and recto and the breaking does not.
 */
interface Flowable {
  lines: FlowLine[]
  /**
   * The block this was built from, so the layout can report which page each
   * block opens on — the fact the editor's page markers are drawn from. The
   * one engine measures; nothing else estimates.
   */
  blockId?: string
  /** Empty slots before this item; dropped when it lands at the top of a page. */
  spaceBefore: number
  spaceAfter: number
  /** Forces a new recto page — a chapter opening. */
  startsChapter: boolean
  chapter: { id: string; title: string; level: number } | null
  /** Must not be the last thing on a page: a heading needs text under it. */
  keepWithNext: boolean
  /** Apply widow and orphan control when this item is split across pages. */
  orphanControl: boolean
  /**
   * Never split across pages — move the whole thing rather than part of it.
   *
   * A paragraph broken over a page break is normal typesetting; a picture
   * broken over one is not a picture. This is what an illustration and its
   * caption travel on.
   */
  unbreakable?: boolean
  /** Take a page of its own, as a printed plate does. */
  ownPage?: boolean
  /**
   * Which part of the book the pages this opens belong to.
   *
   * Defaults to `body`. Front matter that *flows* — an introduction, a preface
   * — is placed by the same loop as the body and differs only in this, which is
   * what gives it roman numerals: `folioFor` switches on the page's section, not
   * on where the page falls.
   */
  pageSection?: PageSection
  /**
   * How tall the *drawn* content is, in points, for an item that takes its own
   * page. Slots are whole and a picture's height is not, so centring by slot
   * count alone leaves it visibly high on the leaf; this is the real height to
   * centre against.
   */
  contentHeightPt?: number
  /**
   * Something the builder could not do as asked, reported against the page
   * this lands on. A placement that had to fall back is not a fault in the
   * book, but it is a decision the engine took for the editor and must not
   * take in silence.
   */
  warning?: string
}

interface FlowLine {
  runs: TextRun[]
  /** Extra runs drawn with this line but not part of its text (a drop capital). */
  decorations?: TextRun[]
  /** The line does not fit its measure; reported once its page is known. */
  overfull?: boolean
  /** Notes referenced by this line, which must be set at the foot of its page. */
  noteIds?: string[]
  /**
   * A flourish drawn at this slot instead of text. It flows through the slot
   * machinery like any other line, so it is carried to the next page with the
   * title it belongs to rather than being stranded by itself.
   */
  ornament?: {
    art: OrnamentArt
    widthPt: number
  }
  /**
   * An illustration drawn at this slot. Like the ornament it flows through the
   * slot machinery, which is what keeps the text below it from being set on top
   * of it — the engine never draws over anything, it only runs out of slots.
   */
  image?: {
    id: string
    widthPt: number
    heightPt: number
    /**
     * Left edge, relative to the frame. Absent, the picture is centred in the
     * measure; a figure the text runs beside sits against one margin.
     */
    xPt?: number
  }
  /**
   * A page break may not fall after this line.
   *
   * A figure and the lines set beside it are one thing: the picture on one
   * page and the narrowed lines that were making room for it on the next is
   * not a run-around, it is a picture with a hole under it. The placement loop
   * backs off to the start of a held run rather than breaking inside it.
   */
  holdWithNext?: boolean
  /**
   * A rule drawn with this line — a table's head or foot rule.
   *
   * Offsets are relative to the line's slot (`yPt` down from the top of it) and
   * to the frame (`xPt`), like everything else a flow line carries, so the rule
   * travels with the row it belongs to instead of being positioned against a
   * page that has not been chosen yet.
   */
  rule?: { xPt: number; yPt: number; widthPt: number; thicknessPt: number }
}

/** A footnote broken to the measure, ready to be set at the foot of a page. */
interface NoteBlock {
  id: string
  lines: FlowLine[]
}

/** Bookkeeping while a page is being filled. */
interface PageBuilder {
  index: number
  side: PageSide
  section: PageSection
  kind: PageKind
  frame: PageFrame
  lines: { slot: number; line: FlowLine }[]
  chapterTitle: string | null
  /** Chapter openers carry no running head, by convention. */
  suppressRunningHead: boolean
  /** Display pages (half-title, title, copyright) carry no folio. */
  suppressFolio: boolean
  /** Notes referenced from this page, in the order they are referenced. */
  noteIds: string[]
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i']
  ]
  let out = ''
  let rest = n
  for (const [value, numeral] of table) {
    while (rest >= value) {
      out += numeral
      rest -= value
    }
  }
  return out
}

/** How a block kind is set. Everything not listed reads as body prose. */
interface BlockStyle {
  alignment: Alignment
  /** Size relative to the body size. */
  scale: number
  style: FontRef['style']
  /** Indent from the left of the measure, in ems of the block's own size. */
  indentLeftEms: number
  indentRightEms: number
  /** First-line indent, in ems. Suppressed after a heading. */
  firstLineIndentEms: number
  spaceBefore: number
  spaceAfter: number
}

function blockStyle(block: BookBlock, profile: StyleProfile): BlockStyle {
  const base: BlockStyle = {
    alignment: 'justify',
    scale: 1,
    style: 'regular',
    indentLeftEms: 0,
    indentRightEms: 0,
    firstLineIndentEms: profile.paragraphIndentEms,
    spaceBefore: 0,
    spaceAfter: profile.paragraphSpacingEms
  }

  switch (block.kind) {
    case 'heading':
      return {
        ...base,
        alignment: profile.headingStyle.centered ? 'center' : 'left',
        scale: (block.level ?? 1) === 1 ? profile.headingStyle.scale : 1.15,
        firstLineIndentEms: 0,
        spaceBefore: (block.level ?? 1) === 1 ? 0 : 2,
        spaceAfter: (block.level ?? 1) === 1 ? CHAPTER_GAP_SLOTS : 1
      }
    case 'blockquote':
      return {
        ...base,
        scale: 0.94,
        indentLeftEms: 2,
        indentRightEms: 2,
        firstLineIndentEms: 0,
        spaceBefore: 1,
        spaceAfter: 1
      }
    case 'verse':
      return {
        ...base,
        alignment: 'left',
        indentLeftEms: 2,
        firstLineIndentEms: 0,
        spaceBefore: 1,
        spaceAfter: 1
      }
    case 'epigraph':
      return {
        ...base,
        alignment: 'left',
        style: 'italic',
        scale: 0.94,
        indentLeftEms: 3,
        firstLineIndentEms: 0,
        spaceBefore: 1,
        spaceAfter: 2
      }
    case 'caption':
      return {
        ...base,
        alignment: 'center',
        scale: 0.9,
        style: 'italic',
        firstLineIndentEms: 0,
        spaceBefore: 1,
        spaceAfter: 1
      }
    case 'list-item':
      return {
        ...base,
        indentLeftEms: LIST_INDENT_EMS,
        // Negative: the marker hangs out to the left of the text it labels, so
        // the wrapped lines of one item line up under each other rather than
        // under the number. See `hangingIndentEms`.
        firstLineIndentEms: -LIST_HANG_EMS,
        spaceBefore: 0,
        spaceAfter: 0.35
      }
    case 'paragraph':
    default:
      return base
  }
}

/**
 * Turn broken lines into flow lines at a given font, offset into the measure.
 *
 * A word carrying its own size is an attachment — a footnote's reference mark —
 * and keeps it, along with its lift off the baseline. `markToNote` maps those
 * marks back to the notes they refer to, which is how a line learns which notes
 * have to be set at the foot of whatever page it lands on. Keying off the
 * *attachment* rather than its host word matters: a hyphenated host straddles
 * two lines, and only the one carrying the mark owns the note.
 */
function toFlowLines(
  broken: BrokenLine[],
  font: FontRef,
  sizePt: number,
  leftOffsets: number[],
  markToNote?: ReadonlyMap<string, string>,
  optical?: TextMeasurer,
  spans?: readonly TextSpan[]
): FlowLine[] {
  return broken.map((line, i) => {
    const offset = leftOffsets[Math.min(i, leftOffsets.length - 1)] ?? 0
    const noteIds: string[] = []

    const placed = line.words.map((w) => {
      if (w.sizePt !== undefined && markToNote) {
        const noteId = markToNote.get(w.text)
        if (noteId !== undefined && !noteIds.includes(noteId)) noteIds.push(noteId)
      }
      return {
        // Italic or bold where a span claims it. A hyphenated fragment keeps
        // its host word's index, so both halves of a split italic word stay
        // italic.
        text: w.text,
        font: fontForWord(w.sourceIndex, spans, font),
        sizePt: w.sizePt ?? sizePt,
        xPt: w.xPt + offset,
        ...(w.risePt ? { risePt: w.risePt } : {})
      }
    })

    // Whether this line reaches the right margin, which decides if there is an
    // edge for punctuation to hang off. Measured from where the breaker put the
    // last word rather than assumed from the alignment, because a justified
    // paragraph's own last line is short too.
    const last = placed[placed.length - 1]
    const reach = last ? last.xPt - offset + widthOfRun(last, optical, font) : 0
    const flushRight = last !== undefined && reach >= line.widthPt - FLUSH_TOLERANCE_PT

    const runs = optical ? [...hangPunctuation(placed, optical, font, { flushRight })] : placed

    return {
      runs,
      ...(line.overfull ? { overfull: true } : {}),
      ...(noteIds.length > 0 ? { noteIds } : {})
    }
  })
}

/**
 * How close to the measure a line must sit to count as flush with it.
 *
 * A justified line lands on the measure to within rounding; a paragraph's last
 * line is short by whole words. A third of a point separates the two cases with
 * room to spare.
 */
const FLUSH_TOLERANCE_PT = 0.34

function widthOfRun(run: TextRun, measurer: TextMeasurer | undefined, font: FontRef): number {
  return measurer ? measurer.widthOf(run.text, font, run.sizePt) : 0
}

/**
 * Break a centred line so its parts come out even.
 *
 * A centred title broken at the full measure fills the first line and leaves
 * whatever is left on the second, which on a contents page is routinely one or
 * two words under a line four times as long. The fix printers have always used
 * is to set the same number of lines in a narrower measure: the narrowest
 * measure that still breaks into the same count is the balanced one.
 *
 * Binary search rather than trial widths, so the answer does not depend on how
 * many steps somebody chose. Returns the breaks, never fewer lines than the
 * natural setting and never more.
 */
function balancedLines(
  text: string,
  opts: { font: FontRef; sizePt: number; measurer: TextMeasurer; maxWidth: number }
): BrokenLine[] {
  const at = (width: number): BrokenLine[] =>
    breakParagraph(text, {
      font: opts.font,
      sizePt: opts.sizePt,
      measurer: opts.measurer,
      lineWidths: Math.max(1, width),
      alignment: 'center'
    })

  const natural = at(opts.maxWidth)
  if (natural.length < 2) return natural

  let tooNarrow = 0
  let wide = opts.maxWidth
  // Twelve halvings settles a 400pt measure to a tenth of a point, which is
  // finer than any face's word space.
  for (let i = 0; i < 12; i++) {
    const mid = (tooNarrow + wide) / 2
    if (at(mid).length <= natural.length) wide = mid
    else tooNarrow = mid
  }
  return at(wide)
}

/**
 * The slots a chapter ornament occupies, the first carrying the art.
 *
 * Empty lines after it draw nothing but hold their slots, which is what keeps
 * the ornament from overlapping the text that follows.
 */
function ornamentLines(art: OrnamentArt, ctx: BuildContext): FlowLine[] {
  const widthPt = ctx.measureWidth * ORNAMENT_WIDTH_RATIO
  const heightPt = (art.height / art.width) * widthPt
  const slots = Math.max(1, Math.ceil(heightPt / ctx.leading))
  return Array.from({ length: slots }, (_, i) =>
    i === 0 ? { runs: [], ornament: { art, widthPt } } : { runs: [] }
  )
}

/**
 * Lines set larger than the body, spaced so they cannot collide.
 *
 * Slots are one *body* leading apart, and a chapter title sets at up to twice
 * the body size — so the second line of a two-line title was set through the
 * first. "BOOK TWO — THE ASTRAL / WORLD" did exactly that on a real part
 * divider, with WORLD struck through the line above it. The blank lines draw
 * nothing and hold their slots, the same trick an ornament already uses, and
 * none is added after the last line because the space *below* a heading is the
 * caller's to decide.
 *
 * A no-op for anything set at the body size or smaller, which is every
 * paragraph in the book — the fault is only ever in oversized type.
 */
function spacedForSize(lines: FlowLine[], sizePt: number, ctx: BuildContext): FlowLine[] {
  const perLine = Math.max(1, Math.ceil(leadingFor(sizePt) / ctx.leading))
  if (perLine === 1 || lines.length < 2) return lines
  return lines.flatMap((line, i) =>
    i === lines.length - 1
      ? [line]
      : [line, ...Array.from({ length: perLine - 1 }, (): FlowLine => ({ runs: [] }))]
  )
}

/**
 * A division the editor wrote, as flowables.
 *
 * It opens like a chapter — on a recto, sunk down the page, with the running
 * head suppressed on its first leaf — because that is what a division of a book
 * looks like, and it is listed in the contents for the same reason. The only
 * thing that distinguishes front matter from back is `pageSection`, which is
 * what `folioFor` reads to number it in roman rather than arabic.
 */
/**
 * Which of a block's pictures it hosts, and which follow it.
 *
 * One figure can be hosted — a paragraph with two engravings set into it is
 * not a case any leaf here has shown — and the rest are set after the block.
 * A placement the paragraph cannot honour (see `hostable`) is set after it
 * too, carrying the reason, so the page it lands on reports the fallback.
 */
function partitionFigures(
  mine: readonly Illustration[],
  ctx: BuildContext,
  slotsPerPage: number
): { hosted: Illustration | null; after: { illustration: Illustration; warning?: string }[] } {
  let hosted: Illustration | null = null
  const after: { illustration: Illustration; warning?: string }[] = []
  for (const illustration of mine) {
    const kind = illustration.placement?.kind
    if (kind !== 'within' && kind !== 'beside') {
      after.push({ illustration })
      continue
    }
    const check = hostable(illustration, ctx, slotsPerPage)
    if (!check.ok) {
      after.push({ illustration, warning: fallbackWarning(illustration, check.why) })
    } else if (hosted === null) {
      hosted = illustration
    } else {
      after.push({
        illustration,
        warning: fallbackWarning(illustration, 'its paragraph already hosts a figure')
      })
    }
  }
  return { hosted, after }
}

function sectionFlowables(
  section: BookSection,
  ctx: BuildContext,
  profile: StyleProfile,
  illustrations: readonly Illustration[],
  slotsPerPage: number
): Flowable[] {
  const pageSection: PageSection = section.placement === 'front' ? 'front' : 'back'

  const title = buildFlowable(
    { id: `${section.id}-title`, kind: 'heading', level: 1, text: section.title, sourcePages: [] },
    ctx,
    {
      suppressFirstIndent: true,
      dropCap: false,
      // "BOOK ONE" over "THE HUMAN AURA", through the same superscription the
      // body uses for "LESSON I." over a chapter title — one implementation, so
      // a division and a chapter cannot open in two different ways.
      ...(section.label?.trim() ? { superscription: [section.label.trim()] } : {})
    }
  )

  const out: Flowable[] = [title]
  section.blocks.forEach((block, i) => {
    // A picture the editor pinned to a paragraph of their own prose.
    //
    // The body anchors by block *index*, which is meaningless here: a section
    // is written rather than read, its blocks are derived from the prose on
    // every layout, and the only stable handle is the id. An introduction that
    // discusses a title page and cannot show it is the case this exists for.
    const mine = illustrations.filter((x) => x.anchorAfterBlockId === block.id)
    const { hosted, after } = partitionFigures(mine, ctx, slotsPerPage)
    out.push(
      buildFlowable(block, ctx, {
        // The first paragraph sits directly under the title, so it is set
        // flush: there is no preceding paragraph for an indent to distinguish
        // it from.
        suppressFirstIndent: i === 0,
        dropCap: profile.dropCap && i === 0,
        ...(hosted ? { figure: hosted } : {})
      })
    )
    for (const { illustration, warning } of after) {
      out.push(buildIllustrationFlowable(illustration, ctx, slotsPerPage, warning))
    }
  })

  return out.map((flow) => ({ ...flow, pageSection }))
}

/**
 * An illustration and its caption, as one thing that cannot be taken apart.
 *
 * Sizing is entirely determined here, and deliberately so: the placed size is
 * what decides the effective resolution, so the number the KDP check reports
 * has to come from the same arithmetic that drew the box, not from a second
 * opinion about it.
 *
 * Three rules, in order:
 *   1. Set it to the full measure. A reprint's illustrations should line up
 *      with its text block, not float at whatever size the scanner gave them.
 *   2. If that makes it taller than the space available, scale it down until it
 *      fits. Width follows, so nothing is ever distorted.
 *   3. If it is still tall enough that the text around it would be a stub, give
 *      it a page of its own.
 */
function buildIllustrationFlowable(
  illustration: Illustration,
  ctx: BuildContext,
  slotsPerPage: number,
  warning?: string
): Flowable {
  const font: FontRef = { family: ctx.profile.bodyFont, style: 'italic' }
  const sizePt = ctx.profile.bodyFontSize * CAPTION_SIZE_RATIO

  const captionText = illustration.caption?.trim() ?? ''
  const captionLines =
    captionText.length > 0
      ? toFlowLines(
          breakParagraph(captionText, {
            font,
            sizePt,
            measurer: ctx.measurer,
            lineWidths: ctx.measureWidth,
            alignment: 'center'
          }),
          font,
          sizePt,
          [0]
        )
      : []

  // Slots the caption will need, so the picture is sized against the space that
  // is actually left for it rather than the whole frame.
  const captionSlots = captionLines.length > 0 ? captionLines.length + CAPTION_GAP_SLOTS : 0

  const ratio =
    illustration.sourceWidth > 0 && illustration.sourceHeight > 0
      ? illustration.sourceHeight / illustration.sourceWidth
      : 1

  // The measure, unless a person has said the size the original printed it at
  // — never wider than the measure, since a figure past the margin is not a
  // reproduction of anything.
  let widthPt =
    illustration.placement !== undefined
      ? Math.min(ctx.measureWidth, illustration.placement.widthIn * PT_PER_INCH)
      : ctx.measureWidth
  let heightPt = widthPt * ratio

  // Decided from the natural height, before any clamping: whether this is a
  // plate must not depend on the ceiling that is about to be derived from it.
  const isPlate = heightPt > slotsPerPage * ctx.leading * PLATE_HEIGHT_RATIO

  // The ceiling is counted in *slots*, not points, because slots are what the
  // page actually has. Sizing against the frame's height in points and then
  // rounding up to slots can ask for one more slot than exists, and an
  // unbreakable flowable that cannot fit on an empty page has nowhere to go.
  //
  // A plate keeps a slot of air besides: a picture ruled off exactly at the
  // last baseline of the text block looks cramped against a leaf that is
  // otherwise all margin, and the slack is what lets it be centred at all.
  const maxSlots = Math.max(1, slotsPerPage - captionSlots - (isPlate ? 1 : 0))
  const maxHeight = maxSlots * ctx.leading
  if (heightPt > maxHeight) {
    widthPt = maxHeight / ratio
    heightPt = maxHeight
  }

  const slots = Math.max(1, Math.ceil(heightPt / ctx.leading))
  const lines: FlowLine[] = Array.from({ length: slots }, (_, i) =>
    i === 0 ? { runs: [], image: { id: illustration.id, widthPt, heightPt } } : { runs: [] }
  )
  if (captionLines.length > 0) {
    for (let i = 0; i < CAPTION_GAP_SLOTS; i++) lines.push({ runs: [] })
    lines.push(...captionLines)
  }

  return {
    lines,
    ...(warning ? { warning } : {}),
    spaceBefore: IMAGE_SPACE_SLOTS,
    spaceAfter: IMAGE_SPACE_SLOTS,
    startsChapter: false,
    chapter: null,
    keepWithNext: false,
    orphanControl: false,
    unbreakable: true,
    ownPage: isPlate,
    contentHeightPt: heightPt + captionSlots * ctx.leading
  }
}

/**
 * Break one footnote to the measure.
 *
 * Set with a hanging indent: the mark sits at the left edge and every line of
 * the note is indented past it, so a run of notes lines up down the page and
 * the marks are scannable. The mark is a decoration rather than a word because
 * it is outside the text's measure entirely.
 */
function breakNote(note: PreparedNote, ctx: BuildContext): NoteBlock {
  const font: FontRef = { family: ctx.profile.bodyFont, style: 'regular' }
  const sizePt = ctx.profile.bodyFontSize * NOTE_SIZE_RATIO
  const markSize = sizePt * MARK_SIZE_RATIO
  const hang = ctx.measurer.widthOf(note.mark, font, markSize) + sizePt * NOTE_HANG_GAP_RATIO

  const spans = spansFor(ctx, ctx.profile.bodyFont, 'regular', note)

  const broken = breakParagraph(note.text, {
    font,
    sizePt,
    measurer: ctx.measurer,
    lineWidths: Math.max(1, ctx.measureWidth - hang),
    alignment: 'left',
    ...(ctx.hyphenate ? { hyphenate: ctx.hyphenate } : {}),
    ...(spans.length > 0 ? { spans } : {}),
    ...(note.subscript?.length ? { subscripts: note.subscript } : {})
  })

  const lines = toFlowLines(broken, font, sizePt, [hang], undefined, undefined, spans)
  const first = lines[0]
  if (first) {
    first.decorations = [
      { text: note.mark, font, sizePt: markSize, xPt: 0, risePt: sizePt * MARK_RISE_RATIO }
    ]
  } else {
    // A note with no text still has to appear, or it vanishes without a word.
    lines.push({
      runs: [],
      decorations: [
        { text: note.mark, font, sizePt: markSize, xPt: 0, risePt: sizePt * MARK_RISE_RATIO }
      ]
    })
  }

  return { id: note.id, lines }
}

interface BuildContext {
  profile: StyleProfile
  measurer: TextMeasurer
  measureWidth: number
  leading: number
  hyphenate?: (word: string) => string[]
}

/**
 * The faces a block's marked-up runs are set in.
 *
 * Two kinds of run, in priority order, and the order matters because a word can
 * be both: **strong** first, then **emphasis**. A glossary headword that
 * happens to be a book title should read as a headword.
 *
 * Bold is asked for rather than assumed. Five of the seven faces offered ship
 * one and IM FELL English does not, so a strong run in a face without a bold is
 * set in **italic** — the face every one of them has, and what a printer with
 * no bold in the case would have reached for. Never a bold smeared out of the
 * regular outlines, for the same reason small capitals are never scaled-down
 * capitals: it is a forgery and it looks like one.
 *
 * Decided here, in the engine, so the width the breaker measures and the glyphs
 * the writer draws come from one answer.
 */
function spansFor(
  ctx: BuildContext,
  family: string,
  base: FontStyle,
  marks: {
    emphasis?: readonly number[]
    strong?: readonly number[]
    smallCaps?: readonly number[]
  }
): TextSpan[] {
  const spans: TextSpan[] = []
  // Small capitals first, so a headword that is also a book title reads as a
  // headword — the same precedence, and for the same reason, as strong over
  // emphasis.
  //
  // Asked for rather than assumed, exactly as bold is. Only two of the seven
  // faces offered carry `smcp`, and a face without it sets the run in **full
  // capitals** — which is what `smcp` itself does to letters that are already
  // capitals, so the fallback is the same shape as the real thing rather than
  // a different one. Never capitals scaled down: that is a forgery and the
  // stroke weight beside the surrounding text gives it away.
  if (marks.smallCaps?.length) {
    const words = new Set(marks.smallCaps)
    spans.push(
      ctx.measurer.hasSmallCaps(family)
        ? { words, font: { family, style: base, smallCaps: true } }
        : { words, font: { family, style: base }, upperCase: true }
    )
  }
  if (marks.strong?.length) {
    const style: FontStyle = ctx.measurer.hasBold(family) ? 'bold' : 'italic'
    spans.push({ words: new Set(marks.strong), font: { family, style } })
  }
  if (marks.emphasis?.length) {
    spans.push({ words: new Set(marks.emphasis), font: { family, style: 'italic' } })
  }
  return base === 'regular' ? spans : []
}

/**
 * Break one block into a flowable.
 *
 * `dropCap` is handled here rather than at placement time because it changes
 * the *measure* of the first few lines, which is a line-breaking input — the
 * whole reason the plan calls drop caps "line-box arithmetic" rather than a
 * decoration.
 */
interface FlowableOptions {
  suppressFirstIndent: boolean
  dropCap: boolean
  /** The block's text with reference marks already renumbered, if it has any. */
  text?: string
  /** Footnote references found in that text. */
  references?: readonly NoteReference[]
  /**
   * Headings set *above* this one, as part of the same opening.
   *
   * A chapter opened by "LESSON I." over "THE ASTRAL SENSES." is one opening
   * and not two — see `ChapterEntry.label`. They are built here rather than as
   * flowables of their own so the pair can never be split by a page break, and
   * so the ornament, the page break and the sinkage happen once. Set smaller
   * than the title, which is the ordinary relation between a chapter's number
   * and its name.
   */
  superscription?: readonly string[]
  /**
   * The chapter this opening records, where it differs from the block.
   *
   * The contents matches folios back by identity, and assembly names a chapter
   * by the *first* heading of its run while the title comes from the last. So
   * an opening built from a run has to report the run's id, not the id of the
   * block that happens to carry the title.
   */
  chapter?: { id: string; title: string; level: number }
  /**
   * A figure this paragraph hosts — set inside it (`within`) or beside its
   * lines (`beside`). Already checked by `hostable`; the paragraph is built
   * round it rather than the picture being a flowable of its own.
   */
  figure?: Illustration
}

function buildFlowable(block: BookBlock, ctx: BuildContext, opts: FlowableOptions): Flowable {
  const style = blockStyle(block, ctx.profile)
  const sizePt = ctx.profile.bodyFontSize * style.scale
  const family = block.kind === 'heading' ? ctx.profile.headingFont : ctx.profile.bodyFont
  // Headings the style asks to be small-capped are set in the face's *real*
  // small capitals where it has them. Where it has none — four of the seven
  // faces offered, including IM FELL English — they are set in ordinary
  // capitals, which is a different texture and an honest one. What is never
  // done is synthesising them by scaling capitals down: the strokes come out
  // too light for the size, and it is the tell of a cheap reprint.
  const wantsSmallCaps = block.kind === 'heading' && ctx.profile.headingStyle.smallCaps
  const realSmallCaps = wantsSmallCaps && ctx.measurer.hasSmallCaps(family)
  const font: FontRef = realSmallCaps
    ? { family, style: style.style, smallCaps: true }
    : { family, style: style.style }

  const indentLeft = style.indentLeftEms * sizePt
  const indentRight = style.indentRightEms * sizePt
  const measure = Math.max(1, ctx.measureWidth - indentLeft - indentRight)
  const firstIndent = opts.suppressFirstIndent ? 0 : style.firstLineIndentEms * sizePt
  /**
   * A negative first-line indent is a *hanging* indent: line one starts to the
   * left of the block and every line after it is inset. The breaker is told
   * line one is that much wider, and the placement below moves it out — both
   * halves are needed, or the marker sets over the top of the text.
   */
  const hang = firstIndent < 0 ? -firstIndent : 0

  // A run's own level wins: a chapter opened by "LESSON I." over its name is a
  // chapter however the pass happened to tag the two lines.
  const isChapter = block.kind === 'heading' && (opts.chapter?.level ?? block.level ?? 1) === 1

  // `smcp` maps *lower case* to small capitals, so the text is handed over as
  // written; upper-casing it first would defeat the feature and give full caps
  // in a face that had the real thing.
  const source = opts.text ?? block.text
  const text = wantsSmallCaps && !realSmallCaps ? source.toLocaleUpperCase() : source

  // Reference marks ride on the end of the word they follow, set smaller and
  // lifted. They are given to the breaker rather than concatenated into the
  // text because they occupy width — a line breaker that did not know about
  // them would set every line carrying one fractionally too long.
  const references = opts.references ?? []
  const attachments: Attachment[] = references.map((ref) => ({
    wordIndex: ref.wordIndex,
    text: ref.mark,
    sizePt: sizePt * MARK_SIZE_RATIO,
    risePt: sizePt * MARK_RISE_RATIO
  }))
  const markToNote = new Map(references.map((ref) => [ref.mark, ref.noteId]))

  /**
   * Words the original printed in italic, recovered from the model's markup.
   *
   * Skipped when the block itself is already italic — an epigraph is set in
   * italic entire, and emphasis inside one would have to be roman to show at
   * all, which is a refinement no book here has needed.
   */
  const spans = style.style === 'regular' ? spansFor(ctx, family, style.style, block) : []

  /**
   * Figures the original set below the line, as character ranges.
   *
   * Offered only when the text being broken *is* the block's own text. A
   * running head cut to fit, a line upper-cased because the face has no real
   * small capitals, a caption supplied through `opts.text` — each is a
   * different string, and a character range measured against one of them and
   * applied to another would put a figure under whatever letter now sits
   * there. Dropping them is safe where keeping them would not be: a heading
   * has no chemistry in it.
   */
  const subscripts = text === block.text ? (block.subscript ?? []) : []

  // A paragraph with a figure in it or beside it is built round the figure.
  // The drop capital gives way: both change the measure of the opening lines,
  // and a paragraph that has an engraving set into it has its ornament already.
  if (opts.figure && (block.kind === 'paragraph' || block.kind === 'blockquote')) {
    return withBlockId(
      block.id,
      buildFigureFlowable(block, text, opts.figure, {
        font,
        sizePt,
        indentLeft,
        measure,
        firstIndent: hang > 0 ? 0 : firstIndent,
        attachments,
        markToNote,
        spans,
        subscripts,
        style,
        ctx
      })
    )
  }

  const dropCap = opts.dropCap && block.kind === 'paragraph' && text.trim().length > 0
  if (!dropCap) {
    // Verse keeps the lines the poem has; everything else reflows. See
    // `breakVerse` for why that distinction is the whole of it.
    const breaker = block.kind === 'verse' && text.includes('\n') ? breakVerse : breakParagraph
    const broken = breaker(text, {
      font,
      sizePt,
      measurer: ctx.measurer,
      lineWidths: measure,
      alignment: style.alignment,
      firstLineIndentPt: firstIndent,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(block.kind === 'paragraph' || block.kind === 'blockquote'
        ? { hyphenate: ctx.hyphenate }
        : {}),
      ...(spans.length > 0 ? { spans } : {}),
      ...(subscripts.length > 0 ? { subscripts } : {})
    })
    // A chapter opener may carry a flourish under its title. It belongs to the
    // heading's own lines so the two can never be separated by a page break.
    const flourish = isChapter ? findOrnament(ctx.profile.ornaments.chapterOpener) : null
    const lines = spacedForSize(
      toFlowLines(
        broken,
        font,
        sizePt,
        hang > 0 ? [indentLeft - hang, indentLeft] : [indentLeft],
        markToNote,
        ctx.profile.opticalMargins ? ctx.measurer : undefined,
        spans
      ),
      sizePt,
      ctx
    )

    // "LESSON I." over "THE ASTRAL SENSES.", as one opening. Built here so a
    // page break can never fall between them.
    const above = (opts.superscription ?? []).flatMap((line) => {
      const size = sizePt * SUPERSCRIPTION_SIZE_RATIO
      return spacedForSize(
        toFlowLines(
          breakParagraph(wantsSmallCaps && !realSmallCaps ? line.toLocaleUpperCase() : line, {
            font,
            sizePt: size,
            measurer: ctx.measurer,
            lineWidths: measure,
            alignment: style.alignment
          }),
          font,
          size,
          [indentLeft]
        ),
        size,
        ctx
      )
    })

    return {
      lines: [
        ...above,
        ...(above.length > 0 ? [{ runs: [] }] : []),
        ...lines,
        ...(flourish ? ornamentLines(flourish, ctx) : [])
      ],
      blockId: block.id,
      spaceBefore: style.spaceBefore,
      spaceAfter: style.spaceAfter,
      startsChapter: isChapter,
      chapter:
        opts.chapter ??
        (block.kind === 'heading'
          ? { id: block.id, title: block.text.trim(), level: block.level ?? 1 }
          : null),
      keepWithNext: block.kind === 'heading',
      // Verse as well as prose: a quotation of verse that leaves one line at
      // the foot of a page, or carries one over to the head of the next, is a
      // composition fault the original does not have. The lines are the poem's
      // and they were set together.
      orphanControl: block.kind === 'paragraph' || block.kind === 'verse'
    }
  }

  return withBlockId(
    block.id,
    buildDropCapFlowable(text, font, sizePt, indentLeft, measure, ctx, style, {
      attachments,
      markToNote,
      subscripts
    })
  )
}

/** Whitespace-separated words, the breaker's own unit of indexing. */
function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length
}

/**
 * The word a placement's `at` names, as an index into the block's words.
 *
 * Character offsets are what a note and a `split` use and what a person can
 * point at; the breaker indexes words. Counting the words before the offset
 * converts one to the other in the same way a drop capital's shift is found,
 * and an offset that falls inside a word names that word.
 */
function wordAtOffset(block: BookBlock, at: number): number {
  const clamped = Math.max(0, Math.min(block.text.length, at))
  return countWords(block.text.slice(0, clamped))
}

/** The first line that carries a word at or past `wordIndex`. */
function lineOfWord(broken: readonly BrokenLine[], wordIndex: number): number {
  const i = broken.findIndex((line) => line.words.some((w) => w.sourceIndex >= wordIndex))
  return i < 0 ? Math.max(0, broken.length - 1) : i
}

/**
 * Whether a figure can be set the way its placement asks, in this paragraph.
 *
 * `within` always can: text stops, the picture is drawn, text resumes. A
 * run-around cannot when the figure would leave the text less than
 * `BESIDE_MIN_TEXT_RATIO` of the measure — and a picture too tall to share a
 * page with anything is a plate, whatever the placement says. Both fall back
 * to the picture on a line of its own, and the fallback is reported: the
 * engine does not quietly do something other than what it was asked.
 */
function hostable(
  illustration: Illustration,
  ctx: BuildContext,
  slotsPerPage: number
): { ok: true } | { ok: false; why: string } {
  const placement = illustration.placement
  if (!placement || placement.kind === 'inline') return { ok: false, why: '' }
  const ratio =
    illustration.sourceWidth > 0 && illustration.sourceHeight > 0
      ? illustration.sourceHeight / illustration.sourceWidth
      : 1
  const widthPt = Math.min(ctx.measureWidth, placement.widthIn * PT_PER_INCH)
  const heightPt = widthPt * ratio
  if (heightPt > slotsPerPage * ctx.leading * PLATE_HEIGHT_RATIO) {
    return { ok: false, why: `too tall to share a page with its paragraph` }
  }
  if (placement.kind === 'beside') {
    const gutter = ctx.profile.bodyFontSize * BESIDE_GUTTER_EMS
    if (ctx.measureWidth - widthPt - gutter < ctx.measureWidth * BESIDE_MIN_TEXT_RATIO) {
      return { ok: false, why: `too wide for text to run beside it` }
    }
  }
  return { ok: true }
}

/** What the loop says when a placement had to give way. */
function fallbackWarning(illustration: Illustration, why: string): string {
  return `picture ${illustration.id} was set on a line of its own: ${why}`
}

interface FigureParams {
  font: FontRef
  sizePt: number
  indentLeft: number
  measure: number
  firstIndent: number
  attachments: readonly Attachment[]
  markToNote: ReadonlyMap<string, string>
  spans: readonly TextSpan[]
  subscripts: readonly SubscriptRange[]
  style: BlockStyle
  ctx: BuildContext
}

/**
 * A paragraph built round the figure it hosts.
 *
 * Two shapes, both taken off real leaves rather than invented.
 *
 * **`within`** — a symbol drawn mid-sentence: "…by the symbol [figure] which
 * embraces three things". The words before `at` are set as a paragraph whose
 * last line is short, the figure is drawn centred on the slots below, and the
 * words from `at` resume on a fresh line with no indent, because they are not
 * a new paragraph. One slot of air on each side, as the original leaves.
 *
 * **`beside`** — an engraving with the text run down a narrow column past it.
 * The whole paragraph is broken once with a per-line measure, the way a drop
 * capital already narrows its opening lines: full width to the line that
 * carries the word at `at`, the narrowed width for as many lines as the figure
 * is tall, full width after. The line the word falls on is not known until the
 * paragraph is broken, and narrowing moves the breaks, so it is found, the
 * widths set from it, and the paragraph broken again until the two agree —
 * which on real prose is once or twice. The figure hangs from the first
 * narrowed slot against the margin its `side` names, and those lines are held
 * together across a page break. A paragraph shorter than the figure is padded
 * with empty narrowed slots, so whatever follows starts below the picture.
 *
 * Emphasis, bold and reference marks are indexed by word, so for `within` the
 * second part's indices are shifted by the words that went before, exactly as
 * a drop capital shifts everything by the initial it lifts out.
 */
function buildFigureFlowable(
  block: BookBlock,
  text: string,
  figure: Illustration,
  p: FigureParams
): Flowable {
  const placement = figure.placement
  if (!placement || placement.kind === 'inline') {
    throw new Error('buildFigureFlowable needs a within or beside placement')
  }
  const { ctx, font, sizePt, indentLeft, measure } = p
  const optical = ctx.profile.opticalMargins ? ctx.measurer : undefined
  const hyphenate =
    block.kind === 'paragraph' || block.kind === 'blockquote' ? ctx.hyphenate : undefined

  const ratio =
    figure.sourceWidth > 0 && figure.sourceHeight > 0 ? figure.sourceHeight / figure.sourceWidth : 1
  const widthPt = Math.min(measure, placement.widthIn * PT_PER_INCH)
  const heightPt = widthPt * ratio
  const slots = Math.max(1, Math.ceil(heightPt / ctx.leading))
  const wordAt = wordAtOffset(block, placement.at)

  const base = (lineWidths: number | number[], firstLineIndentPt: number) => ({
    font,
    sizePt,
    measurer: ctx.measurer,
    lineWidths,
    alignment: p.style.alignment,
    firstLineIndentPt,
    ...(hyphenate ? { hyphenate } : {})
  })

  const flow = (lines: FlowLine[]): Flowable => ({
    lines,
    blockId: block.id,
    spaceBefore: p.style.spaceBefore,
    spaceAfter: p.style.spaceAfter,
    startsChapter: false,
    chapter: null,
    keepWithNext: false,
    orphanControl: true
  })

  if (placement.kind === 'within') {
    const words = text.split(/\s+/u).filter((w) => w.length > 0)
    const before = words.slice(0, wordAt).join(' ')
    const after = words.slice(wordAt).join(' ')
    const spansBefore = p.spans.map((s) => ({
      ...s,
      words: new Set([...s.words].filter((i) => i < wordAt))
    }))
    const spansAfter = p.spans.map((s) => ({
      ...s,
      words: new Set([...s.words].filter((i) => i >= wordAt).map((i) => i - wordAt))
    }))
    const attBefore = p.attachments.filter((a) => a.wordIndex < wordAt)
    const attAfter = p.attachments
      .filter((a) => a.wordIndex >= wordAt)
      .map((a) => ({ ...a, wordIndex: a.wordIndex - wordAt }))

    // The two halves are rebuilt by joining words with single spaces, so a
    // character range has to be mapped onto that normalised text before it can
    // be cut in two at the word the figure interrupts.
    const joinedAll = words.join(' ')
    const normalised = rebaseRanges(p.subscripts, text, joinedAll, 0) ?? []
    const cut = before.length === 0 ? 0 : before.length + 1
    const subsBefore = normalised.filter((r) => r.to <= cut)
    const subsAfter = normalised
      .filter((r) => r.from >= cut)
      .map((r) => ({ from: r.from - cut, to: r.to - cut }))

    const set = (
      part: string,
      first: number,
      spans: TextSpan[],
      attachments: Attachment[],
      subscripts: readonly SubscriptRange[]
    ) =>
      part.length === 0
        ? []
        : toFlowLines(
            breakParagraph(part, {
              ...base(measure, first),
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(spans.length > 0 ? { spans } : {}),
              ...(subscripts.length > 0 ? { subscripts } : {})
            }),
            font,
            sizePt,
            [indentLeft],
            p.markToNote,
            optical,
            spans
          )

    const linesBefore = set(before, p.firstIndent, spansBefore, attBefore, subsBefore)
    // Resumes flush: it is the same sentence, not a new paragraph.
    const linesAfter = set(after, 0, spansAfter, attAfter, subsAfter)
    const held: FlowLine[] = [
      ...Array.from({ length: IMAGE_SPACE_SLOTS }, () => ({ runs: [], holdWithNext: true })),
      ...Array.from({ length: slots }, (_, i): FlowLine => ({
        runs: [],
        holdWithNext: true,
        ...(i === 0 ? { image: { id: figure.id, widthPt, heightPt } } : {})
      })),
      ...Array.from({ length: IMAGE_SPACE_SLOTS }, () => ({ runs: [] }))
    ]
    // The line the picture interrupts stays with it: a page ending on "…by
    // the symbol" with the symbol overleaf is the shape this exists to avoid.
    const last = linesBefore[linesBefore.length - 1]
    if (last) last.holdWithNext = true
    return flow([...linesBefore, ...held, ...linesAfter])
  }

  // beside
  const gutter = ctx.profile.bodyFontSize * BESIDE_GUTTER_EMS
  const narrow = Math.max(1, measure - widthPt - gutter)
  const breakWith = (widths: number | number[]) =>
    breakParagraph(text, {
      ...base(widths, p.firstIndent),
      ...(p.attachments.length > 0 ? { attachments: p.attachments } : {}),
      ...(p.spans.length > 0 ? { spans: p.spans } : {}),
      ...(p.subscripts.length > 0 ? { subscripts: p.subscripts } : {})
    })

  let start = lineOfWord(breakWith(measure), wordAt)
  let broken: BrokenLine[] = []
  for (let pass = 0; pass < 4; pass++) {
    const widths = [
      ...Array.from({ length: start }, () => measure),
      ...Array.from({ length: slots }, () => narrow),
      measure
    ]
    broken = breakWith(widths)
    const found = lineOfWord(broken, wordAt)
    if (found === start) break
    start = found
  }

  const left = placement.side === 'left' ? indentLeft + widthPt + gutter : indentLeft
  const offsets = broken.map((_, i) => (i >= start && i < start + slots ? left : indentLeft))
  const lines = toFlowLines(broken, font, sizePt, offsets, p.markToNote, optical, p.spans)
  // A paragraph shorter than its figure: hold the slots beside it empty so the
  // next block starts under the picture rather than through it.
  while (lines.length < start + slots) lines.push({ runs: [] })
  const first = lines[start]!
  first.image = {
    id: figure.id,
    widthPt,
    heightPt,
    xPt: placement.side === 'left' ? indentLeft : indentLeft + measure - widthPt
  }
  for (let i = start; i < start + slots - 1; i++) lines[i]!.holdWithNext = true
  return flow(lines)
}

/** A flowable stamped with the block it came from. */
function withBlockId(blockId: string, flow: Flowable): Flowable {
  return { ...flow, blockId }
}

/**
 * Whether a column is a column of figures, and so should be set to the right.
 *
 * Digits and no letters. A column of years, prices or quantities lines up on
 * its right edge in every printed table, because that is what makes the
 * magnitudes comparable down the column; a column of words does not. "£3 4s.
 * 6d." has letters in it and is set to the left, which is the honest answer —
 * it is not a number the reader scans, it is a phrase.
 */
function isFigureColumn(values: readonly string[]): boolean {
  const filled = values.filter((v) => v.trim().length > 0)
  if (filled.length === 0) return false
  return filled.every((v) => /\d/u.test(v) && !/\p{L}/u.test(v))
}

/** How wide a broken line's content actually is, as opposed to its measure. */
function naturalWidth(
  line: BrokenLine,
  measurer: TextMeasurer,
  font: FontRef,
  sizePt: number
): number {
  const last = line.words[line.words.length - 1]
  if (!last) return 0
  return last.xPt + measurer.widthOf(last.text, font, last.sizePt ?? sizePt)
}

/**
 * Column widths for a table, fitted to the measure.
 *
 * Natural widths where the whole table fits, because a table narrower than the
 * measure should be set at its natural width and centred rather than stretched
 * to the margins — a stretched table reads as a page of leader dots with no
 * leaders. Where it does not fit, every column is given at most its fair share
 * and the space the narrow columns did not want is handed back to the ones that
 * did, in proportion to what they asked for. That is what keeps a column of
 * years from being squeezed to the same width as a column of sentences.
 */
function fitColumns(natural: readonly number[], available: number, minWidth: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0)
  if (total <= available) return [...natural]

  const fair = available / natural.length
  const widths = natural.map((n) => Math.max(minWidth, Math.min(n, fair)))
  const wanting = natural.map((n, i) => ({ n, i })).filter(({ n }) => n > fair)
  const surplus = available - widths.reduce((a, b) => a + b, 0)
  if (surplus > 0 && wanting.length > 0) {
    const asked = wanting.reduce((a, { n }) => a + n, 0)
    for (const { n, i } of wanting) widths[i] = (widths[i] ?? 0) + (surplus * n) / asked
  }
  return widths
}

/**
 * A table, as one flowable per row.
 *
 * A row at a time rather than a table at a time, and every row unbreakable, is
 * what makes the rest of the engine handle tables without knowing they exist: a
 * table long enough to need two pages breaks *between* rows because a row is
 * the indivisible thing, and the widow and orphan machinery never has to be
 * taught that a wrapped cell is not a line of prose. The head row carries
 * `keepWithNext`, so a table cannot leave its column heads alone at the foot of
 * a page.
 *
 * What this deliberately does not do is repeat the heads at the top of the
 * continuation. That is a real convention, and it is also a second pass — the
 * heads only need repeating once the break is known, and the break depends on
 * how many rows fit. It belongs with the two-pass contents, not here.
 */
function buildTableFlowables(block: BookBlock, ctx: BuildContext): Flowable[] {
  const rows = (block.cells ?? []).filter((row) => row.length > 0)
  if (rows.length === 0) return []

  const sizePt = ctx.profile.bodyFontSize * TABLE_SIZE_RATIO
  const family = ctx.profile.bodyFont
  const bodyFont: FontRef = { family, style: 'regular' }
  // Column heads are set in italic: it is the one contrast available in every
  // face here, where bold is not — the book faces are shipped as regular and
  // italic, and a synthesised bold is a smear.
  const headFont: FontRef = { family, style: 'italic' }
  const hasHead = block.headerRow === true && rows.length > 1
  const fontFor = (rowIndex: number): FontRef => (hasHead && rowIndex === 0 ? headFont : bodyFont)

  const columns = Math.max(...rows.map((row) => row.length))
  const cellAt = (row: readonly string[], c: number): string => (row[c] ?? '').trim()

  const natural: number[] = []
  for (let c = 0; c < columns; c++) {
    let widest = 0
    rows.forEach((row, r) => {
      widest = Math.max(widest, ctx.measurer.widthOf(cellAt(row, c), fontFor(r), sizePt))
    })
    natural.push(widest)
  }

  const gutter = sizePt * TABLE_GUTTER_EMS
  const available = Math.max(1, ctx.measureWidth - gutter * (columns - 1))
  const widths = fitColumns(natural, available, sizePt * TABLE_MIN_COLUMN_EMS)

  // A table narrower than the measure is centred in it.
  const tableWidth = widths.reduce((a, b) => a + b, 0) + gutter * (columns - 1)
  const tableLeft = Math.max(0, (ctx.measureWidth - tableWidth) / 2)

  const columnX: number[] = []
  let x = tableLeft
  for (let c = 0; c < columns; c++) {
    columnX.push(x)
    x += (widths[c] ?? 0) + gutter
  }

  const bodyRows = hasHead ? rows.slice(1) : rows
  const alignRight = Array.from({ length: columns }, (_, c) =>
    isFigureColumn(bodyRows.map((row) => cellAt(row, c)))
  )

  const ruleDrop = ctx.measurer.metrics(bodyFont, sizePt).ascent + sizePt * TABLE_RULE_DROP_EMS
  const ruleAt = (): FlowLine['rule'] => ({
    xPt: tableLeft,
    yPt: ruleDrop,
    widthPt: tableWidth,
    thicknessPt: TABLE_RULE_THICKNESS
  })

  const flowables: Flowable[] = []

  rows.forEach((row, r) => {
    const font = fontFor(r)
    // Each cell broken to its own column, then the columns zipped back together
    // line by line — line 2 of a wrapped cell shares its slot with line 2 of
    // every other wrapped cell in the row, which is what makes a row of unequal
    // cells still sit on the baseline grid.
    const perColumn = Array.from({ length: columns }, (_, c) => {
      const width = Math.max(1, widths[c] ?? 1)
      const broken = breakParagraph(cellAt(row, c), {
        font,
        sizePt,
        measurer: ctx.measurer,
        lineWidths: width,
        alignment: 'left'
      })
      const offsets = broken.map((line) => {
        const base = columnX[c] ?? 0
        if (!alignRight[c]) return base
        return base + Math.max(0, width - naturalWidth(line, ctx.measurer, font, sizePt))
      })
      return toFlowLines(broken, font, sizePt, offsets.length > 0 ? offsets : [columnX[c] ?? 0])
    })

    const height = Math.max(1, ...perColumn.map((lines) => lines.length))
    const lines: FlowLine[] = Array.from({ length: height }, (_, i) => {
      const runs = perColumn.flatMap((col) => col[i]?.runs ?? [])
      const overfull = perColumn.some((col) => col[i]?.overfull === true)
      return { runs, ...(overfull ? { overfull: true } : {}) }
    })

    // Head rule and foot rule, hung off the last line of the row they close.
    // Only when the table has heads: a lone rule under the last row of a table
    // with no heads is a line across the page with nothing to close.
    const last = lines[lines.length - 1]
    if (last && hasHead && (r === 0 || r === rows.length - 1)) last.rule = ruleAt()

    flowables.push({
      lines,
      spaceBefore: r === 0 ? 1 : 0,
      spaceAfter: r === rows.length - 1 ? 1 : 0,
      startsChapter: false,
      chapter: null,
      keepWithNext: hasHead && r === 0,
      orphanControl: false,
      unbreakable: true
    })
  })

  return flowables
}

/**
 * A paragraph opening with a large initial.
 *
 * The initial is not drawn over the text — it *is* the reason the first few
 * lines are short. Its cap height is matched to the depth it spans, and its
 * baseline is the baseline of the last line it spans, which is what makes it
 * sit in the text block rather than float above it.
 */
function buildDropCapFlowable(
  text: string,
  font: FontRef,
  sizePt: number,
  indentLeft: number,
  measure: number,
  ctx: BuildContext,
  style: BlockStyle,
  notes: {
    attachments: readonly Attachment[]
    markToNote: ReadonlyMap<string, string>
    subscripts: readonly SubscriptRange[]
  }
): Flowable {
  const initial = [...text.trim()][0] ?? ''
  const rest = text.trim().slice(initial.length).replace(/^\s+/u, '')

  // The initial is lifted out of the text, so when it *was* the whole first
  // word every later word shifts down one — and a reference mark's word index
  // has to shift with it, or the note attaches to the wrong word.
  const countWords = (t: string): number => t.split(/\s+/u).filter((w) => w.length > 0).length
  const shift = countWords(text.trim()) - countWords(rest)
  const attachments = notes.attachments
    .map((a) => ({ ...a, wordIndex: a.wordIndex - shift }))
    .filter((a) => a.wordIndex >= 0)
  // The initial and the space after it come off the front, so the ranges move
  // back by however many characters that was — the word indices' own rule, in
  // the coordinate a range is counted in.
  const lead = text.length - rest.length
  const subscripts = (notes.subscripts ?? [])
    .filter((r) => r.from >= lead)
    .map((r) => ({ from: r.from - lead, to: r.to - lead }))

  const build = (depth: number): { lines: FlowLine[]; capSize: number; capWidth: number } => {
    // A capital's height is roughly 0.7em in a book face, so an initial that
    // spans `depth` baselines needs a point size of about that span over 0.7.
    const capSize = ((depth - 1) * ctx.leading + ctx.profile.bodyFontSize * 0.7) / 0.7
    const capWidth = ctx.measurer.widthOf(initial, font, capSize) + capSize * DROP_CAP_GAP_RATIO
    const widths = [
      ...Array.from({ length: depth }, () => Math.max(1, measure - capWidth)),
      measure
    ]
    const broken = breakParagraph(rest, {
      font,
      sizePt,
      measurer: ctx.measurer,
      lineWidths: widths,
      alignment: style.alignment,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(subscripts.length > 0 ? { subscripts } : {}),
      ...(ctx.hyphenate ? { hyphenate: ctx.hyphenate } : {})
    })
    const offsets = [...Array.from({ length: depth }, () => indentLeft + capWidth), indentLeft]
    return {
      lines: toFlowLines(broken, font, sizePt, offsets, notes.markToNote),
      capSize,
      capWidth
    }
  }

  // Ask for three lines; if the paragraph turns out shorter, ask again at the
  // depth it can actually support rather than hanging the initial below its
  // own text. Running the builder twice is cheap and keeps it a pure function.
  let depth = DROP_CAP_LINES
  let built = build(depth)
  if (built.lines.length < depth) {
    depth = Math.max(1, built.lines.length)
    built = build(depth)
  }

  const capLine = built.lines[depth - 1] ?? built.lines[built.lines.length - 1]
  if (capLine && initial) {
    capLine.decorations = [{ text: initial, font, sizePt: built.capSize, xPt: indentLeft }]
  }

  return {
    lines: built.lines,
    spaceBefore: 0,
    spaceAfter: 0,
    startsChapter: false,
    chapter: null,
    keepWithNext: false,
    orphanControl: true
  }
}

/** The running-head text for one side of a page. */
function runningHeadText(
  mode: StyleProfile['runningHeads']['verso'],
  edition: LayoutEdition,
  page: PageBuilder,
  folio: string | null
): string {
  switch (mode) {
    case 'bookTitle':
      return edition.title
    case 'author':
      return edition.author
    case 'chapterTitle':
      return page.chapterTitle ?? edition.title
    case 'pageNumber':
      return folio ?? ''
    case 'none':
    default:
      return ''
  }
}

/**
 * `take`, pulled back so a page break cannot fall inside a held run of lines.
 *
 * Lines carrying `holdWithNext` may not end a page. Taking every line to the
 * end of the item is always allowed — there is nothing after it to be parted
 * from — so the walk only applies to a partial take.
 */
function heldBoundary(flow: Flowable, placed: number, take: number, remaining: number): number {
  let out = take
  while (out > 0 && out < remaining && flow.lines[placed + out - 1]?.holdWithNext) out--
  return out
}

export function layout(
  raw: BookDocument,
  profile: StyleProfile,
  measurer: TextMeasurer,
  options: LayoutOptions
): LaidOutBook {
  // Presentation, applied on the way in for the same reason optical margins are
  // applied on the way out: the transcription records what the page said, and
  // the shape of a quotation mark is not part of that. Idempotent, which
  // matters because `layoutWithToc` runs this twice.
  const doc = profile.typographicQuotes ? withTypographicQuotes(raw) : raw
  const rectoFrame = frameFor(profile, 'recto')
  const versoFrame = frameFor(profile, 'verso')
  const leading = leadingFor(profile.bodyFontSize)
  const ascent = measurer.metrics(
    { family: profile.bodyFont, style: 'regular' },
    profile.bodyFontSize
  ).ascent
  const slotsPerPage = Math.max(1, linesPerFrame(rectoFrame, leading, ascent))

  const ctx: BuildContext = {
    profile,
    measurer,
    measureWidth: rectoFrame.widthPt,
    leading,
    // The style has the final say: a hyphenator can be supplied and still
    // declined, which is what `hyphenate: false` on the profile means.
    ...(options.hyphenate && profile.hyphenate ? { hyphenate: options.hyphenate } : {})
  }

  const pages: PageBuilder[] = []
  const chapterPages: LaidOutBook['chapterPages'] = []
  /** First page each block opens on — recorded as its first line is placed. */
  const blockPagesMap = new Map<string, number>()
  const warnings: LayoutWarning[] = []

  // --- footnote geometry ---------------------------------------------------
  //
  // A note block hangs off the bottom of the text frame: a separator rule, then
  // the notes. Everything below is a function of how many *note lines* a page
  // carries, so the flow can ask "how much body still fits?" before committing
  // a line whose reference would pull a new note onto the page.
  const noteSize = profile.bodyFontSize * NOTE_SIZE_RATIO
  const noteLeading = noteSize * NOTE_LEADING_RATIO
  const noteMetrics = measurer.metrics({ family: profile.bodyFont, style: 'regular' }, noteSize)
  const ruleGapAbove = leading * NOTE_RULE_GAP_ABOVE
  const ruleGapBelow = noteSize * NOTE_RULE_GAP_BELOW
  const frameBottom = rectoFrame.yPt + rectoFrame.heightPt
  const firstBaseline = rectoFrame.yPt + ascent

  /** Height of the note block, rule included, for a given number of note lines. */
  function noteBlockHeight(noteLines: number): number {
    if (noteLines <= 0) return 0
    return (
      NOTE_RULE_THICKNESS +
      ruleGapBelow +
      noteMetrics.ascent +
      (noteLines - 1) * noteLeading +
      noteMetrics.descent
    )
  }

  /** Where the separator rule sits when a page carries this many note lines. */
  function noteRuleY(noteLines: number): number {
    return frameBottom - noteBlockHeight(noteLines)
  }

  /**
   * How many body slots a page has left once its notes are accounted for.
   *
   * Monotone decreasing in `noteLines`, which is what makes the greedy
   * reservation in the flow below terminate: adding a note can only ever
   * shrink the body, never grow it.
   */
  function bodySlotsFor(noteLines: number): number {
    if (noteLines <= 0) return slotsPerPage
    const limit = noteRuleY(noteLines) - ruleGapAbove
    const slots = Math.floor((limit - firstBaseline) / leading) + 1
    return Math.max(0, Math.min(slotsPerPage, slots))
  }

  const frameFrom = (side: PageSide): PageFrame => (side === 'recto' ? rectoFrame : versoFrame)

  function newPage(section: PageSection, opts?: Partial<PageBuilder>): PageBuilder {
    // Page 0 is a recto; sides alternate from there, which is what makes
    // "chapters open on a right-hand page" a question about parity.
    const index = pages.length
    const side: PageSide = index % 2 === 0 ? 'recto' : 'verso'
    const previous = pages[pages.length - 1]
    const page: PageBuilder = {
      index,
      side,
      section,
      // Overridden by `opts` wherever the caller knows better; a page nobody
      // claims is a blank leaf until something is put on it.
      kind: 'blank',
      frame: frameFrom(side),
      lines: [],
      chapterTitle: previous?.chapterTitle ?? null,
      noteIds: [],
      suppressRunningHead: false,
      suppressFolio: false,
      ...opts
    }
    pages.push(page)
    return page
  }

  // --- front matter -------------------------------------------------------

  buildFrontMatter(pages, newPage, profile, options.edition, ctx, slotsPerPage)

  // Asides — dedication, epigraph, colophon — sit after the copyright page and
  // before the body, each on its own page, as they are in a printed book.
  for (const aside of doc.asides) {
    const flow = buildFlowable(aside, ctx, { suppressFirstIndent: true, dropCap: false })

    // Sunk a third down the leaf, as a dedication is set. The sink is dropped
    // on any continuation page: it is there to place the first line, not to
    // indent the rest.
    let start = Math.floor(slotsPerPage / 3)
    let placed = 0

    // Carries on to another leaf when it does not fit. Asides are usually two
    // lines, which is why this went unnoticed — but every line past the frame
    // was previously placed at a slot the page does not have, and drew below
    // the text block and off the bottom of the paper.
    while (placed < flow.lines.length) {
      const page = newPage('front')
      page.kind = 'aside'
      page.suppressRunningHead = true

      const room = Math.max(1, slotsPerPage - start)
      const take = Math.min(room, flow.lines.length - placed)
      for (let i = 0; i < take; i++) {
        page.lines.push({ slot: start + i, line: flow.lines[placed + i]! })
      }
      placed += take
      start = 0
    }
  }

  // The contents comes last in the front matter, after any dedication, and
  // opens on a recto as a display page does.
  if (options.toc && options.toc.length > 0) {
    // The same presentation the body gets, and for the same reason. The entries
    // are built from the *raw* document by `layoutWithToc`, so they never pass
    // through the conversion above: the body curled its quotes and the contents
    // did not. It went unseen while a contents was a column of capitalised
    // titles, which have no quotes in them, and showed the moment the
    // descriptions came back — they are prose, and this book's are full of
    // quoted phrases. Idempotent, like the conversion it mirrors.
    const toc = profile.typographicQuotes
      ? options.toc.map((entry) => ({
          ...entry,
          title: typographicQuotes(entry.title),
          ...(entry.label ? { label: typographicQuotes(entry.label) } : {}),
          ...(entry.synopsis ? { synopsis: typographicQuotes(entry.synopsis) } : {})
        }))
      : options.toc
    buildContents(pages, newPage, profile, toc, ctx, slotsPerPage)
  }

  // The body opens on a recto, so a lone verso here becomes a blank leaf.
  if (pages.length % 2 === 1) newPage('front').suppressFolio = true

  /**
   * Pages built *before* the flow — the display leaves and the contents.
   *
   * Distinct from the count of front-matter pages, which is only known after
   * the flow has run because an introduction flows through the same loop as the
   * body. This one exists for the preview's page cap, which is about how much
   * work to do rather than about numbering.
   */
  const displayPageCount = pages.length

  // --- body ---------------------------------------------------------------

  // Reference marks are located and renumbered before anything is broken,
  // because a mark occupies width and so is a line-breaking input.
  //
  // A table's text is hidden from the search. Its cells are set column by
  // column, so a mark found inside one has no word to ride on and no line to
  // land on — and a note claimed by a block that never prints its mark would be
  // reported as "the page was not laid out", which is a lie about a note the
  // reader will find missing. Hidden, it stays an orphan: reported truthfully,
  // and collected as an endnote when the structure gate asked for that.
  const prepared = prepareFootnotes(
    doc.blocks.map((b) => (b.kind === 'table' ? { id: b.id, text: '' } : b)),
    doc.footnotes,
    doc.bareMarks
  )

  // Every note broken to the measure once. A note's line count does not depend
  // on which page it lands on, so this is computed here and only looked up
  // during the flow.
  const noteBlocks = new Map<string, NoteBlock>()
  for (const note of prepared.notes.values()) {
    noteBlocks.set(note.id, breakNote(note, ctx))
  }
  const noteLinesOf = (id: string): number => noteBlocks.get(id)?.lines.length ?? 0

  // Where each picture falls in the reading order. Computed before anything is
  // broken so an illustration is a flowable like any other from here on, and
  // the placement loop needs to know nothing about pictures at all.
  // Pictures pinned inside a written section are placed by `sectionFlowables`,
  // so they are held back from the body anchoring — which would otherwise find
  // no block of that id and drop them at the end of the book as a lost
  // supplied image.
  const sectionBlockIds = new Set(doc.sections.flatMap((s) => s.blocks.map((b) => b.id)))
  const inSections = doc.illustrations.filter(
    (i) =>
      i.anchorAfterBlockId !== undefined &&
      i.anchorAfterBlockId !== null &&
      sectionBlockIds.has(i.anchorAfterBlockId)
  )
  const anchored = anchorIllustrations(
    doc.blocks,
    doc.illustrations.filter((i) => !inSections.includes(i))
  )

  const flowables: Flowable[] = []

  // Front matter the editor wrote — an introduction, a preface — comes first,
  // so every page it opens precedes every body page and the arabic numbering
  // that follows still starts at one.
  //
  // Skipped entirely for a sample: the design preview asks for a few body pages
  // and a four-page introduction in front of them would answer none of the
  // questions that gate exists to ask.
  if (options.maxBodyPages === undefined) {
    for (const section of doc.sections.filter((x) => x.placement === 'front')) {
      flowables.push(...sectionFlowables(section, ctx, profile, inSections, slotsPerPage))
    }
  }

  const pushIllustrationsAfter = (
    blockIndex: number,
    list: readonly { illustration: Illustration; warning?: string }[] = (
      anchored.get(blockIndex) ?? []
    ).map((illustration) => ({ illustration }))
  ): void => {
    for (const { illustration, warning } of list) {
      flowables.push(buildIllustrationFlowable(illustration, ctx, slotsPerPage, warning))
    }
  }

  /**
   * Headings that belong to the opening *below* them, and so print no flowable
   * of their own.
   *
   * A chapter opened by "LESSON I." over "THE ASTRAL SENSES." is one opening.
   * Assembly already says so — `doc.chapters` has one entry for the run — and
   * this is the other half: the earlier headings are handed to the last one as
   * a superscription, so the pair takes one page break, one ornament and one
   * sinkage between them. Keyed by the index of the heading that carries them.
   */
  const superscriptions = new Map<number, string[]>()
  const consumed = new Set<number>()
  for (let i = 0; i < doc.blocks.length; i++) {
    if (doc.blocks[i]!.kind !== 'heading') continue
    // The assembler's rule, not a copy of it: a number line is set small above
    // the title it belongs to, and a complete heading stands on its own.
    const end = headingRunEnd(doc.blocks, i)
    if (end > i) {
      superscriptions.set(
        end,
        doc.blocks
          .slice(i, end)
          .map((b) => b.text.trim())
          .filter((t) => t.length > 0)
      )
      for (let k = i; k < end; k++) consumed.add(k)
    }
    i = end
  }
  // The chapter each run reports, by the index of its last heading. Assembly
  // names a chapter by the *first* block of the run and the contents matches
  // folios back by identity, so the opening has to report that id rather than
  // the id of the block carrying the title.
  const runChapters = new Map(doc.chapters.map((c) => [c.blockIndex, c]))

  pushIllustrationsAfter(-1)
  doc.blocks.forEach((block, i) => {
    const previous = doc.blocks[i - 1]
    const afterHeading = previous?.kind === 'heading'
    const afterChapterHeading = afterHeading && (previous?.level ?? 1) === 1
    const prep = prepared.blocks[i]
    // A heading swallowed into the opening below it. Its pictures still travel
    // — a plate anchored to a block that prints no flowable must not vanish.
    if (consumed.has(i)) {
      pushIllustrationsAfter(i)
      return
    }
    if (block.kind === 'table') {
      flowables.push(...buildTableFlowables(block, ctx).map((f) => ({ ...f, blockId: block.id })))
      pushIllustrationsAfter(i)
      return
    }
    // A figure the paragraph hosts is built into it; the rest follow it.
    const { hosted, after } = partitionFigures(anchored.get(i) ?? [], ctx, slotsPerPage)
    // A run of headings off the leaf, or a label the editor put on one — the
    // same line in the same place, arrived at two ways because only one of them
    // is available to each.
    const above = superscriptions.get(i) ?? (block.label?.trim() ? [block.label.trim()] : undefined)
    const runStart = above ? i - above.length : i
    const chapter = above ? runChapters.get(runStart) : undefined
    flowables.push(
      buildFlowable(block, ctx, {
        // A paragraph directly under a heading is set flush: there is no
        // preceding paragraph for an indent to distinguish it from.
        suppressFirstIndent: afterHeading,
        dropCap: profile.dropCap && afterChapterHeading,
        ...(above ? { superscription: above } : {}),
        ...(chapter
          ? { chapter: { id: chapter.id, title: chapter.title, level: chapter.level } }
          : {}),
        ...(prep ? { text: prep.text, references: prep.references } : {}),
        ...(hosted && block.kind !== 'heading' ? { figure: hosted } : {})
      })
    )
    pushIllustrationsAfter(
      i,
      hosted && block.kind === 'heading'
        ? [
            ...after,
            {
              illustration: hosted,
              warning: fallbackWarning(hosted, 'a heading cannot host a figure')
            }
          ]
        : after
    )
  })

  // Back matter the editor wrote, after the body and before the collected
  // notes — an afterword belongs with the book, an apparatus after it.
  if (options.maxBodyPages === undefined) {
    for (const section of doc.sections.filter((x) => x.placement === 'back')) {
      flowables.push(...sectionFlowables(section, ctx, profile, inSections, slotsPerPage))
    }
  }

  // Notes with no reference mark cannot go at the foot of any page. When the
  // structure gate asked for them to be kept, they become a short back-matter
  // section: the author's words survive, visibly set apart from the notes that
  // *were* placed, rather than dropped or guessed at a position.
  const collected = options.orphanNotes === 'collect' ? prepared.orphans : []
  if (collected.length > 0) {
    flowables.push(
      buildFlowable(
        // Synthesised by the engine rather than read off a page, so its id
        // names what it is instead of where it came from. Nothing can correct
        // it — there is no scan behind it to correct it against.
        { id: 'endnotes', kind: 'heading', level: 1, text: ENDNOTES_TITLE, sourcePages: [] },
        ctx,
        {
          suppressFirstIndent: true,
          dropCap: false
        }
      )
    )
    for (const note of collected) {
      flowables.push(
        buildFlowable(
          {
            id: `endnote-${note.id}`,
            kind: 'paragraph',
            text: `${note.originalMarker} ${note.text}`.trim(),
            // The marker is prepended as a word, so every italic index moves
            // along by one. Dropped when there is no marker to prepend.
            ...(note.emphasis?.length
              ? {
                  emphasis: note.originalMarker.trim()
                    ? note.emphasis.map((i) => i + 1)
                    : note.emphasis
                }
              : {}),
            ...(note.strong?.length
              ? {
                  strong: note.originalMarker.trim() ? note.strong.map((i) => i + 1) : note.strong
                }
              : {}),
            // The same prepend, counted in characters: the marker and the space
            // after it push every range along by exactly their own length.
            ...(note.subscript?.length
              ? {
                  subscript: shiftRanges(
                    note.subscript,
                    note.originalMarker.trim() ? note.originalMarker.trim().length + 1 : 0
                  )
                }
              : {}),
            sourcePages: []
          },
          ctx,
          { suppressFirstIndent: true, dropCap: false }
        )
      )
    }
  }

  let page: PageBuilder | null = null
  let slot = 0
  const maxBodyPages = options.maxBodyPages ?? Infinity

  const bodyPageCount = (): number => pages.length - displayPageCount

  let flowSection: PageSection = 'body'

  function openBodyPage(forceRecto: boolean): void {
    if (forceRecto && pages.length % 2 === 1) {
      // The blank verso belongs to what it *closes*, not to what follows it.
      // Marking it with the incoming section would make the last leaf of the
      // front matter a body page, and the body's arabic numbering would then
      // start at two.
      const blank = newPage(pages[pages.length - 1]?.section ?? flowSection)
      blank.suppressRunningHead = true
      // A mark in the middle of it, when the style asks for one. Set on the
      // page's own middle rather than the measure's, because there is nothing
      // else on the leaf for it to sit against, and the folio is suppressed
      // here so the text block's own centre would read low.
      const mark = findOrnament(ctx.profile.ornaments.blankPage)
      if (mark) {
        const widthPt = ctx.measureWidth * BLANK_PAGE_ORNAMENT_RATIO
        blank.lines.push({
          slot: Math.floor(slotsPerPage / 2),
          line: { runs: [], ornament: { art: mark, widthPt } }
        })
      }
    }
    page = newPage(flowSection)
    slot = 0
  }

  /**
   * The page being filled. `page` is only ever null before the first body page
   * is opened, and every call site below has opened one — but that fact lives
   * in a closure, which is exactly the thing narrowing can't see through.
   */
  function current(): PageBuilder {
    if (page === null) throw new Error('layout: no page open')
    return page
  }

  for (let i = 0; i < flowables.length; i++) {
    const flow = flowables[i]!
    flowSection = flow.pageSection ?? 'body'

    // A plate takes a leaf of its own, so it only needs a fresh page when the
    // current one has been written on. Asking for one unconditionally would
    // leave a blank page in front of every plate that happened to fall at a
    // page break already.
    const needsOwnPage = flow.ownPage === true && page !== null && current().lines.length > 0

    if (flow.startsChapter || needsOwnPage || page === null) {
      if (bodyPageCount() >= maxBodyPages) break
      // A chapter opens on a right-hand page only if the style asks for it.
      // Traditional, and it costs paper — a book of short chapters can gain
      // thirty leaves to blank versos.
      openBodyPage(flow.startsChapter && ctx.profile.chaptersOpenRecto)
      if (flow.startsChapter) {
        current().suppressRunningHead = true
        current().kind = 'chapter-opener'
        slot = CHAPTER_SINK_SLOTS
      }
    }

    // Space before collapses at the top of a page — leading white at the head
    // of a page is a hole, not a separation.
    if (slot > 0) slot += flow.spaceBefore

    if (flow.ownPage) {
      current().kind = 'plate'
      // A running head over a full-page plate labels the picture with the
      // chapter's name, which is furniture where there is no text to furnish.
      current().suppressRunningHead = true
      // Centred on the leaf, so the picture sits in it rather than hanging from
      // the top. Rounded to a whole slot so it stays on the baseline grid, and
      // measured against the drawn height rather than the slot count — a
      // picture's height is not a whole number of slots, and centring by slots
      // alone leaves it visibly high.
      //
      // This *replaces* the sink rather than adding to it, and comes after the
      // space-before line for that reason: the separation an illustration asks
      // for in the text flow is already provided by the leaf being its own.
      const content = flow.contentHeightPt ?? flow.lines.length * leading
      const sink = Math.round((rectoFrame.heightPt - content) / 2 / leading)
      // Clamped so centring can never push the last slot off the page: the
      // sizing above only guarantees the item *fits*, not that it fits twice.
      slot = Math.max(0, Math.min(sink, slotsPerPage - flow.lines.length))
    }

    let placed = 0
    // Which page a heading opens on is only known once its first line is
    // actually placed: the paragraph before it may have run over, so the page
    // that was current when the heading was *reached* is often the wrong one.
    let headingRecorded = false
    while (placed < flow.lines.length) {
      // A page is always open here: the block above opened one if there wasn't.
      const pageNoteLines = current().noteIds.reduce((n, id) => n + noteLinesOf(id), 0)
      let bodySlots = bodySlotsFor(pageNoteLines)
      let available = bodySlots - slot
      if (available <= 0) {
        if (bodyPageCount() >= maxBodyPages) break
        openBodyPage(false)
        bodySlots = slotsPerPage
        available = slotsPerPage
      }

      const remaining = flow.lines.length - placed
      let take = Math.min(available, remaining)

      if (flow.orphanControl && remaining >= 2) {
        // An orphan: the first line of a paragraph alone at the foot of a page.
        if (placed === 0 && take === 1) take = 0
        // A widow: the last line of a paragraph alone at the head of the next.
        else if (remaining - take === 1) take -= 1
      }

      // A heading with nothing under it is stranded; move it with its text.
      if (flow.keepWithNext && take === remaining && bodySlots - slot - take < 1) {
        take = 0
      }

      // An illustration is not a paragraph: half of one on each side of a page
      // break is not a picture. Take all of it or none of it, and let the
      // "never push an item off a page it is alone on" clamp below handle the
      // one case where none of it will ever fit.
      if (flow.unbreakable && take < remaining) {
        take = 0
      }

      // Never break inside a held run: back off to the line before it starts.
      // If that leaves nothing, the clamp below decides, exactly as it does
      // for an unbreakable item.
      take = heldBoundary(flow, placed, take, remaining)

      // Reserve for the notes these lines would pull onto the page.
      //
      // Greedy and forward-only: a line whose reference brings a new note
      // shrinks the body area *before* the line is placed, and if it no longer
      // fits, that line and everything after it move to the next page. Because
      // the reservation only ever shrinks the body, this settles in one pass —
      // there is nothing to re-flow, which is why the second pass the plan
      // budgeted for turned out not to be needed.
      const beforeNotes = take
      const claimed = new Set(current().noteIds)
      let claimedLines = pageNoteLines
      let allowed = 0
      for (let k = 0; k < take; k++) {
        const ids = flow.lines[placed + k]!.noteIds ?? []
        const fresh = ids.filter((id) => !claimed.has(id) && noteBlocks.has(id))
        const lines = claimedLines + fresh.reduce((n, id) => n + noteLinesOf(id), 0)
        if (slot + k + 1 > bodySlotsFor(lines)) break
        for (const id of fresh) claimed.add(id)
        claimedLines = lines
        allowed = k + 1
      }
      const noteLimited = allowed === 0 && beforeNotes > 0
      take = Math.min(take, allowed)
      // The reservation can cut into a held run too.
      take = heldBoundary(flow, placed, take, remaining)

      if (take <= 0) {
        // Never push an item off a page it is the only occupant of — that
        // loops forever and would emit blank pages in the middle of a chapter.
        if (current().lines.length === 0 && slot === 0) {
          // When it was the notes that blocked it, take a single line: the note
          // is longer than the page it belongs to, so something has to give,
          // and one line plus an over-long note beats an infinite loop. The
          // drawing code keeps the note below the text either way, and the
          // warning tells the user which page to look at.
          take = noteLimited ? 1 : Math.min(available, remaining)
        } else {
          if (bodyPageCount() >= maxBodyPages) break
          openBodyPage(false)
          continue
        }
      }

      // What the builder could not do as asked, against the page it fell on.
      if (placed === 0 && take > 0 && flow.warning) {
        warnings.push({ pageIndex: current().index, text: flow.warning })
      }

      for (let k = 0; k < take; k++) {
        const line = flow.lines[placed + k]!
        if (current().kind === 'blank') current().kind = 'body'
        current().lines.push({ slot: slot + k, line })

        // The notes this line refers to now belong to this page. Committed
        // here, from the lines actually placed, rather than from the trial
        // above — a line the clamp rejected must not leave its note behind.
        for (const id of line.noteIds ?? []) {
          if (noteBlocks.has(id) && !current().noteIds.includes(id)) {
            current().noteIds.push(id)
          }
        }

        // Reported here rather than at breaking time: a warning is only useful
        // if it says which page to look at, and that isn't known until now.
        if (line.overfull) {
          warnings.push({
            pageIndex: current().index,
            text: line.runs.map((r) => r.text).join(' ')
          })
        }
      }

      if (noteLimited) {
        warnings.push({
          pageIndex: current().index,
          text: 'a footnote is longer than the page it belongs to'
        })
      }

      // The block's opening page is only known once its first line is placed
      // — the same reasoning as the chapter record below.
      if (
        take > 0 &&
        placed === 0 &&
        flow.blockId !== undefined &&
        !blockPagesMap.has(flow.blockId)
      ) {
        blockPagesMap.set(flow.blockId, current().index)
      }

      if (flow.chapter && !headingRecorded) {
        headingRecorded = true
        chapterPages.push({
          id: flow.chapter.id,
          title: flow.chapter.title,
          level: flow.chapter.level,
          pageIndex: current().index
        })
        // Only a chapter drives the running head. A sub-heading that happens to
        // fall on the page must not replace the chapter's name in it, or the
        // reader loses the one thing the head is there to tell them.
        if (flow.chapter.level === 1) current().chapterTitle = flow.chapter.title
      }

      slot += take
      placed += take
    }

    if (placed < flow.lines.length) break
    slot += flow.spaceAfter
  }

  // --- page furniture and finishing --------------------------------------

  /**
   * Set a page's footnotes at the foot of its text frame.
   *
   * The rule normally hangs off the bottom of the frame, so the notes sit on
   * the baseline the body would have ended on. The clamp is what makes that
   * safe: on a page whose note is taller than the space reserved for it — the
   * degenerate case the flow warns about — the rule drops to just below the
   * last body line instead, so notes overflow the bottom margin rather than
   * printing on top of the text.
   */
  function drawNotes(page: PageBuilder, items: PageItem[]): void {
    if (page.noteIds.length === 0) return

    const blocks = page.noteIds.map((id) => noteBlocks.get(id)).filter((b): b is NoteBlock => !!b)
    const noteLines = blocks.reduce((n, b) => n + b.lines.length, 0)
    if (noteLines === 0) return

    const lastBodySlot = page.lines.reduce((max, l) => Math.max(max, l.slot), -1)
    const lastBodyBaseline =
      lastBodySlot < 0 ? firstBaseline - leading : firstBaseline + lastBodySlot * leading

    const ruleY = Math.max(noteRuleY(noteLines), lastBodyBaseline + ruleGapAbove)

    items.push({
      kind: 'rule',
      xPt: page.frame.xPt,
      yPt: ruleY,
      widthPt: page.frame.widthPt * NOTE_RULE_WIDTH_RATIO,
      thicknessPt: NOTE_RULE_THICKNESS
    })

    let baseline = ruleY + NOTE_RULE_THICKNESS + ruleGapBelow + noteMetrics.ascent
    for (const block of blocks) {
      for (const line of block.lines) {
        const runs = runsAt(line, page.frame.xPt)
        if (runs.length > 0) items.push({ kind: 'line', baselinePt: baseline, runs })
        baseline += noteLeading
      }
    }
  }

  const trim = trimToPoints(profile.trimSize)

  /**
   * How many leaves are front matter, counted from the pages themselves.
   *
   * Read off `page.section` rather than captured before the flow, because front
   * matter that flows — an introduction — is produced by the same loop as the
   * body and so is not countable in advance. Every front page precedes every
   * body page, so a count is all the arabic numbering needs.
   */
  const frontMatterPageCount = pages.filter((p) => p.section === 'front').length

  const laidOut: LaidOutPage[] = pages.map((p) =>
    finishPage(p, profile, options.edition, measurer, {
      leading,
      ascent,
      frontMatterPageCount,
      trim,
      drawNotes
    })
  )

  // Every note that found a reference was placed, because a page is only ever
  // closed once the lines referencing its notes have been set. Anything left
  // over never had a reference to attach to, and is reported rather than lost.
  const placedIds = new Set(pages.flatMap((p) => p.noteIds))
  const collectedIds = new Set(collected.map((note) => note.id))
  const notesDropped = [
    ...prepared.orphans
      .filter((note) => !collectedIds.has(note.id))
      .map((note) => ({
        id: note.id,
        reason: 'no reference mark for this note was found in the text'
      })),
    ...[...prepared.notes.values()]
      .filter((note) => !placedIds.has(note.id))
      .map((note) => ({
        id: note.id,
        reason: 'its reference falls on a page that was not laid out'
      }))
  ]

  // What each picture was actually set at — read back off the finished pages
  // rather than from the sizing arithmetic, so the reported resolution is the
  // resolution of the box that will be drawn and not of the one intended.
  const sizeById = new Map(
    doc.illustrations.map((i) => [i.id, { w: i.sourceWidth, h: i.sourceHeight }])
  )
  const imagesPlaced: PlacedImage[] = []
  for (const page of laidOut) {
    for (const item of page.items) {
      if (item.kind !== 'image') continue
      const source = sizeById.get(item.id)
      imagesPlaced.push({
        id: item.id,
        pageIndex: page.index,
        widthPt: item.widthPt,
        heightPt: item.heightPt,
        // Along the wider of the two axes the image is scaled by the same
        // factor, so either gives the same answer; width is used because a
        // crop's width is the dimension the measure fixes.
        dpi: source ? effectiveDpi(source.w, item.widthPt / PT_PER_INCH) : 0
      })
    }
  }

  const placedImageIds = new Set(imagesPlaced.map((i) => i.id))
  const imagesDropped = doc.illustrations
    .filter((i) => !placedImageIds.has(i.id))
    .map((i) => ({
      id: i.id,
      reason: 'it falls after the last page that was laid out'
    }))

  return {
    pages: laidOut,
    widthPt: trim.widthPt,
    heightPt: trim.heightPt,
    chapterPages,
    blockPages: [...blockPagesMap].map(([blockId, pageIndex]) => ({
      blockId,
      pageIndex,
      folio: folioFor(pages[pageIndex]!, frontMatterPageCount)
    })),
    fontsUsed: collectFonts(laidOut),
    warnings,
    notesPlaced: placedIds.size,
    notesCollected: collected.length,
    notesDropped,
    bareMarksMissed: prepared.bareMarksMissed,
    imagesPlaced,
    imagesDropped
  }
}

interface FinishContext {
  leading: number
  ascent: number
  frontMatterPageCount: number
  trim: { widthPt: number; heightPt: number }
  /** Draws the footnotes a page claimed. Returns nothing when it has none. */
  drawNotes: (page: PageBuilder, items: PageItem[]) => void
}

/** Turn a filled page into an immutable laid-out page, adding head and folio. */
function finishPage(
  page: PageBuilder,
  profile: StyleProfile,
  edition: LayoutEdition,
  measurer: TextMeasurer,
  ctx: FinishContext
): LaidOutPage {
  const frame = page.frame
  const items: PageItem[] = []

  for (const { slot, line } of page.lines) {
    const baseline = frame.yPt + ctx.ascent + slot * ctx.leading
    const runs = runsAt(line, frame.xPt)
    if (runs.length > 0) items.push({ kind: 'line', baselinePt: baseline, runs })

    if (line.image) {
      const { id, widthPt, heightPt } = line.image
      items.push({
        kind: 'image',
        id,
        // Centred in the measure and hung from the top of its slot, like the
        // ornament: a picture has no baseline to sit on either — unless the
        // line says which margin it stands against.
        xPt: frame.xPt + (line.image.xPt ?? (frame.widthPt - widthPt) / 2),
        yPt: frame.yPt + slot * ctx.leading,
        widthPt,
        heightPt
      })
    }

    if (line.rule) {
      items.push({
        kind: 'rule',
        xPt: frame.xPt + line.rule.xPt,
        yPt: frame.yPt + slot * ctx.leading + line.rule.yPt,
        widthPt: line.rule.widthPt,
        thicknessPt: line.rule.thicknessPt
      })
    }

    if (line.ornament) {
      const { art, widthPt } = line.ornament
      items.push({
        kind: 'ornament',
        // Centred in the measure, and hung from the top of its slot rather
        // than a baseline — it has no baseline to sit on.
        xPt: frame.xPt + (frame.widthPt - widthPt) / 2,
        yPt: frame.yPt + slot * ctx.leading,
        scale: widthPt / art.width,
        art
      })
    }
  }

  ctx.drawNotes(page, items)

  const folio = folioFor(page, ctx.frontMatterPageCount)

  if (folio !== null && profile.pageNumber !== 'none') {
    items.push(
      furnitureLine(folio, profile, measurer, page, {
        baseline:
          profile.pageNumber === 'topOuter'
            ? runningHeadBaseline(profile)
            : bottomFolioBaseline(profile),
        placement: profile.pageNumber === 'bottomCenter' ? 'center' : 'outer',
        frame
      })
    )
  }

  if (!page.suppressRunningHead && page.section === 'body') {
    const mode = page.side === 'verso' ? profile.runningHeads.verso : profile.runningHeads.recto
    const text = runningHeadText(mode, edition, page, folio)
    if (text.trim().length > 0) {
      items.push(
        furnitureLine(text, profile, measurer, page, {
          baseline: runningHeadBaseline(profile),
          placement: 'center',
          frame,
          head: true
        })
      )
    }
  }

  return {
    index: page.index,
    widthPt: ctx.trim.widthPt,
    heightPt: ctx.trim.heightPt,
    side: page.side,
    section: page.section,
    kind: page.kind,
    frame,
    items,
    folio,
    chapterTitle: page.chapterTitle
  }
}

function folioFor(page: PageBuilder, frontMatterPageCount: number): string | null {
  if (page.suppressFolio) return null
  if (page.lines.length === 0) return null
  return page.section === 'front'
    ? roman(page.index + 1)
    : String(page.index - frontMatterPageCount + 1)
}

/** A flow line's runs, moved from frame-relative to page-absolute. */
function runsAt(line: FlowLine, frameX: number): TextRun[] {
  return [
    ...(line.decorations ?? []).map((d) => ({ ...d, xPt: d.xPt + frameX })),
    ...line.runs.map((r) => ({ ...r, xPt: r.xPt + frameX }))
  ]
}

/** A single centred or outer-aligned line of page furniture. */
/**
 * A running head cut down until it fits the measure.
 *
 * A long title — and old books have very long titles — is set wider than the
 * text block and runs out into the margins, or off the paper. Shortening is
 * done in the order a person would do it by hand: drop the subtitle after a
 * colon first, because that is the part a running head never wants; then drop
 * a leading article; and only then truncate, at a word boundary, with an
 * ellipsis so the reader can see it was cut.
 *
 * Deterministic, and measured with the same measurer that draws — so "it fits"
 * means it fits.
 */
export function fitRunningHead(
  text: string,
  measurer: TextMeasurer,
  font: FontRef,
  sizePt: number,
  maxWidth: number
): string {
  const fits = (candidate: string): boolean => measurer.widthOf(candidate, font, sizePt) <= maxWidth

  const trimmed = text.trim()
  if (!trimmed || fits(trimmed)) return trimmed

  // The subtitle: everything after the first colon or semicolon. This is what
  // a printer drops first, and on a 17th-century title page it is most of the
  // words.
  const head = trimmed.split(/\s*[:;]\s*/u)[0]?.trim() ?? trimmed
  if (head && fits(head)) return head

  const shortest = head || trimmed
  const withoutArticle = shortest.replace(/^(the|a|an)\s+/iu, '')
  if (withoutArticle !== shortest && fits(withoutArticle)) return withoutArticle

  // Word by word from the end, with an ellipsis, so the cut is visible rather
  // than looking like a title that happens to end oddly.
  const words = withoutArticle.split(/\s+/u)
  for (let n = words.length - 1; n > 0; n--) {
    const candidate = `${words.slice(0, n).join(' ')}…`
    if (fits(candidate)) return candidate
  }

  // A single word wider than the measure. Nothing left to cut but the word.
  const only = words[0] ?? ''
  for (let n = only.length - 1; n > 1; n--) {
    const candidate = `${only.slice(0, n)}…`
    if (fits(candidate)) return candidate
  }
  return ''
}

function furnitureLine(
  text: string,
  profile: StyleProfile,
  measurer: TextMeasurer,
  page: PageBuilder,
  opts: {
    baseline: number
    placement: 'center' | 'outer'
    frame: PageFrame
    /**
     * Set as a running head rather than as a folio. Only the head takes
     * `runningHeadStyle`: a folio in small capitals is a folio in ordinary
     * figures, since digits have no lower case for `smcp` to map, and one in
     * italic is a mannerism nobody asked for.
     */
    head?: boolean
  }
): PositionedLine {
  const style = opts.head ? profile.runningHeadStyle : 'plain'
  // Real small capitals where the face has them; ordinary capitals where it
  // does not, exactly as a small-capped heading falls back. Never synthesised
  // by scaling capitals down — see `RunningHeadStyle`.
  const realSmallCaps = style === 'smallCaps' && measurer.hasSmallCaps(profile.bodyFont)
  const font: FontRef = {
    family: profile.bodyFont,
    style: style === 'italic' ? 'italic' : 'regular',
    ...(realSmallCaps ? { smallCaps: true } : {})
  }
  const sizePt = profile.bodyFontSize * 0.85
  // `smcp` maps *lower case* to small capitals, so text bound for the real
  // feature is handed over as written and only the fallback is upper-cased.
  const set = style === 'smallCaps' && !realSmallCaps ? text.toLocaleUpperCase() : text
  // Furniture never spills into the margins. A folio always fits; a running
  // head carrying a long title does not, and is cut down until it does.
  const fitted = fitRunningHead(set, measurer, font, sizePt, opts.frame.widthPt)
  const width = measurer.widthOf(fitted, font, sizePt)

  let x: number
  if (opts.placement === 'center') {
    x = opts.frame.xPt + (opts.frame.widthPt - width) / 2
  } else {
    // The outer edge is the one away from the spine: left on a verso page,
    // right on a recto.
    x = page.side === 'verso' ? opts.frame.xPt : opts.frame.xPt + opts.frame.widthPt - width
  }

  return {
    kind: 'line',
    baselinePt: opts.baseline,
    runs: fitted ? [{ text: fitted, font, sizePt, xPt: Math.round(x * 1000) / 1000 }] : []
  }
}

/**
 * Set the table of contents.
 *
 * The folio sits in a column of fixed width at the right of the measure, and
 * the title is broken to what is left. That is not a cosmetic choice: it is
 * what makes the two-pass layout converge. If the number could push a title
 * onto another line, adding the real page numbers in the second pass could
 * lengthen the contents, which would shift every page it was numbering — the
 * classic way a two-pass table of contents fails to settle. With the column
 * fixed, the line count is decided by the titles alone, which are known before
 * any layout has been run at all.
 */
/** The contents' description, and the number line, against the body size. */
const SYNOPSIS_SCALE = 0.86

/**
 * How many lines of a description must follow its chapter head onto the page.
 *
 * A contents page is scanned rather than read, so a chapter number and title
 * at the foot of a leaf with the description overleaf is worse here than the
 * same break in the body would be: what the eye is hunting for is the heading,
 * and it finds one standing over nothing. Two is the ordinary orphan count,
 * and a description shorter than two lines goes over whole.
 */
const DESCRIPTION_ORPHAN_LINES = 2

/**
 * How a page number reads in the contents, wherever it appears.
 *
 * One function because there are two places that print one — under a
 * description, and on the last line of an entry that has none — and they had
 * drifted: "Page 43" in one and a bare "xvii" in the other, on the same page.
 * The editor's ruling is that a contents presents a page number one way and
 * only one way, so the wording is not conditional on anything: not on whether
 * the entry has a description, and not on whether the contents is a
 * descriptive one at all.
 */
const folioLabel = (folio: string): string => `Page ${folio}`

function buildContents(
  pages: PageBuilder[],
  newPage: (section: PageSection, opts?: Partial<PageBuilder>) => PageBuilder,
  profile: StyleProfile,
  toc: readonly TocLine[],
  ctx: BuildContext,
  slotsPerPage: number
): void {
  const body: FontRef = { family: profile.bodyFont, style: 'regular' }
  const heading: FontRef = { family: profile.headingFont, style: 'regular' }
  const sizePt = profile.bodyFontSize

  // Wide enough for four digits and a little air — more than any interior KDP
  // will print, so the column never has to grow.
  const folioColumn = ctx.measurer.widthOf('8888', body, sizePt) + sizePt * 0.5

  if (pages.length % 2 === 1) {
    const blank = newPage('front')
    blank.suppressFolio = true
    blank.suppressRunningHead = true
  }

  let page = newPage('front')
  page.kind = 'contents'
  page.suppressRunningHead = true
  page.suppressFolio = true

  let slot = CHAPTER_SINK_SLOTS

  // An analytical contents centres its chapter titles, which is how these pages
  // have been set since long before this book: the title sits over the
  // paragraph that describes it, and the pair reads as one thing. A plain list
  // of names and numbers does not — there the eye runs down a column of first
  // letters, and centring would take that column away.
  //
  // Decided for the page rather than per entry. Some entries carry no
  // description — a head inside a chapter, a back-matter section — and mixing
  // centred titles with flush-left ones down one page looks like a mistake.
  const descriptive = toc.some((entry) => entry.synopsis)

  // The axis the page is centred on.
  //
  // An entry is centred over the measure *less* the folio column, because its
  // number sits in that lane and a title centred through it would run into the
  // digits. The heading was centred over the whole measure, so the two disagreed
  // by half the folio column — 17pt on a 6×9 page, which is not subtle: CONTENTS
  // sat visibly right of every title under it. One page, one axis.
  //
  // Only when the entries are centred. A flush-left list has no axis of its own
  // to agree with, and there a heading centred over the full measure is what a
  // printed contents looks like.
  // A descriptive contents no longer reserves a lane for the folio: the number
  // is set on a line of its own after each description, which is where the
  // original of this book puts it, so the whole measure is available and the
  // heading and the titles under it are centred on the same width.
  const axis = descriptive ? ctx.measureWidth : ctx.measureWidth

  // The heading, set like a chapter title so the contents reads as part of the
  // same book rather than as an appendage — and small-capped by the same rule
  // as one, real glyphs where the face has them and full capitals where it
  // does not.
  const scContents =
    profile.headingStyle.smallCaps && ctx.measurer.hasSmallCaps(profile.headingFont)
  const titleText = profile.headingStyle.smallCaps && !scContents ? 'CONTENTS' : 'Contents'
  const titleFont: FontRef = scContents ? { ...heading, smallCaps: true } : heading
  const titleSize = sizePt * profile.headingStyle.scale
  for (const line of breakParagraph(titleText, {
    font: titleFont,
    sizePt: titleSize,
    measurer: ctx.measurer,
    lineWidths: Math.max(1, axis),
    alignment: profile.headingStyle.centered ? 'center' : 'left'
  })) {
    page.lines.push({
      slot,
      line: {
        runs: line.words.map((w) => ({
          text: w.text,
          // `titleFont`, not `heading`: measured and drawn must be the same
          // reference, or the centring is computed for one face and set in
          // another.
          font: titleFont,
          sizePt: titleSize,
          xPt: w.xPt
        }))
      }
    })
    slot += 1
  }
  slot += CHAPTER_GAP_SLOTS

  // How an entry is set in a descriptive contents, taken from the original of
  // this book: the number small on a line of its own, the title under it, the
  // description at full measure below, and the folio on a line after that.
  //
  // The sizes are the point of it. Set at the body size the titles came out
  // larger than the paragraph they head and, with a lane reserved for the
  // folio, wider than it too, so each one stuck out past both edges of its own
  // description. In the original the title is barely larger than the
  // description and never reaches the margin.
  //
  // Set in the *same* face and weight as the description, which is what the
  // original does. The device that makes its title a heading is letterspacing,
  // not weight — and this engine has no tracking, so the only lever left is
  // size, and a modest step is the honest substitute. Bold was the wrong lever:
  // the original's description is a heavy old face, so a same-weight title sits
  // level with it, while ours sets a light description under a bold title and
  // the title shouts. Sized against the label rather than against nothing: the
  // number line measures 0.87 of the title on the page at 600 dpi.
  //
  // The description's size is the unit: the number line is set at it exactly,
  // and the title one step above. The step was 1.15 and still read too large
  // over the number line — a ratio rather than a subtraction, because a point
  // off a 12pt book is not the same decision as a point off a 10pt one.
  const entryTitleSize = sizePt * SYNOPSIS_SCALE * 1.053
  const entryLabelSize = sizePt * SYNOPSIS_SCALE
  const entryTitleFont: FontRef = { family: profile.bodyFont, style: 'regular' }

  toc.forEach((entry, i) => {
    const indent = Math.max(0, entry.level - 1) * sizePt
    // A title that wraps hangs its continuation, so the eye can tell a second
    // line of one entry from the first line of the next. Nothing hangs in a
    // centred setting: the second line is centred under the first, and an
    // indent on top of that would put it off axis.
    const hang = descriptive ? 0 : sizePt
    const measure = descriptive
      ? Math.max(1, ctx.measureWidth - indent)
      : Math.max(1, ctx.measureWidth - folioColumn - indent)

    const labelLines =
      descriptive && entry.label
        ? breakParagraph(entry.label, {
            font: body,
            sizePt: entryLabelSize,
            measurer: ctx.measurer,
            lineWidths: measure,
            alignment: 'center'
          })
        : []

    const broken = descriptive
      ? balancedLines(entry.title, {
          font: entryTitleFont,
          sizePt: entryTitleSize,
          measurer: ctx.measurer,
          maxWidth: measure
        })
      : breakParagraph(entry.label ? `${entry.label} ${entry.title}` : entry.title, {
          font: body,
          sizePt,
          measurer: ctx.measurer,
          lineWidths: [measure, Math.max(1, measure - hang)],
          alignment: 'left'
        })
    if (broken.length === 0) return

    // The description, set smaller and indented under the entry — the shape an
    // analytical contents has always had, so it reads as one block with its
    // chapter rather than as loose text between two.
    //
    // Measured to the full width less the folio column, because nothing hangs
    // in the number's lane: an entry's folio belongs to its title line, and a
    // description running under it would collide with the digits.
    const synopsisSize = sizePt * SYNOPSIS_SCALE
    // Full measure in a descriptive contents, and no indent: the description is
    // the widest thing on the page and the title is centred over it. Reserving
    // the folio's lane here is what made a title wider than the paragraph it
    // heads, and the folio is no longer on that line to need one.
    const synopsisIndent = descriptive ? indent : indent + sizePt * 1.5
    const synopsisLines = entry.synopsis
      ? breakParagraph(entry.synopsis, {
          font: body,
          sizePt: synopsisSize,
          measurer: ctx.measurer,
          lineWidths: [
            Math.max(
              1,
              descriptive
                ? ctx.measureWidth - synopsisIndent
                : ctx.measureWidth - folioColumn - synopsisIndent
            )
          ],
          alignment: descriptive ? 'justify' : 'left'
        })
      : []

    // A blank line before each top-level entry after the first, so chapters
    // group visibly when there are sub-headings between them.
    const gapBefore = i > 0 && entry.level === 1 ? 1 : 0
    // The number, the title and the first lines of the description are one
    // block: a chapter head at the foot of a leaf with its description
    // overleaf reads as a heading with nothing under it, which on a contents
    // page is exactly the thing a reader is scanning for. Two lines is the
    // ordinary orphan count, and a description shorter than that goes whole.
    //
    // Safe for the two-pass scheme: every term here — the label, the title,
    // the description — is the same in both passes. Only the folio differs,
    // and the folio is not in this test.
    const keepUnder = Math.min(synopsisLines.length, DESCRIPTION_ORPHAN_LINES)
    if (slot + gapBefore + labelLines.length + broken.length + keepUnder > slotsPerPage) {
      page = newPage('front')
      page.kind = 'contents'
      page.suppressRunningHead = true
      page.suppressFolio = true
      slot = 0
    } else {
      slot += gapBefore
    }

    // The number line, small and centred above the title it belongs to.
    for (const line of labelLines) {
      page.lines.push({
        slot,
        line: {
          runs: line.words.map((w) => ({
            text: w.text,
            font: body,
            sizePt: entryLabelSize,
            xPt: w.xPt + indent
          }))
        }
      })
      slot += 1
    }

    broken.forEach((line, lineIndex) => {
      const runs: TextRun[] = line.words.map((w) => ({
        text: w.text,
        font: descriptive ? entryTitleFont : body,
        sizePt: descriptive ? entryTitleSize : sizePt,
        xPt: w.xPt + indent + (lineIndex === 0 ? 0 : hang)
      }))

      // In a plain list the number sits on the entry's *last* line, which is
      // where a reader looks for it when a title has wrapped. A descriptive
      // entry puts it after the description instead, so it does not squeeze the
      // title.
      //
      // Worded and sized the same either way. On a descriptive contents the
      // entries with no description — the editor's own front matter, a book
      // division — took the plain list's treatment, so a page of "Page 43" in
      // the description's size was interrupted by a bare "xvii" in the body's,
      // and the two read as different things on one page. They are the same
      // thing, so they are set the same.
      if (
        (!descriptive || synopsisLines.length === 0) &&
        lineIndex === broken.length - 1 &&
        entry.folio
      ) {
        const label = folioLabel(entry.folio)
        const size = descriptive ? synopsisSize : sizePt
        const width = ctx.measurer.widthOf(label, body, size)
        runs.push({ text: label, font: body, sizePt: size, xPt: ctx.measureWidth - width })
      }

      page.lines.push({ slot: slot + lineIndex, line: { runs } })
    })
    slot += broken.length

    // The description flows and may cross onto the next contents leaf, which is
    // ordinary for a page of this kind — the alternative is a page broken early
    // to keep an entry whole and a contents full of white space. What may not
    // cross is the join at its foot: the last line of the description and the
    // "Page 13" under it are one thing, and a number alone at the head of a
    // leaf reads as a mistake rather than as a page turn. So the two are placed
    // from one list, and the last pair is kept together.
    //
    // "Page 13", flush right on a line of its own under the description, which
    // is where this book's own contents puts it. On the title line it needed a
    // reserved lane, and that lane is what made every title narrower than the
    // paragraph it heads.
    // Only under a description. An entry with none — a written division, a
    // back-matter section — would otherwise leave its number stranded a line
    // below the title with nothing between them, which reads as a mistake. The
    // number goes on the title line there, as it does in a plain list.
    //
    // Reserved whether or not the number is known yet, which is the whole
    // reason the two-pass scheme works: pass one leaves the folios blank, and
    // if the line only appeared once they were filled in, pass two would be
    // longer by a line per entry. It was — the combined volume's contents ran
    // over onto another leaf, `layoutWithToc` caught the length change and fell
    // back to pass one, and pass one has no numbers in it at all. A contents
    // page with no page numbers, printed in silence. The guard was right; what
    // was wrong was giving it something to catch.
    const tail: TextRun[][] = synopsisLines.map((line) =>
      line.words.map((w) => ({
        text: w.text,
        font: body,
        sizePt: synopsisSize,
        xPt: w.xPt + synopsisIndent
      }))
    )
    if (descriptive && synopsisLines.length > 0) {
      const label = entry.folio ? folioLabel(entry.folio) : ''
      const width = ctx.measurer.widthOf(label, body, synopsisSize)
      tail.push(
        label
          ? [{ text: label, font: body, sizePt: synopsisSize, xPt: ctx.measureWidth - width }]
          : []
      )
    }

    tail.forEach((runs, k) => {
      // Two slots at the second-to-last line, so the last one cannot be left
      // on its own overleaf. One everywhere else.
      const needs = k === tail.length - 2 ? 2 : 1
      if (slot + needs > slotsPerPage) {
        page = newPage('front')
        page.kind = 'contents'
        page.suppressRunningHead = true
        page.suppressFolio = true
        slot = 0
      }
      page.lines.push({ slot, line: { runs } })
      slot += 1
    })

    // The original's own topics, under the chapter they belong to.
    //
    // Set smaller than the entry and indented under it, which is how a page of
    // this kind has always been set: the chapter's name stands over the list of
    // what is in it, and the eye runs down the topics and across to the
    // numbers.
    //
    // **The line is set whether or not there is a number yet**, and that is
    // what makes this safe for the two-pass scheme: pass one emits every topic
    // with its folio blank, so the contents is already the right length and
    // pass two only fills digits into a gap that was there. Skipping a topic
    // for want of a number would make pass two longer by a line per entry,
    // `layoutWithToc` would catch the change and fall back to pass one, and
    // pass one has no numbers on it at all. A descriptive contents shipped
    // exactly that way once, in silence.
    //
    // The folio's lane is reserved for a different and smaller reason: the
    // number is set flush right whatever the text does, so a topic measured to
    // the full width would crowd it. That is tidiness rather than correctness,
    // and it is worth saying so — an earlier draft of this comment claimed the
    // lane was what kept the two passes the same length, which is false,
    // because both passes measure to the same width either way.
    const topicSize = sizePt * SYNOPSIS_SCALE
    const topicIndent = indent + sizePt * 1.5
    const topicMeasure = Math.max(1, ctx.measureWidth - folioColumn - topicIndent)
    for (const topic of entry.topics ?? []) {
      // A topic that wraps hangs its continuation, so a second line of one
      // entry is not read as a fresh one.
      const lines = breakParagraph(topic.text, {
        font: body,
        sizePt: topicSize,
        measurer: ctx.measurer,
        lineWidths: [topicMeasure, Math.max(1, topicMeasure - sizePt)],
        alignment: 'left'
      })
      if (lines.length === 0) continue
      if (slot + lines.length > slotsPerPage) {
        page = newPage('front')
        page.kind = 'contents'
        page.suppressRunningHead = true
        page.suppressFolio = true
        slot = 0
      }
      lines.forEach((line, lineIndex) => {
        const runs: TextRun[] = line.words.map((w) => ({
          text: w.text,
          font: body,
          sizePt: topicSize,
          xPt: w.xPt + topicIndent + (lineIndex === 0 ? 0 : sizePt)
        }))
        if (lineIndex === lines.length - 1 && topic.folio) {
          const width = ctx.measurer.widthOf(topic.folio, body, topicSize)
          runs.push({
            text: topic.folio,
            font: body,
            sizePt: topicSize,
            xPt: ctx.measureWidth - width
          })
        }
        page.lines.push({ slot: slot + lineIndex, line: { runs } })
      })
      slot += lines.length
    }
  })
}

/** Front matter: half-title, title page, copyright page — replaced, not scanned. */
function buildFrontMatter(
  pages: PageBuilder[],
  newPage: (section: PageSection, opts?: Partial<PageBuilder>) => PageBuilder,
  profile: StyleProfile,
  edition: LayoutEdition,
  ctx: BuildContext,
  slotsPerPage: number
): void {
  const body: FontRef = { family: profile.bodyFont, style: 'regular' }
  const heading: FontRef = { family: profile.headingFont, style: 'regular' }
  const trim = trimToPoints(profile.trimSize)

  /**
   * How far to move a frame-centred line to centre it on the *leaf* instead.
   *
   * The text frame is offset by the gutter, so anything centred in it sits
   * right of the middle of the paper. Nothing on an ordinary page reveals that
   * — there is no reference to compare against — but the title page's border is
   * drawn against the trim, and beside a box centred on the leaf a title
   * centred on the frame reads as crooked. On a title page the leaf is the
   * frame of reference, so that is what its type is centred on.
   */
  const trimOffset = (page: PageBuilder): number =>
    trim.widthPt / 2 - (page.frame.xPt + page.frame.widthPt / 2)

  /** Set the entries centred from `startSlot`, and say which slot is next free. */
  const centred = (
    page: PageBuilder,
    startSlot: number,
    entries: {
      text: string
      sizePt: number
      font: FontRef
      gapAfter?: number
      /** Break inside a narrower measure, so a long line splits evenly. */
      widthRatio?: number
      /**
       * Break so the lines come out near enough the same length. A title page
       * is display setting: "ASTRAL COLORS AND THOUGHT / FORMS" is a line and
       * an orphan, where the original reads "ASTRAL COLORS AND / THOUGHT
       * FORMS" and every line of it is doing work.
       */
      balanced?: boolean
    }[],
    opts: { onTrim?: boolean } = {}
  ): number => {
    let slot = startSlot
    const dx = opts.onTrim ? trimOffset(page) : 0
    for (const entry of entries) {
      if (entry.text.trim().length === 0) continue
      const width = page.frame.widthPt * (entry.widthRatio ?? 1)
      const broken = breakParagraph(entry.text, {
        font: entry.font,
        sizePt: entry.sizePt,
        measurer: ctx.measurer,
        lineWidths: width,
        alignment: 'center'
      })
      const inset = (page.frame.widthPt - width) / 2
      const laid = entry.balanced
        ? balancedLines(entry.text, {
            font: entry.font,
            sizePt: entry.sizePt,
            measurer: ctx.measurer,
            maxWidth: width
          })
        : broken

      /**
       * Where a line has to start to sit in the middle of the measure.
       *
       * Not something to take on trust from the breaker: `balancedLines`
       * re-breaks at whatever narrower width gives the same line count, and
       * centres inside *that*, so a balanced motto came out centred on a box
       * narrower than the one it was supposed to fill and sat visibly left of
       * the title under it. Measuring each line and centring it here makes the
       * result independent of which breaker produced it.
       */
      const centreOf = (line: BrokenLine): number => {
        const first = line.words[0]
        const last = line.words[line.words.length - 1]
        if (!first || !last) return 0
        const lineWidth =
          last.xPt + ctx.measurer.widthOf(last.text, entry.font, entry.sizePt) - first.xPt
        return (width - lineWidth) / 2 - first.xPt
      }
      // Slots are one *body* leading apart, and a title page sets type at up
      // to 1.6 times the body size. Advancing one slot a line put the second
      // line of a two-line title through the descenders of the first: on this
      // book "A Course of Advanced Lessons in / Clairvoyance and Occult
      // Powers" collided, on the title page, which is the first thing anybody
      // opens. Room is taken from the size actually being set.
      const perLine = Math.max(1, Math.ceil(leadingFor(entry.sizePt) / ctx.leading))
      for (const line of laid) {
        page.lines.push({
          slot,
          line: {
            runs: line.words.map((w) => ({
              text: w.text,
              font: entry.font,
              sizePt: entry.sizePt,
              xPt: w.xPt + centreOf(line) + inset + dx
            }))
          }
        })
        slot += perLine
      }
      slot += entry.gapAfter ?? 1
    }
    return slot
  }

  if (profile.frontMatter.halfTitle) {
    const page = newPage('front')
    page.kind = 'half-title'
    page.suppressFolio = true
    page.suppressRunningHead = true
    centred(page, Math.floor(slotsPerPage / 3), [
      { text: edition.title, sizePt: profile.bodyFontSize * 1.3, font: heading }
    ])
    // The half-title's verso is blank, as in every printed book.
    const blank = newPage('front')
    blank.suppressFolio = true
    blank.suppressRunningHead = true
  }

  if (profile.frontMatter.titlePage) {
    if (pages.length % 2 === 1) {
      const blank = newPage('front')
      blank.suppressFolio = true
      blank.suppressRunningHead = true
    }
    const page = newPage('front')
    page.kind = 'title'
    page.suppressFolio = true
    page.suppressRunningHead = true
    // The title takes the same treatment as a chapter heading, because it is
    // the same decision: real small capitals where the face has them, ordinary
    // capitals where it has none, never synthesised. A title page set in
    // upper and lower case while every heading in the book is capped reads as
    // two books bound together.
    const capped = profile.headingStyle.smallCaps
    const realSmallCaps = capped && ctx.measurer.hasSmallCaps(profile.headingFont)
    const titleFont: FontRef = realSmallCaps ? { ...heading, smallCaps: true } : heading
    const cap = (text: string): string =>
      capped && !realSmallCaps ? text.toLocaleUpperCase() : text
    const bordered = profile.frontMatter.titleBorder

    // A border round the leaf, which is how this series was set. Four rules to
    // a box: the engine draws one as a filled rectangle, so a tall narrow one
    // is a side and a wide flat one is a top. Positioned against the *trim*
    // rather than the text frame, because the frame is offset by the gutter and
    // a box centred on it would sit visibly right of the middle of the leaf —
    // which is also why everything set on this page is centred on the trim.
    if (bordered) {
      const insetX = trim.widthPt * 0.1
      const insetY = trim.heightPt * 0.075
      const box = (pad: number, weight: number): void => {
        const left = insetX + pad
        const top = insetY + pad
        const w = trim.widthPt - 2 * left
        const h = trim.heightPt - 2 * top
        const at = (xPt: number, yPt: number, widthPt: number, thicknessPt: number): void => {
          page.lines.push({
            slot: 0,
            line: {
              runs: [],
              rule: {
                xPt: xPt - page.frame.xPt,
                yPt: yPt - page.frame.yPt,
                widthPt,
                thicknessPt
              }
            }
          })
        }
        at(left, top, w, weight)
        at(left, top + h - weight, w, weight)
        at(left, top, weight, h)
        at(left + w - weight, top, weight, h)
      }
      box(0, 1.6)
      box(4, 0.6)
    }

    // Every line's baseline is one *body* ascent down its slot, whatever size
    // it is set at, so this is what a rule has to clear to sit under a title.
    const bodyAscent = ctx.measurer.metrics(body, profile.bodyFontSize).ascent

    /**
     * A pair of rules, the period's underline, centred on the leaf.
     *
     * `dropPt` is measured from the *baseline* of the line at `slot`, not from
     * the top of the slot, because the slot grid is a body leading and the
     * title is half as tall again: hung on the grid the rule fell most of a
     * line clear of the words it underlines.
     */
    const doubleRule = (slot: number, widthPt: number, dropPt: number): void => {
      const x = (trim.widthPt - widthPt) / 2 - page.frame.xPt
      const y = bodyAscent + dropPt
      page.lines.push({
        slot,
        line: { runs: [], rule: { xPt: x, yPt: y, widthPt, thicknessPt: 1.4 } }
      })
      page.lines.push({
        slot,
        line: { runs: [], rule: { xPt: x, yPt: y + 3.4, widthPt, thicknessPt: 0.6 } }
      })
    }

    // Everything on this page is set inside a measure of its own, narrower
    // than the text frame and struck from the *border* rather than from the
    // margins. The frame's right edge falls within a couple of points of the
    // inner rule, so type set to it ran up against the box; and the original
    // insets its block from the border by about this much, which is why its
    // subtitles break where they do ("ASTRAL COLORS AND / THOUGHT FORMS"). A
    // narrower measure is therefore not only room but part of the composition.
    const titleWidth = bordered ? trim.widthPt * 0.66 : page.frame.widthPt
    const inMeasure = titleWidth / page.frame.widthPt

    // What the book is one of, and the publisher's motto, above everything —
    // where this series printed them, inside the border.
    const smallPt = profile.bodyFontSize * 0.85
    // The motto belongs to the line above it, so it is set close under it and a
    // step smaller — its own size rather than the page's general small, which
    // also carries "by", "and" and the imprint tagline further down.
    const mottoPt = profile.bodyFontSize * 0.77
    let slot = Math.floor(slotsPerPage / 12)
    if (edition.seriesLine || edition.epigraph) {
      slot = centred(
        page,
        slot,
        [
          {
            text: cap(edition.seriesLine ?? ''),
            sizePt: profile.bodyFontSize * 0.95,
            font: body,
            widthRatio: inMeasure,
            gapAfter: 0
          },
          {
            text: cap(edition.epigraph ?? ''),
            sizePt: mottoPt,
            font: body,
            widthRatio: inMeasure,
            balanced: true
          }
        ],
        { onTrim: true }
      )
      slot += 1
    } else {
      slot = Math.floor(slotsPerPage / 4)
    }

    const titlePt = profile.bodyFontSize * profile.headingStyle.scale
    // At the body size on purpose: a slot is one *body* leading, so anything
    // larger makes every wrapped line take two of them, and a two-line subtitle
    // came out with a blank line down the middle of it.
    const subtitlePt = profile.bodyFontSize
    const works = edition.works ?? []

    /**
     * How wide the title's longest line is, and how many lines it takes.
     *
     * Both, because assuming one line got both wrong. Measuring the whole
     * string put a rule under a four-line title half as wide again as the
     * widest line above it; hanging that rule from the title's first slot then
     * drew it straight through the middle of the title, under line one of four.
     */
    const titleMetrics = (
      text: string,
      font: FontRef,
      sizePt: number,
      maxWidth: number
    ): { widestPt: number; lineCount: number } => {
      const broken = breakParagraph(text, {
        font,
        sizePt,
        measurer: ctx.measurer,
        lineWidths: maxWidth,
        alignment: 'center'
      })
      const widths = broken.map((line) => {
        const first = line.words[0]
        const last = line.words[line.words.length - 1]
        if (!first || !last) return 0
        return last.xPt + ctx.measurer.widthOf(last.text, font, sizePt) - first.xPt
      })
      return {
        widestPt: widths.length > 0 ? Math.max(...widths) : maxWidth,
        lineCount: Math.max(1, broken.length)
      }
    }

    /** One work: its name, the rule under it, and its subtitle. */
    const setWork = (from: number, work: TitlePageWork): number => {
      const text = cap(work.title)
      const after = centred(
        page,
        from,
        [{ text, sizePt: titlePt, font: titleFont, gapAfter: 0, widthRatio: inMeasure }],
        { onTrim: true }
      )
      // As wide as the title's longest line, hung under its *last* line, at the
      // distance the originals leave: measured off the 1916 sheet at half the
      // title's own size below the baseline, which is a fraction of the type
      // rather than a whole line of the body grid.
      const { widestPt, lineCount } = titleMetrics(text, titleFont, titlePt, titleWidth)
      const perLine = Math.max(1, Math.ceil(leadingFor(titlePt) / ctx.leading))
      doubleRule(from + (lineCount - 1) * perLine, widestPt, titlePt * 0.5)
      let next = after
      if (work.subtitle) {
        next = centred(
          page,
          next,
          [
            {
              text: cap(work.subtitle),
              sizePt: subtitlePt,
              font: body,
              widthRatio: inMeasure,
              balanced: true
            }
          ],
          { onTrim: true }
        )
      }
      return next
    }

    if (works.length > 1) {
      // Two books bound as one. Set in turn with "and" between, each under its
      // own rule, because a volume that prints them as one run-on title tells
      // the reader it is one book — which is the thing this edition most needs
      // not to say.
      works.forEach((work, i) => {
        if (i > 0) {
          // Midway between the subtitle above and the title below: three slots
          // clear on each side. One slot above and two below read as though it
          // belonged to the book underneath it rather than joining the two.
          slot = centred(
            page,
            slot + 1,
            [{ text: 'and', sizePt: smallPt, font: body, gapAfter: 2 }],
            { onTrim: true }
          )
        }
        slot = setWork(slot, work)
      })
    } else if (bordered) {
      slot = setWork(slot, works[0] ?? { title: edition.title })
    } else {
      // No border: the title, then the divider ornament under it.
      const text = cap(works[0]?.title ?? edition.title)
      const after = centred(page, slot, [{ text, sizePt: titlePt, font: titleFont, gapAfter: 2 }], {
        onTrim: true
      })
      const divider = findOrnament(profile.ornaments.sectionDivider)
      if (divider) {
        const widthPt = ctx.measureWidth * TITLE_ORNAMENT_WIDTH_RATIO
        const heightPt = (widthPt * divider.height) / divider.width
        page.lines.push({ slot: after, line: { runs: [], ornament: { art: divider, widthPt } } })
        slot = after + Math.max(1, Math.ceil(heightPt / ctx.leading)) + 2
      } else {
        slot = after
      }
      const subtitle = works[0]?.subtitle
      if (subtitle) {
        slot = centred(page, slot, [{ text: cap(subtitle), sizePt: subtitlePt, font: body }], {
          onTrim: true
        })
      }
    }

    // The author, well clear of the imprint at the foot. Named with "by" in
    // front, because on a page that carries a publisher's name as well the two
    // are otherwise just two lines of capitals and the reader has to guess
    // which is which.
    const footSlot = slotsPerPage - (edition.imprintLine?.trim() ? 5 : 3)
    centred(
      page,
      Math.min(slot + 2, footSlot - 4),
      [
        { text: 'by', sizePt: smallPt, font: body, gapAfter: 0 },
        { text: edition.author, sizePt: profile.bodyFontSize * 1.15, font: body, gapAfter: 0 }
      ],
      { onTrim: true }
    )
    if (edition.imprint) {
      const tagline = edition.imprintLine?.trim()
      centred(
        page,
        footSlot,
        [
          { text: edition.imprint, sizePt: profile.bodyFontSize, font: body, gapAfter: 0 },
          { text: tagline ?? '', sizePt: smallPt, font: { ...body, style: 'italic' } }
        ],
        { onTrim: true }
      )
    }
  }

  if (profile.frontMatter.copyrightPage) {
    // The copyright page is a verso, facing the title page.
    if (pages.length % 2 === 0) {
      const blank = newPage('front')
      blank.suppressFolio = true
      blank.suppressRunningHead = true
    }
    const page = newPage('front')
    page.kind = 'copyright'
    page.suppressFolio = true
    page.suppressRunningHead = true

    const sizePt = profile.bodyFontSize * 0.85
    const lines: string[] = []
    if (edition.copyrightHolder && edition.editionDate) {
      lines.push(`© ${edition.editionDate} ${edition.copyrightHolder}`)
    } else if (edition.copyrightHolder) {
      lines.push(`© ${edition.copyrightHolder}`)
    }
    if (edition.editionStatement) lines.push(edition.editionStatement)
    if (edition.isbn) lines.push(`ISBN ${edition.isbn}`)
    for (const notice of edition.notices ?? []) lines.push(notice)
    if (edition.imprint) lines.push(edition.imprint)

    // Set low on the page, ragged, the way a copyright page is.
    let slot = Math.max(0, slotsPerPage - lines.length * 3 - 2)
    for (const text of lines) {
      const broken = breakParagraph(text, {
        font: body,
        sizePt,
        measurer: ctx.measurer,
        lineWidths: page.frame.widthPt,
        alignment: 'left'
      })
      for (const line of broken) {
        page.lines.push({
          slot,
          line: { runs: line.words.map((w) => ({ text: w.text, font: body, sizePt, xPt: w.xPt })) }
        })
        slot += 1
      }
      slot += 1
    }
  }
}

/** Every distinct face the finished book draws with — what an embedder subsets. */
function collectFonts(pages: readonly LaidOutPage[]): FontRef[] {
  const seen = new Map<string, FontRef>()
  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind !== 'line') continue
      for (const run of item.runs) {
        seen.set(`${run.font.family}|${run.font.style}|${run.font.smallCaps ? 'sc' : ''}`, run.font)
      }
    }
  }
  return [...seen.values()]
}
