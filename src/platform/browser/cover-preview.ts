/**
 * The cover studio's preview.
 *
 * **The preview is the PDF**, exactly as at the design gate: the cover is
 * composed, written to real bytes by `cover-pdf`, and *those bytes* are
 * rasterised with pdf.js. Nothing here approximates a cover in CSS. One
 * renderer is what makes looking at the screen and clicking "download" the same
 * act, and on a cover it matters more than it does inside — an interior has
 * three hundred pages to notice a problem on, and a cover has one chance.
 *
 * It returns the bytes as well as the picture, so the studio's download button
 * hands over the file it just showed rather than building a second one.
 *
 * `renderFrontCover` is the same act with the sheet cropped to the front panel
 * — the picture of a book rather than the sheet it prints on, which is what the
 * app needs to show a book on a shelf. It shares `buildCover` with the preview
 * on purpose: an icon composed by a second path could show a front cover the
 * PDF does not contain. See `@core/cover/icon` for where it cuts, and why.
 *
 * Browser-only.
 */
import type { ComposedCover, CoverDocument } from '@core/cover'
import {
  composeCover,
  DEFAULT_ICON_WIDTH_PX,
  FIGURE_ANCHOR_X,
  FIGURE_SRC,
  FIGURE_ZOOM,
  FRONT_MARK_ID,
  frontIconPlan,
  GROUND_FIGURE_ID,
  GROUND_IMAGE_ID,
  GROUND_IMAGE_SRC,
  PRESS_MARK_ID,
  validateCover,
  type CoverValidationReport
} from '@core/cover'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { fontTableFor } from './fonts'
import { openPdf } from './pdf'
import { renderCoverPdf, type CoverPdfResult } from './cover-pdf'
import { renderGroundImage, renderPressMark } from './press-mark'

export interface CoverPreview {
  /** A PNG object URL of the whole flat sheet. **Revoke it** — see `releaseCoverPreview`. */
  url: string
  widthPx: number
  heightPx: number
  bytes: Uint8Array
  composed: ComposedCover
  validation: CoverValidationReport
  pdf: CoverPdfResult
  /** Families asked for but unavailable, mapped to what was used instead. */
  substitutions: [string, string][]
}

export interface CoverPreviewOptions {
  /**
   * Pixels per point. Defaults to 2, which is 144 to the inch.
   *
   * The interior's preview uses 1 because it renders four pages and a book is
   * long. A cover is a single sheet, and the things this gate exists to judge —
   * a ground printing at eight per cent, a device three-eighths of an inch
   * wide — simply are not visible at 72. Half the reason to look is lost at
   * the lower number, and it costs 2.5 megapixels.
   */
  scale?: number
  /** PNG bytes for the cover's picture, keyed by `CoverArt.id`. */
  images?: ReadonlyMap<string, Uint8Array>
  /** Whether the page count came from the layout engine. Feeds the report. */
  pageCountMeasured?: boolean
  signal?: AbortSignal
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
}

/**
 * Compose the cover, render the pictures it turned out to need, and write the
 * PDF.
 *
 * Everything up to the bytes, shared by the preview and the icon, because the
 * two must be looking at the same cover. A second path that composed its own
 * would be a second renderer by the back door: the icon is the front of the
 * sheet the studio shows and the button downloads, or it is a picture of
 * something that was never printed.
 */
