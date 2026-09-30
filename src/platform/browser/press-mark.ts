/**
 * The press's mark, rendered at the size it prints and in the press's own ink.
 *
 * ## Why it is rasterised here rather than parsed into paths
 *
 * The obvious thing for a logo on a three-eighths-of-an-inch fold is vector,
 * and `drawSvgPath` is already how the ornament library reaches the page. It
 * was the first design and it is the wrong one, for a reason that only shows up
 * with a real mark in hand: a supplied SVG is arbitrary SVG. Groups, nested
 * transforms, `<circle>` and `<rect>` and `<polygon>`, clip paths, strokes with
 * their own widths and joins — a parser that handles the common cases silently
 * drops the rest, and a press mark that is quietly missing a stroke is a broken
 * logo on every book that press prints.
 *
 * Rasterising sidesteps all of it, and gives up nothing that matters, because
 * **the browser is a better SVG renderer than any parser written here would
 * be** and the raster is made at the resolution the mark actually prints at
 * rather than at some fixed size. An SVG drawn to a canvas at 600 DPI for a
 * 0.4in device is 240 pixels of the browser's own rendering — sharper than the
 * press will print, and honest, because the size is computed from the placed
 * rectangle rather than assumed.
 *
 * A supplied PNG goes down the same path and is simply not resampled upward,
 * which is the rule the whole app runs on: `renderMark` never asks for more
 * pixels than the source has.
 *
 * ## The tint
 *
 * A mark arrives as black on white, or black on transparent, and has to print
 * in the accent. So coverage is taken from the source — its alpha where it has
 * one, its darkness where it does not — and painted in the ink. That keeps the
 * anti-aliased edge, which a threshold would throw away and which is most of
 * what makes a small device look drawn rather than pasted.
 *
 * Browser-only.
 */

import { coverOffsetX, coverScale } from '@core/cover'

/** How finely the mark is rendered, in dots per inch of printed size. */
const MARK_DPI = 600

/**
 * And the ground, which is far larger and needs no more than KDP asks.
 *
 * A full 6×9 wrap at 300 DPI is 3888 × 2775 — eleven megapixels, which is a
 * substantial canvas but well within what a browser will hold. Going to 600
 * here, as the mark does, would be forty-three megapixels for a texture
 * printing at eight per cent, and the file it encoded to would start competing
 * with KDP's forty-megabyte ceiling.
 */
const GROUND_DPI = 300

export interface RenderMarkInput {
  /** `data:image/svg+xml;…` or `data:image/png;…` — whatever the user supplied. */
  dataUrl: string
  /** The printed size, in inches. Decides how many pixels are asked for. */
  widthIn: number
  heightIn: number
  /** `#rrggbb` — the ink the device prints in. */
  color: string
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Decode a data URL to a bitmap, via an `Image` so SVG is rendered natively. */
async function loadMark(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The press mark could not be decoded.'))
    img.src = dataUrl
  })
  return img
}

/**
 * Render the mark to PNG bytes at print resolution, in the given ink.
 *
 * Returns the bytes and the pixel size they came out at, so the caller can tell
 * the DPI check what it actually got rather than what it asked for.
 */
export async function renderPressMark(
  input: RenderMarkInput
): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number }> {
  const img = await loadMark(input.dataUrl)

  // What the source can honestly supply. An SVG reports its intrinsic size but
  // has no pixels to run out of, so it is allowed the full request; a bitmap is
  // never asked to grow, because enlarging it would invent resolution.
  const isVector = input.dataUrl.startsWith('data:image/svg')
  const wanted = Math.max(1, Math.round(input.widthIn * MARK_DPI))
  const natural = img.naturalWidth || wanted
  const widthPx = isVector ? wanted : Math.min(wanted, natural)
  const ratio = input.heightIn / Math.max(input.widthIn, 1e-6)
  const heightPx = Math.max(1, Math.round(widthPx * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(img, 0, 0, widthPx, heightPx)

  const image = ctx.getImageData(0, 0, widthPx, heightPx)
  const data = image.data
  const [r, g, b] = parseHex(input.color)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    // Coverage: the alpha channel where the mark has one, and darkness where it
    // is opaque black-on-white. Both kinds of file arrive, and guessing wrong
    // either erases the device or fills the whole square with ink.
    const luminance = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255
    const coverage = alpha === 0 ? 0 : (alpha / 255) * (1 - luminance)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = Math.round(coverage * 255)
  }
  ctx.putImageData(image, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not encode the press mark'))),
      'image/png'
    )
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), widthPx, heightPx }
}

/**
 * Render a picture-backed ground across the sheet, in one ink.
 *
 * Same treatment as the mark and for the same reasons — white knocked out so
 * the cover's own ground shows through, coverage taken from the source's
 * darkness so its shading survives — with two differences that come from it
 * being a texture rather than a device.
 *
 * It **fills** rather than fits: the artwork is square and the wrap is half as
 * wide again, so it is scaled to cover and centre-cropped. Letterboxing a
 * ground would leave bands of bare cover at the edges, and stretching it would
 * turn every swirl into an ellipse.
 *
 * And it is painted in the **ink**, not left in the source's own greys. That
 * holds the sheet to the two-colour discipline the rest of the design runs on;
 * a neutral grey texture under a warm black type is two blacks, which reads as
 * a printing error rather than as a decision.
 */
