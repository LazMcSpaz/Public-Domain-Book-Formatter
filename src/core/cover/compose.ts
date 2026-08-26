/**
 * A cover document, laid out onto the flat sheet.
 *
 * The counterpart of `@core/layout`'s `layout()`, and built to the same
 * contract: a **pure function of its inputs** that returns absolute positions
 * and nothing needing interpretation. Given a font table you can draw what
 * comes out of here, measure it, or diff two of them.
 *
 * Everything is in points with the origin at the top-left of the whole sheet,
 * bleed included, y running downward — the convention the layout engine uses
 * for pages, so `cover-pdf` flips the origin in exactly the way `pdf-out`
 * already does and the two writers stay recognisably the same code.
 *
 * ## Why arrangements rather than a canvas
 *
 * Free placement would make every cover a fresh act of design and make a
 * *collection* — the thing this arm exists for — a matter of remembering what
 * you did last time. An arrangement is a tradition with the sizes derived from
 * the trim, so the same look applied to a 5×8 and a 7×10 is the same look
 * rather than the same numbers.
 *
 * ## Nothing is drawn into the barcode
 *
 * `geometry.barcode` is a hole in the back cover. The blurb's measure stops
 * above it, and the validator warns if anything else lands in it. KDP prints
 * over that rectangle no matter what is under it.
 *
 * Pure: no DOM, no I/O. Text is measured through the injected `TextMeasurer`,
 * which in the browser is the same fontkit call pdf-lib makes to encode text.
 */
import type { FontRef, TextMeasurer } from '@core/layout'
import type { OrnamentArt } from '@core/ornament'
import { sizeAfterOps } from '@core/image'
import { worksLabel, type CoverDocument, type Hex } from './document'
import { GROUND_IMAGE_ID, groundPattern, isImageGround, PATTERN_OPACITY } from './patterns'
import {
  contains,
  coverGeometry,
  MIN_PAGES_FOR_SPINE_TEXT,
  overlaps,
  pt,
  SAFE_MARGIN_IN,
  SPINE_TEXT_CLEARANCE_IN,
  type CoverGeometry,
  type Rect
} from './geometry'

/** A solid rectangle — grounds, bands, and the scrim under type over art. */
export interface FillItem {
  kind: 'fill'
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
  color: Hex
  /** 0–1. Only the scrim uses it; everything else is opaque. */
  opacity?: number
}

/**
 * The cover's picture, placed.
 *
 * Carries the **source rectangle in pixels** as well as the destination, so a
 * `cover` fit is a crop of the pixels rather than a clip of the drawing. That
 * is not a workaround: cropping in pixels is what makes the effective DPI here
 * the DPI of the pixels *actually printed*, which is the number the KDP check
 * needs. Clipping would divide by a width half the image never occupied.
 */
export interface CoverImageItem {
  kind: 'image'
  id: string
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
  /** The part of the (post-op) source to draw, in source pixels. */
  srcX: number
  srcY: number
  srcWidth: number
  srcHeight: number
  /**
   * 0–1. Only a picture-backed ground uses it.
   *
   * The cover's artwork is never drawn at partial opacity — a faded plate is a
   * mistake, not a treatment — so this exists for the one case where the
   * picture *is* the texture.
   */
  opacity?: number
}

export interface CoverTextItem {
  kind: 'text'
  text: string
  font: FontRef
  sizePt: number
  /** Left edge of the run; alignment is already resolved into it. */
  xPt: number
  /** The baseline, not the top. */
  yPt: number
  color: Hex
  /**
   * The run's measured advance width.
   *
   * Carried rather than re-measured because the validator has to know whether a
   * line of type crosses the trim, and a validator that measured it itself
   * would be a second opinion about the same string — the thing the whole
   * "one renderer" rule exists to prevent.
   */
  widthPt: number
  /**
   * The run's ink box either side of the baseline, from the face's own metrics.
   *
   * Carried for the same reason as `widthPt`, and it is the difference between
   * a safe-margin check that means something and one that reports every line
   * set at the top of a panel. Deriving it from the point size would be a
   * *second* opinion about how tall the type is, and it would be wrong by
   * whatever the face's ascent is not.
   */
  ascentPt: number
  descentPt: number
  /**
   * Quarter-turn for spine text, anticlockwise in PDF terms.
   *
   * −90 sets the line reading top-to-bottom, which is how an English-language
   * spine reads: shelve the book and the title runs the right way up.
   */
  rotate?: -90
}

export interface CoverRuleItem {
  kind: 'rule'
  xPt: number
  yPt: number
  widthPt: number
  thicknessPt: number
  color: Hex
}

export interface CoverOrnamentItem {
  kind: 'ornament'
  xPt: number
  yPt: number
  scale: number
  art: OrnamentArt
  color: Hex
  /**
   * 0–1. Only the ground pattern uses it.
   *
   * A texture across the whole wrap has to sit far enough back that the type in
   * front of it loses nothing, and a press cannot resolve a tint much below
   * five per cent — so this is a narrow, deliberate range rather than a knob.
   */
  opacity?: number
}

