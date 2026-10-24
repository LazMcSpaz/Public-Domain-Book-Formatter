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
 * - **Nothing translucent reaches the file.** KDP: "Flatten all
 *   transparencies." The grounds, the figures and the marks are composited
 *   with what lies under them into one opaque background at 300 DPI, and the
 *   type, rules and barcode are drawn over it as vectors. See `flattenPlan`.
 *
 * Browser-only: pdf-lib, fontkit, and a canvas to flatten into.
 */
import { PDFDocument, degrees, rgb, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { FLATTEN_DPI, flattenPlan, type ComposedCover, type CoverItem, type Hex } from '@core/cover'
import type { FontRef } from '@core/layout'
import { LAYOUT_FEATURES, type FontTable } from './fonts'
import { verifyWidths, widenWidths } from './font-widths'

export interface CoverPdfResult {
  bytes: Uint8Array
  /**
   * How many items were composited into the opaque background, so a caller
   * can say the cover was flattened rather than assume it. Zero where nothing
   * on the cover was translucent.
   */
  flattenedItems: number
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
 * Composite the raster half of a `flattenPlan` into one opaque JPEG.
 *
 * Painted with the canvas in the composer's own coordinates — top-left origin,
 * points — scaled to `FLATTEN_DPI`, so every translucent item lands on exactly
 * what it lay over and the alpha is spent here rather than in the PDF. JPEG
 * because a full-bleed sheet at 300 DPI is fourteen megapixels and the
 * picture under it is a photograph or a faint ground, where a PNG would be
 * five times the size for nothing a press can print.
 */
async function flattenBackground(
  items: readonly CoverItem[],
  indices: readonly number[],
  widthPt: number,
  heightPt: number,
  pictures: ReadonlyMap<string, ImageBitmap>
): Promise<Uint8Array> {
  const scale = FLATTEN_DPI / 72
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(widthPt * scale)
  canvas.height = Math.round(heightPt * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context to flatten the cover into')
  ctx.scale(scale, scale)
  // Opaque white first: the sheet is paper, and a JPEG has no alpha to fall
  // back on, so anything the ground failed to cover must read as paper.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthPt, heightPt)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (const i of indices) {
    const item = items[i]!
    ctx.save()
    if ('opacity' in item && item.opacity !== undefined) ctx.globalAlpha = item.opacity
    if (item.kind === 'fill') {
      ctx.fillStyle = item.color
      ctx.fillRect(item.xPt, item.yPt, item.widthPt, item.heightPt)
    } else if (item.kind === 'image') {
      const bitmap = pictures.get(item.id)
      if (bitmap) {
        ctx.drawImage(
          bitmap,
          item.srcX,
          item.srcY,
          item.srcWidth,
          item.srcHeight,
          item.xPt,
          item.yPt,
          item.widthPt,
          item.heightPt
        )
      }
    } else if (item.kind === 'ornament') {
      // The same transform pdf-lib's drawSvgPath applies, in the composer's
      // own y-down space: the path's origin at (x, y), its units scaled.
      ctx.translate(item.xPt, item.yPt)
      ctx.scale(item.scale, item.scale)
      for (const shape of item.art.shapes) {
        const path = new Path2D(shape.d)
        if (shape.stroke === undefined) {
          ctx.fillStyle = item.color
          ctx.fill(path)
        } else {
          ctx.strokeStyle = item.color
          ctx.lineWidth = shape.stroke
          ctx.stroke(path)
        }
      }
    }
    ctx.restore()
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas produced no blob'))),
      'image/jpeg',
      0.92
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
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

  // Then flatten. KDP: "Flatten all transparencies." Everything translucent,
  // and everything it lies over, goes into one opaque background; the rest is
  // drawn on top below with no opacity anywhere, so the file carries no soft
  // mask, no alpha channel and no transparency state at all.
  const plan = flattenPlan(composed.items)
  const missingImages: string[] = []
  const pictures = new Map<string, ImageBitmap>()
  for (const i of plan.raster) {
    const item = composed.items[i]!
    if (item.kind !== 'image' || pictures.has(item.id)) continue
    const bytes = options.images?.get(item.id)
    if (!bytes) {
      if (!missingImages.includes(item.id)) missingImages.push(item.id)
      continue
    }
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' })
    pictures.set(item.id, await createImageBitmap(blob))
  }
  try {
    if (plan.raster.length > 0) {
      const background = await flattenBackground(
        composed.items,
        plan.raster,
        widthPt,
        heightPt,
        pictures
      )
      const image = await doc.embedJpg(background)
      page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt })
    }
  } finally {
    for (const bitmap of pictures.values()) bitmap.close()
  }

  // An image left on the vector side would carry its alpha into the file, so
  // the plan never puts one there; this is the writer refusing to be the place
  // that assumption breaks.
  for (const i of plan.vector) {
    if (composed.items[i]!.kind === 'image') {
      throw new Error(
        'An image was left out of the flattened background; the cover was not written.'
      )
    }
  }
  const drawn = new Map<PDFFont, string[]>()

  for (const i of plan.vector) {
    const item = composed.items[i]!
    switch (item.kind) {
      case 'fill':
        page.drawRectangle({
          x: item.xPt,
          y: heightPt - item.yPt - item.heightPt,
          width: item.widthPt,
          height: item.heightPt,
          color: hexToRgb(item.color)
        })
        break

      case 'image':
        break

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
              : {
                  borderColor: hexToRgb(item.color),
                  borderWidth: shape.stroke * item.scale
                })
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
    flattenedItems: plan.raster.length,
    widthPt,
    heightPt,
    embeddedFamilies: [...embeddedFamilies],
    missingImages,
    ligatureGlyphs: [...new Set(ligatureGlyphs)].sort()
  }
}