async function buildCover(
  doc: CoverDocument,
  options: CoverPreviewOptions
): Promise<{
  composed: ComposedCover
  validation: CoverValidationReport
  pdf: CoverPdfResult
  substitutions: [string, string][]
}> {
  const fonts = await fontTableFor([doc.look.titleFont, doc.look.authorFont, doc.look.bodyFont])
  checkCancelled(options.signal)

  const composed = composeCover(doc, { measurer: fonts, ornaments: BUILTIN_ORNAMENTS })

  // The press mark is rendered here rather than supplied by the caller,
  // because its pixels depend on where the composer put it: the size is read
  // back off the placed rectangle so the device is drawn at the resolution it
  // prints at, and tinted with the look's own accent.
  //
  // Once per placement, not once per look: the same artwork prints a third of
  // an inch wide on the fold and an inch or more on the board, and a raster
  // made for one of those is the wrong picture at the other — too coarse going
  // up, pixels thrown away coming down.
  const images = new Map(options.images ?? [])
  for (const id of [PRESS_MARK_ID, FRONT_MARK_ID]) {
    const markItem = composed.items.find((i) => i.kind === 'image' && i.id === id)
    if (!markItem || markItem.kind !== 'image' || !doc.look.pressMark) continue
    const mark = await renderPressMark({
      dataUrl: doc.look.pressMark.dataUrl,
      widthIn: markItem.widthPt / 72,
      heightIn: markItem.heightPt / 72,
      color: doc.look.palette.accent
    })
    images.set(id, mark.bytes)
    // The composer sized the item from the *source's* proportions; the raster
    // may have fewer pixels than were asked for, and the writer crops by the
    // source rectangle, so it has to be told what actually came back.
    markItem.srcWidth = mark.widthPx
    markItem.srcHeight = mark.heightPx
  }

  // The ground, likewise rendered from the placed rectangle: a vector source
  // has no pixel count of its own, so the size is decided by where it goes.
  const groundItem = composed.items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)
  const groundSrc = doc.look.groundPattern ? GROUND_IMAGE_SRC[doc.look.groundPattern] : undefined
  if (groundItem && groundItem.kind === 'image' && groundSrc) {
    const ground = await renderGroundImage({
      src: groundSrc,
      widthIn: groundItem.widthPt / 72,
      heightIn: groundItem.heightPt / 72,
      color: doc.look.palette.ink
    })
    images.set(GROUND_IMAGE_ID, ground.bytes)
    groundItem.srcWidth = ground.widthPx
    groundItem.srcHeight = ground.heightPx
  }

  // The ground figure, rendered like the picture-backed pattern and for the
  // same reason: the size is read back off the placed rectangle, so the
  // picture is drawn at the resolution it prints at. `renderGroundImage`
  // already covers and centre-crops, which is exactly what a figure bleeding
  // off three edges needs, so there is no second fit here to disagree with it.
  const figureItem = composed.items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
  if (figureItem && figureItem.kind === 'image' && doc.look.groundFigure) {
    const figure = await renderGroundImage({
      src: FIGURE_SRC[doc.look.groundFigure],
      widthIn: figureItem.widthPt / 72,
      heightIn: figureItem.heightPt / 72,
      // The figure's own colour, not the ink: see `CoverPalette.figure`. The
      // ground *pattern* above stays on the ink, because it is allover and
      // reads as a tint of the type rather than as a picture behind it.
      color: doc.look.palette.figure,
      anchorX: FIGURE_ANCHOR_X[doc.look.groundFigure],
      zoom: FIGURE_ZOOM[doc.look.groundFigure]
    })
    images.set(GROUND_FIGURE_ID, figure.bytes)
    figureItem.srcWidth = figure.widthPx
    figureItem.srcHeight = figure.heightPx
  }

  const pdf = await renderCoverPdf(composed, fonts, {
    title: doc.content.title,
    author: doc.content.author,
    images
  })
  checkCancelled(options.signal)

  const validation = validateCover({
    doc,
    composed,
    fileBytes: pdf.bytes.byteLength,
    fontsEmbedded: pdf.embeddedFamilies.length > 0,
    ...(options.pageCountMeasured === undefined
      ? {}
      : { pageCountMeasured: options.pageCountMeasured })
  })

  return { composed, validation, pdf, substitutions: [...fonts.substitutions.entries()] }
}

