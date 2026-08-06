/**
 * Fonts: one load, two consumers.
 *
 * The same TTF bytes serve both jobs — fontkit measures with them and pdf-lib
 * embeds them — and that is the point. Measuring with one engine and drawing
 * with another is exactly how WYSIWYG breaks, so the measurer here sums the
 * advances of the glyphs `font.layout()` returns, which is *the same call
 * pdf-lib makes internally to encode text*. The two cannot disagree.
 *
 * All faces are open-licensed (OFL), so a book set in them can legally be sold.
 * That is not a detail: system fonts generally cannot be embedded in a book for
 * sale, which rules them out for this app's entire purpose.
 *
 * Browser-only: `fetch` and `URL`.
 */
import fontkit from '@pdf-lib/fontkit'
import type { Font as FontkitFont, TypeFeatures } from '@pdf-lib/fontkit'
import type { FontMetrics, FontRef, FontStyle, TextMeasurer } from '@core/layout'

import ebGaramondRegular from '@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf?url'
import ebGaramondItalic from '@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf?url'
import cardoRegular from '@expo-google-fonts/cardo/400Regular/Cardo_400Regular.ttf?url'
import cardoItalic from '@expo-google-fonts/cardo/400Regular_Italic/Cardo_400Regular_Italic.ttf?url'
import imFellRegular from '@expo-google-fonts/im-fell-english/400Regular/IMFellEnglish_400Regular.ttf?url'
import imFellItalic from '@expo-google-fonts/im-fell-english/400Regular_Italic/IMFellEnglish_400Regular_Italic.ttf?url'
import baskervilleRegular from '@expo-google-fonts/libre-baskerville/400Regular/LibreBaskerville_400Regular.ttf?url'
import baskervilleItalic from '@expo-google-fonts/libre-baskerville/400Regular_Italic/LibreBaskerville_400Regular_Italic.ttf?url'
import caslonRegular from '@expo-google-fonts/libre-caslon-text/400Regular/LibreCaslonText_400Regular.ttf?url'
import caslonItalic from '@expo-google-fonts/libre-caslon-text/400Regular_Italic/LibreCaslonText_400Regular_Italic.ttf?url'
import crimsonRegular from '@expo-google-fonts/crimson-pro/400Regular/CrimsonPro_400Regular.ttf?url'
import crimsonItalic from '@expo-google-fonts/crimson-pro/400Regular_Italic/CrimsonPro_400Regular_Italic.ttf?url'

/** Where each family's faces come from. Keys match `StyleProfile.bodyFont`. */
const FONT_URLS: Record<string, Record<FontStyle, string>> = {
  'EB Garamond': { regular: ebGaramondRegular, italic: ebGaramondItalic },
  Cardo: { regular: cardoRegular, italic: cardoItalic },
  'IM FELL English': { regular: imFellRegular, italic: imFellItalic },
  'Libre Baskerville': { regular: baskervilleRegular, italic: baskervilleItalic },
  'Libre Caslon Text': { regular: caslonRegular, italic: caslonItalic },
  'Crimson Pro': { regular: crimsonRegular, italic: crimsonItalic }
}

/**
 * Junicode is not on npm — it is not a Google font — so it is vendored by hand
 * into `public/fonts/junicode/`. Because it exists for enormous glyph coverage
 * (medieval scholarship), it is far larger than the other six, and it is the
 * only face the user is unlikely to pick. So it loads on demand rather than
 * with the rest, and its absence is reported rather than hidden.
 */
const JUNICODE_URLS: Record<FontStyle, string> = {
  regular: 'fonts/junicode/Junicode.ttf',
  italic: 'fonts/junicode/Junicode-Italic.ttf'
}

/** The face used when a profile names a family this app cannot embed. */
export const FALLBACK_FAMILY = 'EB Garamond'

/**
 * The OpenType features used for **both** measuring and drawing.
 *
 * Ligatures are switched off, and that is a deliberate, unhappy trade. pdf-lib
 * builds a simple font's width array by walking the font's *character set* and
 * taking the glyph for each code point (`CustomFontEmbedder`). A ligature glyph
 * — `f_i` — is reachable from no single code point, so it never gets a width
 * written, and the PDF reader falls back to the default (a full em). The result
 * is a gaping hole after every "fi" and every following word shunted right; it
 * is what "his fi ndingsto the assembled" looks like on a printed page.
 *
 * The other embedder (`subset: true`) derives widths from the glyphs actually
 * laid out and so gets ligatures right — but corrupts the outlines of half
 * these faces. See `pdf-out.ts`. Between "no fi ligature" and "broken words",
 * the typography loses.
 *
 * Whatever is decided here must be used by the measurer *and* the embedder, or
 * the two disagree about how wide a word is — which is why this constant is
 * exported rather than written out twice.
 */
