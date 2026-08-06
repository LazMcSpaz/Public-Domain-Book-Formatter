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
import type { BookBlock, BookDocument } from '@core/assemble'
import { breakParagraph, type Alignment, type BrokenLine } from './break-lines'
import {
  bottomFolioBaseline,
  frameFor,
  leadingFor,
  linesPerFrame,
  runningHeadBaseline,
  trimToPoints
} from './frames'
import type { TextMeasurer } from './measure'
import type {
  FontRef,
  LaidOutBook,
  LayoutWarning,
  PageKind,
  LaidOutPage,
  PageFrame,
  PageItem,
  PageSection,
  PageSide,
  PositionedLine,
  TextRun
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
}

/** How far a chapter title sinks from the top of its page, in line slots. */
const CHAPTER_SINK_SLOTS = 4
/** Blank slots between a chapter title and the first line of its text. */
const CHAPTER_GAP_SLOTS = 2
/** Lines a drop capital spans. Three is the traditional depth. */
const DROP_CAP_LINES = 3
/** Paragraph indent, as a multiple of the body size. One em is the convention. */
const INDENT_EMS = 1.2
/** Gap between a drop capital and the text beside it, as a fraction of its size. */
const DROP_CAP_GAP_RATIO = 0.06

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
  chapter: { title: string; level: number } | null
  /** Must not be the last thing on a page: a heading needs text under it. */
  keepWithNext: boolean
  /** Apply widow and orphan control when this item is split across pages. */
  orphanControl: boolean
}