export type CoverItem =
  FillItem | CoverImageItem | CoverTextItem | CoverRuleItem | CoverOrnamentItem

export interface ComposeOptions {
  measurer: TextMeasurer
  /** The shipped ornament library, for resolving `look.ornamentId`. */
  ornaments?: readonly OrnamentArt[]
}

export interface PlacedArt {
  id: string
  /** Where it printed, in inches — what the DPI check divides by. */
  rect: Rect
  /** Pixels actually used along each axis, after ops and after the fit crop. */
  usedWidthPx: number
  usedHeightPx: number
}

export interface ComposedCover {
  geometry: CoverGeometry
  items: CoverItem[]
  placedArt: PlacedArt | null
  /**
   * What could not be honoured, in plain language.
   *
   * Same rule as the interior's dropped notes: a cover that quietly lost its
   * subtitle is a cover nobody checks until it is printed.
   */
  warnings: string[]
}

/**
 * The id the press mark is placed under.
 *
 * A fixed id rather than one derived from the file, because the mark is a
 * property of the look and the renderer has to find its pixels without knowing
 * which book it is setting.
 */
export const PRESS_MARK_ID = '__press-mark__'

/**
 * The narrowest a press mark may print and still be a device.
 *
 * Worth knowing what this implies, because it is not obvious: a fold wide
 * enough for a mark is always wide enough for text too. This needs roughly a
 * hundred-page book, and KDP's own floor for spine text is seventy-nine — so
 * "a mark on a spine too thin for type" is a case that cannot arise, and the
 * two are still decided separately because that is a fact about today's
 * numbers rather than a rule.
 */
export const MIN_MARK_WIDTH_IN = 0.2

/** Title sizes are searched in this range, largest first. */
const TITLE_MAX_PT = 64
const TITLE_MIN_PT = 14
const SUBTITLE_RATIO = 0.42
const AUTHOR_RATIO = 0.38

const BLURB_PT = 10.5
const IMPRINT_PT = 9
const LEADING = 1.25

function face(family: string, style: 'regular' | 'italic' = 'regular', smallCaps = false): FontRef {
  return smallCaps ? { family, style, smallCaps: true } : { family, style }
}

/**
 * Break a paragraph greedily to a measure.
 *
 * Greedy, not Knuth–Plass, and deliberately: the book's paragraphs are
 * justified over a fixed measure where the total-badness optimum is visible,
 * and a cover's lines are centred, few, and short, where it is not. Running the
 * book's line breaker over a three-word title would be borrowing a machine to
 * make the same three lines.
 */
export function wrapText(
  text: string,
  maxWidthPt: number,
  font: FontRef,
  sizePt: number,
  measurer: TextMeasurer
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && measurer.widthOf(candidate, font, sizePt) > maxWidthPt) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * The largest size at which `text` sets in at most `maxLines` within the box.
 *
 * Searched in half-point steps from the top down, so the answer is the same
 * every time this cover is composed — a title that resized by a point between
 * the preview and the export would make the gate meaningless.
 */
export function fitText(
  text: string,
  box: { widthPt: number; heightPt: number },
  maxLines: number,
  font: FontRef,
  measurer: TextMeasurer,
  maxPt = TITLE_MAX_PT,
  minPt = TITLE_MIN_PT
): { sizePt: number; lines: string[] } {
  for (let size = maxPt; size >= minPt; size -= 0.5) {
    const lines = wrapText(text, box.widthPt, font, size, measurer)
    if (lines.length === 0) return { sizePt: size, lines: [] }
    if (lines.length > maxLines) continue
    const tallest = Math.max(...lines.map((l) => measurer.widthOf(l, font, size)))
    if (tallest > box.widthPt) continue
    if (lines.length * size * LEADING > box.heightPt) continue
    return { sizePt: size, lines }
  }
  // Nothing fit. Set it at the floor and let the validator say so — silently
  // dropping words off a title is the one outcome worse than a tight cover.
  return { sizePt: minPt, lines: wrapText(text, box.widthPt, font, minPt, measurer) }
}

/**
 * One size that fits *every* one of these, largest first.
 *
 * Equal weight is the whole point of an omnibus cover: two works bound together
 * are two works, and setting the longer title smaller so it fits would say the
 * shorter one matters more. So the size is the smallest of what each could take
 * on its own, and they are all set at it.
 */
export function fitTitlesTogether(
  titles: readonly string[],
  box: { widthPt: number; heightPt: number },
  maxLinesEach: number,
  font: FontRef,
  measurer: TextMeasurer,
  maxPt = TITLE_MAX_PT,
  minPt = TITLE_MIN_PT
): { sizePt: number; lines: string[][] } {
  const budget = box.heightPt / Math.max(1, titles.length)
  let sizePt = maxPt
  for (const title of titles) {
    const fitted = fitText(
      title,
      { widthPt: box.widthPt, heightPt: budget },
      maxLinesEach,
      font,
      measurer,
      maxPt,
      minPt
    )
    sizePt = Math.min(sizePt, fitted.sizePt)
  }
  return {
    sizePt,
    lines: titles.map((t) => wrapText(t, box.widthPt, font, sizePt, measurer))
  }
}