export const LAYOUT_FEATURES: TypeFeatures = {
  liga: false,
  dlig: false,
  hlig: false,
  clig: false,
  rlig: false
}

/** Every family the app can set a book in, in the order the interview offers them. */
export function availableFamilies(): string[] {
  return [...Object.keys(FONT_URLS), 'Junicode']
}

interface LoadedFace {
  bytes: Uint8Array
  font: FontkitFont
}

/**
 * The loaded faces, plus the two things anything downstream needs of them: a
 * `TextMeasurer` for the layout engine and the raw bytes for the embedder.
 */
export interface FontTable extends TextMeasurer {
  /** TTF bytes for a face, for `PDFDocument.embedFont`. Null when unavailable. */
  bytesFor(font: FontRef): Uint8Array | null
  /** The family actually used for a request, after any substitution. */
  resolve(family: string): string
  /**
   * Families that were asked for and could not be loaded, mapped to what was
   * used instead. Surfaced to the user rather than silently swapped: a preview
   * that quietly shows a different typeface is worse than no preview.
   */
  readonly substitutions: ReadonlyMap<string, string>
}

const cache = new Map<string, Promise<LoadedFace | null>>()

async function fetchFace(url: string): Promise<LoadedFace | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { bytes, font: fontkit.create(bytes) }
  } catch {
    return null
  }
}

function urlFor(family: string, style: FontStyle): string | null {
  const entry = FONT_URLS[family]
  if (entry) return entry[style]
  if (family === 'Junicode') {
    // Resolved against the app's base URL so it works under a subpath deploy,
    // the same way the vendored Tesseract assets are.
    return new URL(JUNICODE_URLS[style], document.baseURI).toString()
  }
  return null
}

function loadFace(family: string, style: FontStyle): Promise<LoadedFace | null> {
  const key = `${family}|${style}`
  let pending = cache.get(key)
  if (!pending) {
    const url = urlFor(family, style)
    pending = url === null ? Promise.resolve(null) : fetchFace(url)
    cache.set(key, pending)
  }
  return pending
}

/**
 * Load the faces a book needs and return a table over them.
 *
 * Both styles of every requested family are loaded, because italic is reached
 * by an epigraph or a caption rather than by a question the user answered —
 * discovering the need mid-layout would mean an async call inside a pure
 * function, which is the one thing the `TextMeasurer` seam exists to prevent.
 */
export async function loadFonts(families: readonly string[]): Promise<FontTable> {
  const wanted = [...new Set([...families, FALLBACK_FAMILY])]
  const substitutions = new Map<string, string>()
  const faces = new Map<string, LoadedFace>()

  await Promise.all(
    wanted.flatMap((family) =>
      (['regular', 'italic'] as FontStyle[]).map(async (style) => {
        const face = await loadFace(family, style)
        if (face) faces.set(`${family}|${style}`, face)
      })
    )
  )

  for (const family of wanted) {
    if (!faces.has(`${family}|regular`) && family !== FALLBACK_FAMILY) {
      substitutions.set(family, FALLBACK_FAMILY)
    }
  }

  const resolve = (family: string): string =>
    faces.has(`${family}|regular`) ? family : FALLBACK_FAMILY

  const faceFor = (ref: FontRef): LoadedFace | null => {
    const family = resolve(ref.family)
    // A family with no italic — or a synthetic style — falls back to its own
    // regular rather than to another family's italic. Staying inside the
    // typeface matters more than honouring the slant.
    return faces.get(`${family}|${ref.style}`) ?? faces.get(`${family}|regular`) ?? null
  }

  return {
    widthOf(text, ref, sizePt) {
      const face = faceFor(ref)
      if (!face) return text.length * sizePt * 0.5
      // Summing each glyph's own advance is not an approximation of what
      // pdf-lib does — it is what pdf-lib does. `run.advanceWidth` differs,
      // because it includes kerning adjustments that a plain `Tj` never
      // applies, and using it here would put the preview a few points off the
      // export on every line.
      const run = face.font.layout(text, LAYOUT_FEATURES)
      let units = 0
      for (const glyph of run.glyphs) units += glyph.advanceWidth
      return (units / face.font.unitsPerEm) * sizePt
    },

    metrics(ref, sizePt): FontMetrics {
      const face = faceFor(ref)
      if (!face) return { ascent: sizePt * 0.75, descent: sizePt * 0.25, lineGap: 0 }
      const scale = sizePt / face.font.unitsPerEm
      return {
        ascent: face.font.ascent * scale,
        descent: Math.abs(face.font.descent) * scale,
        lineGap: face.font.lineGap * scale
      }
    },

    bytesFor(ref) {
      return faceFor(ref)?.bytes ?? null
    },

    resolve,
    substitutions
  }
}
