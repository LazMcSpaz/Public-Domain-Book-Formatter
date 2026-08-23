/**
 * A composed cover → PDF bytes.
 *
 * The sibling of `pdf-out.ts` and deliberately the same shape: a *writer*, not
 * a designer. Every coordinate it draws at was decided by `@core/cover/compose`
 * and is copied through untouched, the origin flips from the composer's
 * top-left to PDF's bottom-left in one place, and font references become
 * embedded font objects. The preview renders these same bytes, so what the
 * studio shows and what KDP receives cannot drift.
 *
 * Three things differ from the interior writer, all forced by what a cover is:
 *
 * - **One page, and it is bigger than the book.** The MediaBox is the full flat
 *   sheet including bleed, where an interior page's MediaBox is the trim. KDP
 *   wants exactly that: no crop marks, no separate bleed box.
 * - **Colour.** An interior is black on white and the writer never needed a
 *   colour. A cover is nothing but colour, so hex values arrive from the look
 *   and are converted here, once.
 * - **The picture is cropped before it is embedded.** `drawImage` cannot clip,
 *   and clipping is the wrong answer anyway: cutting the pixels means the
 *   effective DPI is computed from the pixels actually printed, which is the
 *   number the KDP check needs.
 *
 * Browser-only: pdf-lib, fontkit, and a canvas for the crop.
 */
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { ComposedCover, CoverImageItem, Hex } from '@core/cover'
import type { FontRef } from '@core/layout'
import { LAYOUT_FEATURES, type FontTable } from './fonts'
import { verifyWidths, widenWidths } from './font-widths'

export interface CoverPdfResult {
  bytes: Uint8Array
  widthPt: number
  heightPt: number
  embeddedFamilies: string[]
  /** Art the composer placed whose pixels never arrived. Reported, never faked. */
  missingImages: string[]
  ligatureGlyphs: string[]
}

export interface CoverPdfOptions {
  title?: string
  author?: string
  /**
   * PNG bytes for the cover's picture, keyed by `CoverArt.id`.
   *
   * Same contract as the interior's illustrations: the composer holds an id and
   * a rectangle, the pixels arrive here. An id with no entry is reported rather
   * than drawn as a grey box — a placeholder on a cover for sale is worse than
   * the gap the user was told about.
   */
  images?: ReadonlyMap<string, Uint8Array>
  /**
   * Crop a PNG to a source rectangle, returning PNG bytes.
   *
   * Injected so this module can be exercised without a canvas, and so the one
   * place pixels are cut is a function the caller can point at its own
   * implementation of. Defaults to a canvas crop.
   */
  cropPng?: (
    bytes: Uint8Array,
    rect: { x: number; y: number; width: number; height: number }
  ) => Promise<Uint8Array>
}

function keyOf(font: FontRef): string {
  return `${font.family}|${font.style}|${font.smallCaps ? 'sc' : ''}`
}