function applyCase(text: string, kind: CoverDocument['look']['titleCase']): string {
  return kind === 'upper' ? text.toUpperCase() : text
}

/**
 * Lay a block of centred lines into `items`, returning the y below it.
 *
 * Centred on the **ink**, not on the advance box. Every line on a cover is
 * display type at 20 to 60 points, where the difference is visible: measured on
 * a real sheet, `THE ASTRAL WORLD` and `THE HUMAN AURA` set at the same size
 * and centred by advance landed 2.5 pixels — about 2.7 points — apart, because
 * a `D` has a tight right side bearing and an `A` has a wide one. Nothing was
 * wrong with the arithmetic; it was centring the wrong box.
 */
function centeredLines(
  items: CoverItem[],
  lines: readonly string[],
  panel: Rect,
  topPt: number,
  font: FontRef,
  sizePt: number,
  color: Hex,
  measurer: TextMeasurer
): number {
  const metrics = measurer.metrics(font, sizePt)
  const leading = sizePt * LEADING
  const centreX = pt(panel.x + panel.width / 2)
  let y = topPt
  for (const line of lines) {
    const width = measurer.widthOf(line, font, sizePt)
    const ink = measurer.inkExtents(line, font, sizePt)
    // Put the middle of the ink on the middle of the panel: the origin is the
    // centre less half the ink span, less however far the ink starts from the
    // origin.
    const xPt = centreX - (ink.left + ink.right) / 2
    items.push({
      kind: 'text',
      text: line,
      font,
      sizePt,
      xPt,
      yPt: y + metrics.ascent,
      color,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
    y += leading
  }
  return y
}

/**
 * Fit a picture into a frame, in the printer's sense rather than the browser's.
 *
 * `cover` returns the source rectangle that fills the frame without distorting
 * it — a centred crop. `contain` shrinks the frame to the picture's proportions
 * instead, so nothing is cut and nothing is stretched. Neither ever changes the
 * aspect ratio: a squashed engraving is the tell of a machine-made cover.
 */
export function fitArt(
  frame: Rect,
  sourceWidthPx: number,
  sourceHeightPx: number,
  mode: 'cover' | 'contain'
): { dest: Rect; srcX: number; srcY: number; srcWidth: number; srcHeight: number } | null {
  if (sourceWidthPx <= 0 || sourceHeightPx <= 0 || frame.width <= 0 || frame.height <= 0) {
    return null
  }
  const frameRatio = frame.width / frame.height
  const artRatio = sourceWidthPx / sourceHeightPx

  if (mode === 'contain') {
    const dest =
      artRatio > frameRatio
        ? {
            x: frame.x,
            y: frame.y + (frame.height - frame.width / artRatio) / 2,
            width: frame.width,
            height: frame.width / artRatio
          }
        : {
            x: frame.x + (frame.width - frame.height * artRatio) / 2,
            y: frame.y,
            width: frame.height * artRatio,
            height: frame.height
          }
    return { dest, srcX: 0, srcY: 0, srcWidth: sourceWidthPx, srcHeight: sourceHeightPx }
  }

  // Cover: keep the frame, take the biggest centred crop with the frame's ratio.
  if (artRatio > frameRatio) {
    const srcWidth = sourceHeightPx * frameRatio
    return {
      dest: { ...frame },
      srcX: (sourceWidthPx - srcWidth) / 2,
      srcY: 0,
      srcWidth,
      srcHeight: sourceHeightPx
    }
  }
  const srcHeight = sourceWidthPx / frameRatio
  return {
    dest: { ...frame },
    srcX: 0,
    srcY: (sourceHeightPx - srcHeight) / 2,
    srcWidth: sourceWidthPx,
    srcHeight
  }
}

function ruleItem(
  x: number,
  y: number,
  width: number,
  color: Hex,
  thickness = 0.75
): CoverRuleItem {
  return { kind: 'rule', xPt: x, yPt: y, widthPt: width, thicknessPt: thickness, color }
}

function drawRule(
  items: CoverItem[],
  style: CoverDocument['look']['rule'],
  panel: Rect,
  yPt: number,
  widthIn: number,
  color: Hex,
  ornament: OrnamentArt | null
): number {
  if (style === 'none') return yPt
  const width = pt(widthIn)
  const x = pt(panel.x + panel.width / 2) - width / 2
  if (style === 'ornamented' && ornament) {
    const scale = pt(widthIn * 0.5) / ornament.width
    items.push({
      kind: 'ornament',
      xPt: pt(panel.x + panel.width / 2) - (ornament.width * scale) / 2,
      yPt,
      scale,
      art: ornament,
      color
    })
    return yPt + ornament.height * scale
  }
  items.push(ruleItem(x, yPt, width, color))
  if (style === 'double') {
    items.push(ruleItem(x, yPt + 3, width, color))
    return yPt + 3.75
  }
  return yPt + 0.75
}

/** The measure available for back-cover copy, stopping short of the barcode. */
export function blurbFrame(geometry: CoverGeometry): Rect {
  // Started a little down the panel rather than hard against the top safe line.
  // Back-cover copy set at the very top of the panel reads as a caption that
  // slid; every printed book puts it in the upper middle.
  const inset = geometry.backSafe.height * 0.12
  const safe = {
    ...geometry.backSafe,
    y: geometry.backSafe.y + inset,
    height: geometry.backSafe.height - inset
  }
  // The barcode sits in the bottom corner; the copy simply ends above it rather
  // than flowing around it. Wrapping text around a rectangle KDP will paste
  // over is fiddly and looks, on the printed book, like a mistake.
  const bottomLimit = geometry.barcode.y - 0.25
  return { ...safe, height: Math.max(0, Math.min(safe.y + safe.height, bottomLimit) - safe.y) }
}

export function composeCover(doc: CoverDocument, options: ComposeOptions): ComposedCover {
  const { measurer } = options
  const geometry = coverGeometry({
    trimSize: doc.trimSize,
    pageCount: doc.pageCount,
    paper: doc.paper
  })
  const items: CoverItem[] = []
  const warnings: string[] = []
  const { look, content } = doc
  const palette = look.palette
  const ornament =
    (look.ornamentId && options.ornaments?.find((o) => o.id === look.ornamentId)) || null
  if (look.ornamentId && !ornament) {
    warnings.push(`The ornament "${look.ornamentId}" is not in the library; none was drawn.`)
  }

  // The ground, over the whole sheet including bleed. Anything short of the
  // bleed leaves a white sliver at the trim, which is the commonest way a
  // first cover comes back wrong.
  items.push({
    kind: 'fill',
    xPt: 0,
    yPt: 0,
    widthPt: pt(geometry.fullWidthIn),
    heightPt: pt(geometry.fullHeightIn),
    color: palette.ground
  })

  // The ground pattern, over the whole sheet and under everything else.
  //
  // Placed here — after the ground colour and before any panel — so it runs
  // across the back, the spine and the front as one field. That is the point of
  // it: an allover texture has no alignment to notice, which is what makes it
  // survive a fold that creeps by an eighth of an inch.
  if (look.groundPattern && isImageGround(look.groundPattern)) {
    // Out to every edge, so the trim cuts through the texture rather than
    // past it — and across the fold, because an allover ground has no
    // alignment to misregister.
    items.push({
      kind: 'image',
      id: GROUND_IMAGE_ID,
      xPt: 0,
      yPt: 0,
      widthPt: pt(geometry.fullWidthIn),
      heightPt: pt(geometry.fullHeightIn),
      srcX: 0,
      srcY: 0,
      // Filled in by the renderer once it knows what it rendered; the composer
      // cannot know a vector source's pixel count because it does not have one.
      srcWidth: 0,
      srcHeight: 0,
      opacity: PATTERN_OPACITY[look.groundPattern]
    })
  } else if (look.groundPattern) {
    const placements = groundPattern(
      look.groundPattern,
      pt(geometry.fullWidthIn),
      pt(geometry.fullHeightIn),
      ornament ?? options.ornaments?.[0] ?? null
    )
    if (placements.length === 0) {
      warnings.push('The fleuron ground needs an ornament to repeat, and none was chosen.')
    }
    for (const place of placements) {
      items.push({
        kind: 'ornament',
        xPt: place.xPt,
        yPt: place.yPt,
        scale: place.scale,
        art: place.art,
        color: palette.ink,
        opacity: PATTERN_OPACITY[look.groundPattern]
      })
    }
  }

  // Art dimensions after retouching — the op stack can crop, and the DPI check
  // must divide the pixels that survive, not the ones that arrived.
  const art = content.art
  const sized =
    art.id && art.sourceWidthPx > 0
      ? sizeAfterOps(art.sourceWidthPx, art.sourceHeightPx, art.ops)
      : { width: 0, height: 0 }
  const hasArt = Boolean(art.id) && sized.width > 0 && sized.height > 0

  let arrangement = look.arrangement
  if (!hasArt && arrangement !== 'typographic') {
    warnings.push(
      `The "${arrangement}" arrangement wants a picture and none is chosen; the front was set typographically instead.`
    )
    arrangement = 'typographic'
  }

  const placedArt = layFrontCover(
    items,
    warnings,
    geometry,
    doc,
    arrangement,
    ornament,
    measurer,
    hasArt ? { id: art.id as string, widthPx: sized.width, heightPx: sized.height } : null
  )

  layBackCover(items, geometry, doc, ornament, measurer)
  laySpine(items, warnings, geometry, doc, measurer)

  return { geometry, items, placedArt, warnings }
}

function layFrontCover(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  arrangement: CoverDocument['look']['arrangement'],
  ornament: OrnamentArt | null,
  measurer: TextMeasurer,
  art: { id: string; widthPx: number; heightPx: number } | null
): PlacedArt | null {
  const { look, content } = doc
  const palette = look.palette
  const safe = geometry.frontSafe
  const panel = geometry.front
  const smallCaps = look.titleCase === 'small-caps' && measurer.hasSmallCaps(look.titleFont)
  if (look.titleCase === 'small-caps' && !smallCaps) {
    warnings.push(
      `${look.titleFont} has no real small capitals, so the title was set in full capitals rather than scaled-down ones.`
    )
  }
  const titleFont = face(look.titleFont, 'regular', smallCaps)
  const authorFont = face(look.authorFont)
  // A face without real small capitals sets them as full capitals — the same
  // choice the interior's headings make. Scaling capitals down is the forgery
  // this codebase refuses everywhere else, and it would be no less a forgery
  // six inches high on a cover.
  const titleText = smallCaps
    ? content.title
    : applyCase(content.title, look.titleCase === 'small-caps' ? 'upper' : look.titleCase)

  // Where the type sits, and how much of the panel the picture may have.
  const overArt = arrangement === 'full-bleed' || arrangement === 'banded'
  const inkColor = overArt ? palette.overArt : palette.ink

  let placed: PlacedArt | null = null

  // --- the picture ------------------------------------------------------
  if (art) {
    let frame: Rect
    if (arrangement === 'full-bleed') {
      // Out to the sheet's edge on three sides; the fold is the fourth.
      frame = {
        x: panel.x,
        y: 0,
        width: geometry.fullWidthIn - panel.x,
        height: geometry.fullHeightIn
      }
    } else if (arrangement === 'banded') {
      // The art takes the whole panel; the band is drawn over it below.
      frame = {
        x: panel.x,
        y: 0,
        width: geometry.fullWidthIn - panel.x,
        height: geometry.fullHeightIn
      }
    } else if (arrangement === 'plate-window') {
      frame = {
        x: safe.x,
        y: safe.y + safe.height * 0.26,
        width: safe.width,
        height: safe.height * 0.46
      }
    } else {
      // classic-centered: the lower half, below the type.
      frame = {
        x: safe.x,
        y: safe.y + safe.height * 0.44,
        width: safe.width,
        height: safe.height * 0.5
      }
    }

    const fitted = fitArt(frame, art.widthPx, art.heightPx, content.art.fit)
    if (fitted) {
      items.push({
        kind: 'image',
        id: art.id,
        xPt: pt(fitted.dest.x),
        yPt: pt(fitted.dest.y),
        widthPt: pt(fitted.dest.width),
        heightPt: pt(fitted.dest.height),
        srcX: fitted.srcX,
        srcY: fitted.srcY,
        srcWidth: fitted.srcWidth,
        srcHeight: fitted.srcHeight
      })
      placed = {
        id: art.id,
        rect: fitted.dest,
        usedWidthPx: fitted.srcWidth,
        usedHeightPx: fitted.srcHeight
      }
      if (arrangement === 'plate-window') {
        const border = fitted.dest
        items.push(ruleItem(pt(border.x), pt(border.y) - 4, pt(border.width), palette.accent))
        items.push(
          ruleItem(pt(border.x), pt(border.y + border.height) + 4, pt(border.width), palette.accent)
        )
      }
    }
  }

  // --- the band, over the art -------------------------------------------
  let typeTop = pt(safe.y)
  let typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height) }

  if (arrangement === 'banded') {
    const bandHeightIn = panel.height * 0.34
    items.push({
      kind: 'fill',
      xPt: pt(panel.x),
      yPt: 0,
      widthPt: pt(geometry.fullWidthIn - panel.x),
      heightPt: pt(bandHeightIn + geometry.bleedIn),
      color: palette.accent
    })
    typeTop = pt(geometry.bleedIn + 0.3)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(bandHeightIn - 0.4) }
  } else if (arrangement === 'full-bleed') {
    // A scrim, so the title is legible over whatever the picture is doing
    // there. Held to the type's own block rather than the whole cover: a
    // full-cover wash is how a good picture is turned into a grey one.
    const scrimTop = geometry.fullHeightIn * 0.58
    items.push({
      kind: 'fill',
      xPt: pt(panel.x),
      yPt: pt(scrimTop),
      widthPt: pt(geometry.fullWidthIn - panel.x),
      heightPt: pt(geometry.fullHeightIn - scrimTop),
      color: palette.ink,
      opacity: 0.55
    })
    typeTop = pt(scrimTop + 0.35)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(geometry.fullHeightIn - scrimTop - 0.7) }
  } else if (arrangement === 'plate-window') {
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.22) }
  } else if (arrangement === 'classic-centered') {
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.38) }
  } else {
    // Typographic. With no picture to balance against, type starting at the top
    // safe line reads as a page that lost its illustration. The old jobbing
    // printers put the title in the upper third and the imprint at the foot,
    // and the space between them is the design — so the block starts down the
    // panel and the author goes to the foot below.
    typeTop = pt(safe.y + safe.height * 0.16)
    typeBox = { widthPt: pt(safe.width), heightPt: pt(safe.height * 0.5) }
  }

  let y = typeTop

  // --- series line -------------------------------------------------------
  if (content.series.trim()) {
    const size = Math.max(9, Math.min(16, typeBox.widthPt * 0.035))
    y = centeredLines(
      items,
      [content.series.toUpperCase()],
      geometry.front,
      y,
      face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont)),
      size,
      overArt ? palette.overArt : palette.accent,
      measurer
    )
    y += size * 0.9
  }

  /** The author, set below whatever came before it. */
  const setAuthor = (relativeTo: number, titleSizePt: number): void => {
    if (!content.author.trim()) return
    const size = Math.max(11, titleSizePt * AUTHOR_RATIO)
    const lines = wrapText(content.author, typeBox.widthPt, authorFont, size, measurer)
    // On a typographic cover the author sits low, with the empty middle of the
    // panel doing the work a picture would otherwise do.
    const authorTop = arrangement === 'typographic' ? pt(safe.y + safe.height * 0.74) : relativeTo
    centeredLines(items, lines, geometry.front, authorTop, authorFont, size, inkColor, measurer)
  }

  const works = content.works.map((w) => w.trim()).filter((w) => w.length > 0)

  if (works.length >= 2) {
    // --- an omnibus: every work at the same size ---------------------------
    //
    // Two treatises bound together are two treatises. Setting the longer title
    // smaller so it fits would say the shorter one matters more, and putting
    // the second in the subtitle would say it outright.
    const accentInk = overArt ? palette.overArt : palette.accent
    const labelFont = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const labelSize = Math.max(9, Math.min(14, typeBox.widthPt * 0.03))
    // Announced only if the press wants it announced. Two titles with a rule
    // under them and an italic conjunction between already read as two works;
    // a label above them is a second, quieter way of saying the same thing,
    // and stacked under a series line it is one small-capital line too many.
    if (look.announceWorks) {
      y = centeredLines(
        items,
        [worksLabel(works.length)],
        geometry.front,
        y,
        labelFont,
        labelSize,
        accentInk,
        measurer
      )
      y += labelSize * 0.8
    }

    // No rule above the titles. The pair is closed underneath and open at the
    // top, so the series line above it reads as belonging to the cover rather
    // than being boxed in with the titles.
    const ruleWidth = geometry.frontSafe.width * 0.62
    y += labelSize * 0.5

    const fitted = fitTitlesTogether(
      works.map((w) =>
        smallCaps ? w : applyCase(w, look.titleCase === 'small-caps' ? 'upper' : look.titleCase)
      ),
      { widthPt: typeBox.widthPt, heightPt: typeBox.heightPt * 0.56 },
      2,
      titleFont,
      measurer
    )

    const conjunctionFont = face(look.bodyFont, 'italic')
    const conjunctionSize = Math.max(10, fitted.sizePt * 0.4)
    fitted.lines.forEach((lines, index) => {
      if (index > 0) {
        y += conjunctionSize * 0.45
        y = centeredLines(
          items,
          ['and'],
          geometry.front,
          y,
          conjunctionFont,
          conjunctionSize,
          inkColor,
          measurer
        )
        y += conjunctionSize * 0.45
      }
      y = centeredLines(
        items,
        lines,
        geometry.front,
        y,
        titleFont,
        fitted.sizePt,
        inkColor,
        measurer
      )
    })

    y += labelSize * 1.1
    y = drawRule(
      items,
      look.rule === 'none' ? 'none' : 'single',
      geometry.front,
      y,
      ruleWidth,
      accentInk,
      null
    )
    y += fitted.sizePt * 0.5
    setAuthor(y, fitted.sizePt)
  } else if (titleText.trim()) {
    const reserved = typeBox.heightPt * (content.subtitle.trim() ? 0.55 : 0.72)
    const fitted =
      look.titleSizePt !== null
        ? {
            sizePt: look.titleSizePt,
            lines: wrapText(titleText, typeBox.widthPt, titleFont, look.titleSizePt, measurer)
          }
        : fitText(
            titleText,
            { widthPt: typeBox.widthPt, heightPt: reserved },
            3,
            titleFont,
            measurer
          )
    if (fitted.lines.length * fitted.sizePt * LEADING > reserved) {
      warnings.push('The title is taller than the space the arrangement gives it.')
    }
    y = centeredLines(
      items,
      fitted.lines,
      geometry.front,
      y,
      titleFont,
      fitted.sizePt,
      inkColor,
      measurer
    )
    y += fitted.sizePt * 0.35

    // --- rule ------------------------------------------------------------
    y = drawRule(
      items,
      look.rule,
      geometry.front,
      y,
      geometry.frontSafe.width * 0.5,
      overArt ? palette.overArt : palette.accent,
      ornament
    )
    y += fitted.sizePt * 0.35

    if (content.subtitle.trim()) {
      const size = Math.max(10, fitted.sizePt * SUBTITLE_RATIO)
      const lines = wrapText(
        content.subtitle,
        typeBox.widthPt,
        face(look.bodyFont, 'italic'),
        size,
        measurer
      )
      y = centeredLines(
        items,
        lines,
        geometry.front,
        y,
        face(look.bodyFont, 'italic'),
        size,
        inkColor,
        measurer
      )
      y += size * 0.6
    }

    setAuthor(y, fitted.sizePt)
  }

  // --- imprint at the foot ------------------------------------------------
  if (look.imprintOnFront && content.imprint.trim()) {
    const size = IMPRINT_PT
    const font = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const metrics = measurer.metrics(font, size)
    const width = measurer.widthOf(content.imprint, font, size)
    items.push({
      kind: 'text',
      text: content.imprint,
      font,
      sizePt: size,
      xPt: pt(panel.x + panel.width / 2) - width / 2,
      yPt: pt(geometry.frontSafe.y + geometry.frontSafe.height) - metrics.descent,
      color: overArt ? palette.overArt : palette.ink,
      widthPt: width,
      ascentPt: metrics.ascent,
      descentPt: metrics.descent
    })
  }

  return placed
}