export async function renderCoverPreview(
  doc: CoverDocument,
  options: CoverPreviewOptions = {}
): Promise<CoverPreview> {
  const built = await buildCover(doc, options)
  const raster = await rasterize(built.pdf.bytes, options.scale ?? 2, options.signal)

  return {
    url: URL.createObjectURL(raster.blob),
    widthPx: raster.widthPx,
    heightPx: raster.heightPx,
    bytes: built.pdf.bytes,
    ...built
  }
}

export interface FrontCoverOptions {
  /**
   * How wide the icon should be, in pixels. Clamped by `frontIconPlan`, and the
   * height follows from the trim rather than from anything asked for here.
   */
  widthPx?: number
  /** PNG bytes for the cover's picture, keyed by `CoverArt.id`. */
  images?: ReadonlyMap<string, Uint8Array>
  pageCountMeasured?: boolean
  signal?: AbortSignal
}

export interface FrontCover {
  /**
   * PNG bytes, **not** an object URL.
   *
   * An icon exists to be *kept* — written into a book file, put on the shelf,
   * shown on a card weeks later — and a `blob:` URL names a Blob in the tab
   * that minted it, so a stored one resolves to nothing and looks exactly like
   * a cover that failed to render. Same rule the recon cache runs on: store
   * bytes, mint URLs at the point of use.
   */
  bytes: Uint8Array
  widthPx: number
  heightPx: number
  /** Across the printed front cover. A screen figure: see `frontIconPlan`. */
  dpi: number
  composed: ComposedCover
  validation: CoverValidationReport
  pdf: CoverPdfResult
  substitutions: [string, string][]
}

/**
 * The front panel alone, cut out of the rendered sheet.
 *
 * What the app needs to show a book as a book. The cover is composed and
 * written exactly as the studio writes it, and only the rasterising differs:
 * pdf.js is given the crop's offset and a canvas the size of the crop, so a
 * 2400-pixel icon of a 700-page book does not also rasterise the back cover
 * and the spine to throw them away.
 */
export async function renderFrontCover(
  doc: CoverDocument,
  options: FrontCoverOptions = {}
): Promise<FrontCover> {
  const built = await buildCover(doc, options)
  const plan = frontIconPlan(built.composed.geometry, options.widthPx ?? DEFAULT_ICON_WIDTH_PX)
  const raster = await rasterize(built.pdf.bytes, plan.scale, options.signal, plan)
  const bytes = new Uint8Array(await raster.blob.arrayBuffer())

  return {
    bytes,
    widthPx: raster.widthPx,
    heightPx: raster.heightPx,
    dpi: plan.dpi,
    ...built
  }
}

async function rasterize(
  bytes: Uint8Array,
  scale: number,
  signal: AbortSignal | undefined,
  /** A window onto the sheet, in points from its top-left. Omitted: all of it. */
  crop?: { xPt: number; yPt: number; widthPx: number; heightPx: number }
): Promise<{ blob: Blob; widthPx: number; heightPx: number }> {
  const pdf = await openPdf(bytes.buffer.slice(0) as ArrayBuffer)
  try {
    checkCancelled(signal)
    const page = await pdf.getPage(1)
    // The offsets are in device pixels and shift the whole page, so a negative
    // offset moves the crop's corner to the canvas's. pdf.js clips to the
    // canvas, which is what keeps the cost proportional to the picture wanted
    // rather than to the sheet.
    const viewport = crop
      ? page.getViewport({ scale, offsetX: -crop.xPt * scale, offsetY: -crop.yPt * scale })
      : page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = crop ? crop.widthPx : Math.ceil(viewport.width)
    canvas.height = crop ? crop.heightPx : Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire a 2D canvas context')
    // Not white: a cover's ground is painted by the composer, and filling white
    // first would hide exactly the failure the bleed check is looking for.
    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not encode the cover preview')
    return { blob, widthPx: canvas.width, heightPx: canvas.height }
  } finally {
    await pdf.destroy()
  }
}

/** Object URLs leak otherwise — the same rule the page preview runs on. */
export function releaseCoverPreview(preview: CoverPreview | null): void {
  if (!preview) return
  URL.revokeObjectURL(preview.url)
}