export async function renderGroundImage(input: {
  /** Where the artwork lives, e.g. `/patterns/marbled.svg`. */
  src: string
  widthIn: number
  heightIn: number
  /** `#rrggbb` — the ink the texture prints in. */
  color: string
  /**
   * Which part of the source should sit on the box's centre line, 0–1.
   *
   * Omitted for a texture, which has no subject to line anything up with.
   * A *figure* does — see `FIGURE_ANCHOR_X` — and the crop is shifted to put
   * it where the design says, clamped so the picture still covers the box.
   */
  anchorX?: number
  /**
   * Where in the box the anchor should land, 0–1. The centre for anything on
   * the front; see `backAnchorTarget` for why the companion needs its own.
   */
  targetX?: number
  /**
   * How much larger than covering requires to draw it, so the anchor has room
   * to move it. See `FIGURE_ZOOM`; a texture never needs it.
   */
  zoom?: number
  /** Draw the artwork flipped, so the two panels are a pair about the spine. */
  mirrorX?: boolean
  /**
   * Inches of the box's right edge over which the tint falls to nothing.
   *
   * Baked into the picture's own alpha rather than asked of the PDF, because
   * the picture is rasterised here anyway and a soft edge in the pixels needs
   * nothing of the writer, the composer or the KDP checks. It is what lets a
   * figure reach the back at all: a companion that dies before the fold is
   * never asked to line up with the one on the other side of it.
   */
  fadeRightIn?: number
  /** The same on the left edge, which is a front figure's own edge at the fold. */
  fadeLeftIn?: number
}): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number }> {
  const img = await loadMark(input.src)
  const widthPx = Math.max(1, Math.round(input.widthIn * GROUND_DPI))
  const heightPx = Math.max(1, Math.round(input.heightIn * GROUND_DPI))

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')

  // Cover: the biggest centred crop of the source with the sheet's proportions.
  const naturalW = img.naturalWidth || widthPx
  const naturalH = img.naturalHeight || heightPx
  const scale = coverScale(widthPx, heightPx, naturalW, naturalH, input.zoom ?? 1)
  const drawW = naturalW * scale
  const drawH = naturalH * scale
  const x = coverOffsetX(widthPx, drawW, input.anchorX ?? 0.5, input.targetX ?? 0.5)
  const top = (heightPx - drawH) / 2
  if (input.mirrorX) {
    // Flip about the drawn rectangle's own right edge, so the box coordinates
    // the offset was computed in are the ones the picture lands in: a source
    // point a fraction `a` from its left arrives `1 - a` from the rectangle's,
    // which is why the caller passes `backAnchorX` rather than the anchor.
    ctx.save()
    ctx.translate(x + drawW, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(img, 0, top, drawW, drawH)
    ctx.restore()
  } else {
    ctx.drawImage(img, x, top, drawW, drawH)
  }

  const image = ctx.getImageData(0, 0, widthPx, heightPx)
  const data = image.data
  const [r, g, b] = parseHex(input.color)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    const luminance = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255
    const coverage = alpha === 0 ? 0 : (alpha / 255) * (1 - luminance)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = Math.round(coverage * 255)
  }

  // The fade, applied after the tint so it multiplies the coverage rather than
  // the source's own greys. Smoothstepped: a linear ramp ends on a visible
  // corner where the slope meets zero, and a fade with an edge on it is the
  // thing this is for avoiding.
  const rightPx = Math.round((input.fadeRightIn ?? 0) * GROUND_DPI)
  const leftPx = Math.round((input.fadeLeftIn ?? 0) * GROUND_DPI)
  if (rightPx > 0 || leftPx > 0) {
    const smooth = (t: number) => t * t * (3 - 2 * t)
    for (let px = 0; px < widthPx; px++) {
      let factor = 1
      if (leftPx > 0 && px < leftPx) factor = smooth(px / leftPx)
      if (rightPx > 0 && px > widthPx - rightPx) {
        factor = Math.min(factor, smooth((widthPx - px) / rightPx))
      }
      if (factor >= 1) continue
      for (let y = 0; y < heightPx; y++) {
        const i = (y * widthPx + px) * 4 + 3
        data[i] = Math.round(data[i]! * factor)
      }
    }
  }
  ctx.putImageData(image, 0, 0)

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not encode the ground'))),
      'image/png'
    )
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), widthPx, heightPx }
}

/** Read a supplied file into a data URL and its natural size. */
export async function readMarkFile(
  file: File
): Promise<{ dataUrl: string; widthPx: number; heightPx: number; fileName: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
  const img = await loadMark(dataUrl)
  // An SVG with no width/height attributes reports zero; a square is the least
  // wrong assumption and the studio shows the result either way.
  return {
    dataUrl,
    widthPx: img.naturalWidth || 100,
    heightPx: img.naturalHeight || 100,
    fileName: file.name
  }
}