function layBackCover(
  items: CoverItem[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  ornament: OrnamentArt | null,
  measurer: TextMeasurer
): void {
  const { look, content } = doc
  const frame = blurbFrame(geometry)
  const bodyFont = face(look.bodyFont)
  const palette = look.palette

  let y = pt(frame.y)

  if (ornament && look.rule !== 'none') {
    const widthIn = Math.min(frame.width * 0.35, 1.6)
    const scale = pt(widthIn) / ornament.width
    items.push({
      kind: 'ornament',
      xPt: pt(frame.x + frame.width / 2) - (ornament.width * scale) / 2,
      yPt: y,
      scale,
      art: ornament,
      color: palette.accent
    })
    y += ornament.height * scale + 14
  }

  const paragraphs = content.blurb.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const metrics = measurer.metrics(bodyFont, BLURB_PT)
  const bottom = pt(frame.y + frame.height)
  for (const paragraph of paragraphs) {
    const lines = wrapText(paragraph.trim(), pt(frame.width), bodyFont, BLURB_PT, measurer)
    for (const line of lines) {
      if (y + metrics.ascent > bottom) return
      items.push({
        kind: 'text',
        text: line,
        font: bodyFont,
        sizePt: BLURB_PT,
        xPt: pt(frame.x),
        yPt: y + metrics.ascent,
        color: palette.ink,
        widthPt: measurer.widthOf(line, bodyFont, BLURB_PT),
        ascentPt: metrics.ascent,
        descentPt: metrics.descent
      })
      y += BLURB_PT * 1.4
    }
    y += BLURB_PT * 0.7
  }

  if (content.imprint.trim()) {
    const font = face(look.bodyFont, 'regular', measurer.hasSmallCaps(look.bodyFont))
    const m = measurer.metrics(font, IMPRINT_PT)
    items.push({
      kind: 'text',
      text: content.imprint,
      font,
      sizePt: IMPRINT_PT,
      xPt: pt(geometry.backSafe.x),
      yPt: pt(geometry.backSafe.y + geometry.backSafe.height) - m.descent,
      color: palette.ink,
      widthPt: measurer.widthOf(content.imprint, font, IMPRINT_PT),
      ascentPt: m.ascent,
      descentPt: m.descent
    })
  }
}

function laySpine(
  items: CoverItem[],
  warnings: string[],
  geometry: CoverGeometry,
  doc: CoverDocument,
  measurer: TextMeasurer
): void {
  const { look, content } = doc
  const safe = geometry.spineSafe

  // --- the press mark, at the foot ---------------------------------------
  //
  // Placed first because it takes space the text then has to work around, and
  // drawn even on a spine too thin for text: a device three-eighths of an inch
  // wide still reads as a publisher's mark where a line of type would not.
  let markTopIn: number | null = null
  const mark = look.pressMark
  const usableWidth = geometry.spineIn - SPINE_TEXT_CLEARANCE_IN * 2
  if (mark && usableWidth < MIN_MARK_WIDTH_IN) {
    // Reported rather than dropped, which is the rule everywhere else here.
    // Below about a fifth of an inch a device is a smudge with a shape it can
    // no longer show, and shrinking it to fit would print exactly that.
    warnings.push(
      `The spine is ${geometry.spineIn.toFixed(3)} in, too narrow to print the press's mark ` +
        `legibly, so it was left off. It needs about ${(MIN_MARK_WIDTH_IN + SPINE_TEXT_CLEARANCE_IN * 2).toFixed(2)} in of fold — ` +
        'a little over a hundred pages.'
    )
  }
  if (mark && usableWidth >= MIN_MARK_WIDTH_IN) {
    const width = Math.min(usableWidth * 0.78, 0.42)
    const height = width * (mark.heightPx / mark.widthPx)
    // Never more than a fraction of the fold's length: a device that grows
    // with the book would dominate the spine of a thin one.
    const capped = Math.min(height, geometry.spine.height * 0.14)
    const finalWidth = capped < height ? capped * (mark.widthPx / mark.heightPx) : width
    const x = geometry.spine.x + (geometry.spine.width - finalWidth) / 2
    const y = geometry.spine.y + geometry.spine.height - SAFE_MARGIN_IN - capped
    items.push({
      kind: 'image',
      id: PRESS_MARK_ID,
      xPt: pt(x),
      yPt: pt(y),
      widthPt: pt(finalWidth),
      heightPt: pt(capped),
      srcX: 0,
      srcY: 0,
      srcWidth: mark.widthPx,
      srcHeight: mark.heightPx
    })
    markTopIn = y
  }

  if (!look.spineText) return
  if (!geometry.spineTextAllowed) {
    warnings.push(
      `At ${geometry.pageCount} pages the spine is too narrow for KDP to print text on it ` +
        `(they want ${MIN_PAGES_FOR_SPINE_TEXT} pages or more), so it was left blank.`
    )
    return
  }
  if (!safe || safe.width <= 0) {
    warnings.push('The spine is too narrow for text once clearance is allowed; it was left blank.')
    return
  }

  const font = face(look.titleFont, 'regular', measurer.hasSmallCaps(look.titleFont))
  // The spine's *width* is the type's height, so the size is bounded by it.
  const maxByThickness = pt(safe.width) * 0.62
  const line = [content.title, content.author].filter((s) => s.trim()).join(' · ')
  if (!line.trim()) return

  // The run of fold the text may occupy: down to the mark, if there is one,
  // with a gap so the two do not touch.
  const runTop = safe.y
  const runBottom = markTopIn === null ? safe.y + safe.height : markTopIn - 0.12
  const runLength = Math.max(0, runBottom - runTop)

  let size = Math.min(14, maxByThickness)
  const maxLengthPt = pt(runLength)
  while (size > 6 && measurer.widthOf(line, font, size) > maxLengthPt) size -= 0.5
  if (measurer.widthOf(line, font, size) > maxLengthPt) {
    warnings.push('The spine text is longer than the spine; it was left off.')
    return
  }

  const metrics = measurer.metrics(font, size)
  const textLength = measurer.widthOf(line, font, size)
  // Rotated −90°, the run starts at the top of the spine and reads downward.
  // x is the baseline's distance across the spine; centre the glyphs in it.
  const centreX = pt(geometry.spine.x + geometry.spine.width / 2)
  const startY = pt(runTop + runLength / 2) - textLength / 2

  items.push({
    kind: 'text',
    text: line,
    font,
    sizePt: size,
    xPt: centreX - (metrics.ascent - metrics.descent) / 2,
    yPt: startY,
    color: look.palette.ink,
    widthPt: textLength,
    ascentPt: metrics.ascent,
    descentPt: metrics.descent,
    rotate: -90
  })
}

/** Every rectangle an item occupies, in inches — what the validator inspects. */
export function itemBounds(item: CoverItem): Rect | null {
  switch (item.kind) {
    case 'fill':
    case 'image':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: item.widthPt / 72,
        height: item.heightPt / 72
      }
    case 'rule':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: item.widthPt / 72,
        height: item.thicknessPt / 72
      }
    case 'ornament':
      return {
        x: item.xPt / 72,
        y: item.yPt / 72,
        width: (item.art.width * item.scale) / 72,
        height: (item.art.height * item.scale) / 72
      }
    case 'text': {
      // The ink box the composer measured, not a fraction of the point size.
      const lengthIn = item.widthPt / 72
      const ascentIn = item.ascentPt / 72
      const descentIn = item.descentPt / 72
      if (item.rotate === -90) {
        // Turned a quarter clockwise, the run advances downward and the
        // ascender leans toward the front cover.
        return {
          x: item.xPt / 72 - descentIn,
          y: item.yPt / 72,
          width: ascentIn + descentIn,
          height: lengthIn
        }
      }
      return {
        x: item.xPt / 72,
        y: item.yPt / 72 - ascentIn,
        width: lengthIn,
        height: ascentIn + descentIn
      }
    }
  }
}

export { contains, overlaps }

/**
 * Where a picture *would* print on this cover, before there is one.
 *
 * The studio has to say "this needs 1800 × 2700 pixels" while the user is
 * choosing a model, which is before any art exists to measure. Composing with a
 * stand-in of a known size and reading back the rectangle answers that with the
 * real arrangement rather than a second copy of its geometry — so a change to
 * how `plate-window` sizes its window cannot leave this advice behind.
 *
 * Returns null for an arrangement that has no picture in it.
 */
export function artFrame(doc: CoverDocument, measurer: TextMeasurer): Rect | null {
  if (doc.look.arrangement === 'typographic') return null
  const probe: CoverDocument = {
    ...doc,
    content: {
      ...doc.content,
      art: {
        id: '__probe__',
        // A 2:3 stand-in: `cover` fit keeps the frame whatever the proportions,
        // and `contain` needs *some* ratio to letterbox against. Portrait is
        // the right guess for a cover, and the caller is told the frame, not
        // the picture.
        sourceWidthPx: 2000,
        sourceHeightPx: 3000,
        provenance: null,
        ops: [],
        fit: 'cover'
      }
    }
  }
  return composeCover(probe, { measurer }).placedArt?.rect ?? null
}