interface FlowLine {
  runs: TextRun[]
  /** Extra runs drawn with this line but not part of its text (a drop capital). */
  decorations?: TextRun[]
  /** The line does not fit its measure; reported once its page is known. */
  overfull?: boolean
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
    firstLineIndentEms: INDENT_EMS,
    spaceBefore: 0,
    spaceAfter: 0
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

/** Turn broken lines into flow lines at a given font, offset into the measure. */
function toFlowLines(
  broken: BrokenLine[],
  font: FontRef,
  sizePt: number,
  leftOffsets: number[]
): FlowLine[] {
  return broken.map((line, i) => ({
    runs: line.words.map((w) => ({
      text: w.text,
      font,
      sizePt,
      xPt: w.xPt + (leftOffsets[Math.min(i, leftOffsets.length - 1)] ?? 0)
    })),
    ...(line.overfull ? { overfull: true } : {})
  }))
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
function buildFlowable(
  block: BookBlock,
  ctx: BuildContext,
  opts: { suppressFirstIndent: boolean; dropCap: boolean }
): Flowable {
  const style = blockStyle(block, ctx.profile)
  const sizePt = ctx.profile.bodyFontSize * style.scale
  const family = block.kind === 'heading' ? ctx.profile.headingFont : ctx.profile.bodyFont
  const font: FontRef = { family, style: style.style }

  const indentLeft = style.indentLeftEms * sizePt
  const indentRight = style.indentRightEms * sizePt
  const measure = Math.max(1, ctx.measureWidth - indentLeft - indentRight)
  const firstIndent = opts.suppressFirstIndent ? 0 : style.firstLineIndentEms * sizePt

  const isChapter = block.kind === 'heading' && (block.level ?? 1) === 1

  // Headings are set in the heading face; a chapter title the style asks to be
  // small-capped is set in ordinary capitals instead. Real `smcp` needs
  // glyph-level drawing, and a synthesised version — scaled capitals — is the
  // tell of a cheap reprint. Better to not offer the look than to fake it.
  const text =
    block.kind === 'heading' && ctx.profile.headingStyle.smallCaps
      ? block.text.toLocaleUpperCase()
      : block.text

  const dropCap = opts.dropCap && block.kind === 'paragraph' && text.trim().length > 0
  if (!dropCap) {
    const broken = breakParagraph(text, {
      font,
      sizePt,
      measurer: ctx.measurer,
      lineWidths: measure,
      alignment: style.alignment,
      firstLineIndentPt: firstIndent,
      ...(block.kind === 'paragraph' || block.kind === 'blockquote'
        ? { hyphenate: ctx.hyphenate }
        : {})
    })
    return {
      lines: toFlowLines(broken, font, sizePt, [indentLeft]),
      spaceBefore: style.spaceBefore,
      spaceAfter: style.spaceAfter,
      startsChapter: isChapter,
      chapter:
        block.kind === 'heading' ? { title: block.text.trim(), level: block.level ?? 1 } : null,
      keepWithNext: block.kind === 'heading',
      orphanControl: block.kind === 'paragraph'
    }
  }

  return buildDropCapFlowable(text, font, sizePt, indentLeft, measure, ctx, style)
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
  style: BlockStyle
): Flowable {
  const initial = [...text.trim()][0] ?? ''
  const rest = text.trim().slice(initial.length).replace(/^\s+/u, '')

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
      ...(ctx.hyphenate ? { hyphenate: ctx.hyphenate } : {})
    })
    const offsets = [...Array.from({ length: depth }, () => indentLeft + capWidth), indentLeft]
    return { lines: toFlowLines(broken, font, sizePt, offsets), capSize, capWidth }
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
    ...(options.hyphenate ? { hyphenate: options.hyphenate } : {})
  }

  const pages: PageBuilder[] = []
  const chapterPages: LaidOutBook['chapterPages'] = []
  const warnings: LayoutWarning[] = []

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
    const page = newPage('front')
    page.kind = 'aside'
    page.suppressRunningHead = true
    const flow = buildFlowable(aside, ctx, { suppressFirstIndent: true, dropCap: false })
    const start = Math.floor(slotsPerPage / 3)
    flow.lines.forEach((line, i) => page.lines.push({ slot: start + i, line }))
  }

  // The body opens on a recto, so a lone verso here becomes a blank leaf.
  if (pages.length % 2 === 1) newPage('front').suppressFolio = true
  const frontMatterPageCount = pages.length

  // --- body ---------------------------------------------------------------

  const flowables: Flowable[] = []
  doc.blocks.forEach((block, i) => {
    const previous = doc.blocks[i - 1]
    const afterHeading = previous?.kind === 'heading'
    const afterChapterHeading = afterHeading && (previous?.level ?? 1) === 1
    flowables.push(
      buildFlowable(block, ctx, {
        // A paragraph directly under a heading is set flush: there is no
        // preceding paragraph for an indent to distinguish it from.
        suppressFirstIndent: afterHeading,
        dropCap: profile.dropCap && afterChapterHeading
      })
    )
  })

  let page: PageBuilder | null = null
  let slot = 0
  const maxBodyPages = options.maxBodyPages ?? Infinity

  const bodyPageCount = (): number => pages.length - frontMatterPageCount

  function openBodyPage(forceRecto: boolean): void {
    if (forceRecto && pages.length % 2 === 1) {
      const blank = newPage('body')
      blank.suppressRunningHead = true
    }
    page = newPage('body')
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

    if (flow.startsChapter || page === null) {
      if (bodyPageCount() >= maxBodyPages) break
      openBodyPage(flow.startsChapter)
      if (flow.startsChapter) {
        current().suppressRunningHead = true
        current().kind = 'chapter-opener'
        slot = CHAPTER_SINK_SLOTS
      }
    }

    // Space before collapses at the top of a page — leading white at the head
    // of a page is a hole, not a separation.
    if (slot > 0) slot += flow.spaceBefore

    let placed = 0
    // Which page a heading opens on is only known once its first line is
    // actually placed: the paragraph before it may have run over, so the page
    // that was current when the heading was *reached* is often the wrong one.
    let headingRecorded = false
    while (placed < flow.lines.length) {
      let available = slotsPerPage - slot
      if (available <= 0) {
        if (bodyPageCount() >= maxBodyPages) break
        openBodyPage(false)
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
      if (flow.keepWithNext && take === remaining && slotsPerPage - slot - take < 1) {
        take = 0
      }

      if (take <= 0) {
        // Never push an item off a page it is the only occupant of — that
        // loops forever and would emit blank pages in the middle of a chapter.
        if (current().lines.length === 0 && slot === 0) {
          take = Math.min(available, remaining)
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
        // Reported here rather than at breaking time: a warning is only useful
        // if it says which page to look at, and that isn't known until now.
        if (line.overfull) {
          warnings.push({
            pageIndex: current().index,
            text: line.runs.map((r) => r.text).join(' ')
          })
        }
      }

      if (flow.chapter && !headingRecorded) {
        headingRecorded = true
        chapterPages.push({
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

  const trim = trimToPoints(profile.trimSize)
  const laidOut: LaidOutPage[] = pages.map((p) =>
    finishPage(p, profile, options.edition, measurer, {
      leading,
      ascent,
      frontMatterPageCount,
      trim
    })
  )

  return {
    pages: laidOut,
    widthPt: trim.widthPt,
    heightPt: trim.heightPt,
    chapterPages,
    fontsUsed: collectFonts(laidOut),
    warnings
  }
}

interface FinishContext {
  leading: number
  ascent: number
  frontMatterPageCount: number
  trim: { widthPt: number; heightPt: number }
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
    const runs: TextRun[] = [
      ...(line.decorations ?? []).map((d) => ({ ...d, xPt: d.xPt + frame.xPt })),
      ...line.runs.map((r) => ({ ...r, xPt: r.xPt + frame.xPt }))
    ]
    if (runs.length > 0) items.push({ kind: 'line', baselinePt: baseline, runs })
  }

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
        seen.set(`${run.font.family}|${run.font.style}`, run.font)
      }
    }
  }
  return [...seen.values()]
}