/** `#rrggbb` → pdf-lib's 0–1 triple. Anything unreadable prints black. */
export function hexToRgb(hex: Hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return rgb(0, 0, 0)
  const n = parseInt(m[1]!, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/**
 * Cut a rectangle out of a PNG with a canvas.
 *
 * Nearest to the metal this app gets with pixels, and it is doing exactly one
 * thing: no resampling, no scaling, no smoothing — the destination is the same
 * size as the source rectangle, so every pixel drawn is a pixel that was there.
 * Enlarging here would invent resolution, which is the rule this codebase is
 * built on.
 */
export async function cropPngWithCanvas(
  bytes: Uint8Array,
  rect: { x: number; y: number; width: number; height: number }
): Promise<Uint8Array> {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  try {
    // Already the whole picture: hand the bytes straight back rather than
    // re-encoding them, which costs time and can only lose.
    if (
      Math.round(rect.x) === 0 &&
      Math.round(rect.y) === 0 &&
      width >= bitmap.width &&
      height >= bitmap.height
    ) {
      return bytes
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      bitmap,
      Math.round(rect.x),
      Math.round(rect.y),
      width,
      height,
      0,
      0,
      width,
      height
    )
    const out: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas produced no blob'))),
        'image/png'
      )
    })
    return new Uint8Array(await out.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

export async function renderCoverPdf(
  composed: ComposedCover,
  fonts: FontTable,
  options: CoverPdfOptions = {}
): Promise<CoverPdfResult> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  if (options.title) doc.setTitle(`${options.title} — cover`)
  if (options.author) doc.setAuthor(options.author)
  doc.setProducer('Public-Domain Book Formatter')
  doc.setCreator('Public-Domain Book Formatter')

  const widthPt = composed.geometry.fullWidthIn * 72
  const heightPt = composed.geometry.fullHeightIn * 72
  const page = doc.addPage([widthPt, heightPt])

  // Faces first, so a missing one is known before anything is drawn.
  const embedded = new Map<string, PDFFont>()
  const embeddedFamilies = new Set<string>()
  const wanted = new Map<string, FontRef>()
  for (const item of composed.items) {
    if (item.kind === 'text') wanted.set(keyOf(item.font), item.font)
  }
  for (const ref of wanted.values()) {
    const bytes = fonts.bytesFor(ref)
    if (!bytes) continue
    const font = await doc.embedFont(bytes.slice(), {
      subset: false,
      features: ref.smallCaps ? { ...LAYOUT_FEATURES, smcp: true } : LAYOUT_FEATURES
    })
    embedded.set(keyOf(ref), font)
    embeddedFamilies.add(fonts.resolve(ref.family))
  }
  const fallback = embedded.values().next().value ?? (await doc.embedFont('Times-Roman'))

  // Then the picture, cropped to what the composer said would print.
  const crop = options.cropPng ?? cropPngWithCanvas
  const images = new Map<string, PDFImage>()
  const missingImages: string[] = []
  for (const item of composed.items) {
    if (item.kind !== 'image' || images.has(item.id)) continue
    const bytes = options.images?.get(item.id)
    if (!bytes) {
      if (!missingImages.includes(item.id)) missingImages.push(item.id)
      continue
    }
    const cropped = await crop(bytes, {
      x: item.srcX,
      y: item.srcY,
      width: item.srcWidth,
      height: item.srcHeight
    })
    images.set(item.id, await doc.embedPng(cropped.slice()))
  }

  const drawn = new Map<PDFFont, string[]>()

  for (const item of composed.items) {
    switch (item.kind) {
      case 'fill':
        page.drawRectangle({
          x: item.xPt,
          y: heightPt - item.yPt - item.heightPt,
          width: item.widthPt,
          height: item.heightPt,
          color: hexToRgb(item.color),
          ...(item.opacity === undefined ? {} : { opacity: item.opacity })
        })
        break

      case 'image': {
        const image = images.get((item as CoverImageItem).id)
        if (!image) break
        page.drawImage(image, {
          x: item.xPt,
          y: heightPt - item.yPt - item.heightPt,
          width: item.widthPt,
          height: item.heightPt
        })
        break
      }

      case 'rule':
        page.drawRectangle({
          x: item.xPt,
          y: heightPt - item.yPt - item.thicknessPt,
          width: item.widthPt,
          height: item.thicknessPt,
          color: hexToRgb(item.color)
        })
        break

      case 'ornament': {
        const y = heightPt - item.yPt
        for (const shape of item.art.shapes) {
          page.drawSvgPath(shape.d, {
            x: item.xPt,
            y,
            scale: item.scale,
            ...(shape.stroke === undefined
              ? { color: hexToRgb(item.color) }
              : { borderColor: hexToRgb(item.color), borderWidth: shape.stroke * item.scale })
          })
        }
        break
      }

      case 'text': {
        if (item.text.length === 0) break
        const font = embedded.get(keyOf(item.font)) ?? fallback
        // Every string the cover prints passes through here and nowhere else,
        // which is what lets `widenWidths` below be complete rather than
        // hopeful. Keep it that way.
        const texts = drawn.get(font)
        if (texts) texts.push(item.text)
        else drawn.set(font, [item.text])
        page.drawText(item.text, {
          x: item.xPt,
          y: heightPt - item.yPt,
          size: item.sizePt,
          font,
          color: hexToRgb(item.color),
          ...(item.rotate ? { rotate: degrees(item.rotate) } : {})
        })
        break
      }
    }
  }

  // The same width repair the interior needs, for the same reason: pdf-lib
  // writes the width array from the glyphs a *code point* reaches, so a
  // ligature or a small capital would print as a full em of white space. On a
  // cover that is a gap in the middle of the title.
  const ligatureGlyphs: string[] = []
  for (const [font, texts] of drawn) {
    const { added } = widenWidths(font, texts)
    for (const glyph of added) ligatureGlyphs.push(glyph.name ?? String(glyph.id))
  }
  for (const [font, texts] of drawn) {
    const missing = verifyWidths(font, texts)
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} glyph(s) would print without a width: ${missing.slice(0, 8).join(', ')}. ` +
          'The cover was not written, because the title would have holes in it.'
      )
    }
  }

  const bytes = await doc.save()
  return {
    bytes,
    widthPt,
    heightPt,
    embeddedFamilies: [...embeddedFamilies],
    missingImages,
    ligatureGlyphs: [...new Set(ligatureGlyphs)].sort()
  }
}
