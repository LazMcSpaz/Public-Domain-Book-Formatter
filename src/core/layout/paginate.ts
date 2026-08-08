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
import type { BookBlock, BookDocument, BookSection, Illustration } from '@core/assemble'
import { effectiveDpi } from '@core/image'
import { breakParagraph, type Alignment, type Attachment, type BrokenLine } from './break-lines'
import { prepareFootnotes, type NoteReference, type PreparedNote } from './footnotes'
import { anchorIllustrations } from './illustrations'
import {
  bottomFolioBaseline,
  frameFor,
  leadingFor,
  linesPerFrame,
  runningHeadBaseline,
  trimToPoints
} from './frames'
import type { TextMeasurer } from './measure'
import {
  PT_PER_INCH,
  type FontRef,
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
export interface LayoutEdition {
  title: string
  author: string
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
export interface TocLine {
  /** The heading this entry is, so its folio can be matched back by identity. */
  id: string
  title: string
  level: number
  /** The printed folio, or null on the first pass when it isn't known yet. */
  folio: string | null
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

/** A caption is set smaller than the body, and in italic, as captions are. */
const CAPTION_SIZE_RATIO = 0.85
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
 * A block turned into placeable lines, with the rules about where it may break.
 * Line x offsets are relative to the *frame*, not the page, because the frame
 * moves between verso and recto and the breaking does not.
 */
interface Flowable {
  lines: FlowLine[]
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
  ornament?: { art: OrnamentArt; widthPt: number }
  /**
   * An illustration drawn at this slot. Like the ornament it flows through the
   * slot machinery, which is what keeps the text below it from being set on top
   * of it — the engine never draws over anything, it only runs out of slots.
   */
  image?: { id: string; widthPt: number; heightPt: number }
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
      return { ...base, indentLeftEms: 1.5, firstLineIndentEms: 0 }
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
  markToNote?: ReadonlyMap<string, string>
): FlowLine[] {
  return broken.map((line, i) => {
    const offset = leftOffsets[Math.min(i, leftOffsets.length - 1)] ?? 0
    const noteIds: string[] = []

    const runs = line.words.map((w) => {
      if (w.sizePt !== undefined && markToNote) {
        const noteId = markToNote.get(w.text)
        if (noteId !== undefined && !noteIds.includes(noteId)) noteIds.push(noteId)
      }
      return {
        text: w.text,
        font,
        sizePt: w.sizePt ?? sizePt,
        xPt: w.xPt + offset,
        ...(w.risePt ? { risePt: w.risePt } : {})
      }
    })

    return {
      runs,
      ...(line.overfull ? { overfull: true } : {}),
      ...(noteIds.length > 0 ? { noteIds } : {})
    }
  })
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
 * A division the editor wrote, as flowables.
 *
 * It opens like a chapter — on a recto, sunk down the page, with the running
 * head suppressed on its first leaf — because that is what a division of a book
 * looks like, and it is listed in the contents for the same reason. The only
 * thing that distinguishes front matter from back is `pageSection`, which is
 * what `folioFor` reads to number it in roman rather than arabic.
 */
function sectionFlowables(
  section: BookSection,
  ctx: BuildContext,
  profile: StyleProfile
): Flowable[] {
  const pageSection: PageSection = section.placement === 'front' ? 'front' : 'back'

  const title = buildFlowable(
    { id: `${section.id}-title`, kind: 'heading', level: 1, text: section.title, sourcePages: [] },
    ctx,
    { suppressFirstIndent: true, dropCap: false }
  )

  const body = section.blocks.map((block, i) =>
    buildFlowable(block, ctx, {
      // The first paragraph sits directly under the title, so it is set flush:
      // there is no preceding paragraph for an indent to distinguish it from.
      suppressFirstIndent: i === 0,
      dropCap: profile.dropCap && i === 0
    })
  )

  return [title, ...body].map((flow) => ({ ...flow, pageSection }))
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
  slotsPerPage: number
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

  let widthPt = ctx.measureWidth
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

  const broken = breakParagraph(note.text, {
    font,
    sizePt,
    measurer: ctx.measurer,
    lineWidths: Math.max(1, ctx.measureWidth - hang),
    alignment: 'left',
    ...(ctx.hyphenate ? { hyphenate: ctx.hyphenate } : {})
  })

  const lines = toFlowLines(broken, font, sizePt, [hang])
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

  const isChapter = block.kind === 'heading' && (block.level ?? 1) === 1

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

  const dropCap = opts.dropCap && block.kind === 'paragraph' && text.trim().length > 0
  if (!dropCap) {
    const broken = breakParagraph(text, {
      font,
      sizePt,
      measurer: ctx.measurer,
      lineWidths: measure,
      alignment: style.alignment,
      firstLineIndentPt: firstIndent,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(block.kind === 'paragraph' || block.kind === 'blockquote'
        ? { hyphenate: ctx.hyphenate }
        : {})
    })
    // A chapter opener may carry a flourish under its title. It belongs to the
    // heading's own lines so the two can never be separated by a page break.
    const flourish = isChapter ? findOrnament(ctx.profile.ornaments.chapterOpener) : null
    const lines = toFlowLines(broken, font, sizePt, [indentLeft], markToNote)

    return {
      lines: flourish ? [...lines, ...ornamentLines(flourish, ctx)] : lines,
      spaceBefore: style.spaceBefore,
      spaceAfter: style.spaceAfter,
      startsChapter: isChapter,
      chapter:
        block.kind === 'heading'
          ? { id: block.id, title: block.text.trim(), level: block.level ?? 1 }
          : null,
      keepWithNext: block.kind === 'heading',
      orphanControl: block.kind === 'paragraph'
    }
  }

  return buildDropCapFlowable(text, font, sizePt, indentLeft, measure, ctx, style, {
    attachments,
    markToNote
  })
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
  notes: { attachments: readonly Attachment[]; markToNote: ReadonlyMap<string, string> }
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

export function layout(
  doc: BookDocument,
  profile: StyleProfile,
  measurer: TextMeasurer,
  options: LayoutOptions
): LaidOutBook {
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
    buildContents(pages, newPage, profile, options.toc, ctx, slotsPerPage)
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
  const prepared = prepareFootnotes(doc.blocks, doc.footnotes)

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
  const anchored = anchorIllustrations(doc.blocks, doc.illustrations)

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
      flowables.push(...sectionFlowables(section, ctx, profile))
    }
  }

  const pushIllustrationsAfter = (blockIndex: number): void => {
    for (const illustration of anchored.get(blockIndex) ?? []) {
      flowables.push(buildIllustrationFlowable(illustration, ctx, slotsPerPage))
    }
  }

  pushIllustrationsAfter(-1)
  doc.blocks.forEach((block, i) => {
    const previous = doc.blocks[i - 1]
    const afterHeading = previous?.kind === 'heading'
    const afterChapterHeading = afterHeading && (previous?.level ?? 1) === 1
    const prep = prepared.blocks[i]
    flowables.push(
      buildFlowable(block, ctx, {
        // A paragraph directly under a heading is set flush: there is no
        // preceding paragraph for an indent to distinguish it from.
        suppressFirstIndent: afterHeading,
        dropCap: profile.dropCap && afterChapterHeading,
        ...(prep ? { text: prep.text, references: prep.references } : {})
      })
    )
    pushIllustrationsAfter(i)
  })

  // Back matter the editor wrote, after the body and before the collected
  // notes — an afterword belongs with the book, an apparatus after it.
  if (options.maxBodyPages === undefined) {
    for (const section of doc.sections.filter((x) => x.placement === 'back')) {
      flowables.push(...sectionFlowables(section, ctx, profile))
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
    fontsUsed: collectFonts(laidOut),
    warnings,
    notesPlaced: placedIds.size,
    notesCollected: collected.length,
    notesDropped,
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
        // ornament: a picture has no baseline to sit on either.
        xPt: frame.xPt + (frame.widthPt - widthPt) / 2,
        yPt: frame.yPt + slot * ctx.leading,
        widthPt,
        heightPt
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
          frame
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
function furnitureLine(
  text: string,
  profile: StyleProfile,
  measurer: TextMeasurer,
  page: PageBuilder,
  opts: {
    baseline: number
    placement: 'center' | 'outer'
    frame: PageFrame
  }
): PositionedLine {
  const font: FontRef = { family: profile.bodyFont, style: 'regular' }
  const sizePt = profile.bodyFontSize * 0.85
  const width = measurer.widthOf(text, font, sizePt)

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
    runs: [{ text, font, sizePt, xPt: Math.round(x * 1000) / 1000 }]
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
    lineWidths: ctx.measureWidth,
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

  toc.forEach((entry, i) => {
    const indent = Math.max(0, entry.level - 1) * sizePt
    // A title that wraps hangs its continuation, so the eye can tell a second
    // line of one entry from the first line of the next.
    const hang = sizePt
    const measure = Math.max(1, ctx.measureWidth - folioColumn - indent)

    const broken = breakParagraph(entry.title, {
      font: body,
      sizePt,
      measurer: ctx.measurer,
      lineWidths: [measure, Math.max(1, measure - hang)],
      alignment: 'left'
    })
    if (broken.length === 0) return

    // A blank line before each top-level entry after the first, so chapters
    // group visibly when there are sub-headings between them.
    const gapBefore = i > 0 && entry.level === 1 ? 1 : 0
    if (slot + gapBefore + broken.length > slotsPerPage) {
      page = newPage('front')
      page.kind = 'contents'
      page.suppressRunningHead = true
      page.suppressFolio = true
      slot = 0
    } else {
      slot += gapBefore
    }

    broken.forEach((line, lineIndex) => {
      const runs: TextRun[] = line.words.map((w) => ({
        text: w.text,
        font: body,
        sizePt,
        xPt: w.xPt + indent + (lineIndex === 0 ? 0 : hang)
      }))

      // The number aligns with the entry's *last* line, which is where a reader
      // looks for it when a title has wrapped.
      if (lineIndex === broken.length - 1 && entry.folio) {
        const width = ctx.measurer.widthOf(entry.folio, body, sizePt)
        runs.push({ text: entry.folio, font: body, sizePt, xPt: ctx.measureWidth - width })
      }

      page.lines.push({ slot: slot + lineIndex, line: { runs } })
    })
    slot += broken.length
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

  const centred = (
    page: PageBuilder,
    startSlot: number,
    entries: { text: string; sizePt: number; font: FontRef; gapAfter?: number }[]
  ): void => {
    let slot = startSlot
    for (const entry of entries) {
      if (entry.text.trim().length === 0) continue
      const broken = breakParagraph(entry.text, {
        font: entry.font,
        sizePt: entry.sizePt,
        measurer: ctx.measurer,
        lineWidths: page.frame.widthPt,
        alignment: 'center'
      })
      for (const line of broken) {
        page.lines.push({
          slot,
          line: {
            runs: line.words.map((w) => ({
              text: w.text,
              font: entry.font,
              sizePt: entry.sizePt,
              xPt: w.xPt
            }))
          }
        })
        slot += 1
      }
      slot += entry.gapAfter ?? 1
    }
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
    centred(page, Math.floor(slotsPerPage / 4), [
      {
        text: edition.title,
        sizePt: profile.bodyFontSize * profile.headingStyle.scale,
        font: heading,
        gapAfter: 3
      },
      { text: edition.author, sizePt: profile.bodyFontSize * 1.15, font: body, gapAfter: 0 }
    ])
    if (edition.imprint) {
      centred(page, slotsPerPage - 3, [
        { text: edition.imprint, sizePt: profile.bodyFontSize, font: body }
      ])
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
