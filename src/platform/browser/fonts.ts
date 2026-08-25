/**
 * Fonts: one load, two consumers.
 *
 * The same font bytes serve both jobs — fontkit measures with them and pdf-lib
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
 * (medieval scholarship: long-s, thorn, eth, yogh, and 5,980 glyphs in all), it
 * is far larger than the other six, and it is the only face the user is
 * unlikely to pick. So it loads on demand rather than with the rest, and its
 * absence is reported rather than hidden.
 *
 * **These are OTF/CFF, not TrueType** — the only faces here that are. That is
 * worth knowing because pdf-lib's whole-font embedder has to write a CFF
 * FontFile3 rather than a FontFile2, a path nothing else in this app exercises.
 * It works: the file embeds, pdf.js reads the text back, and `test/fonts-
 * junicode.test.ts` holds it to that. Do not swap in the variable-font build to
 * save space — one `.otf` per style is what both fontkit and pdf-lib expect,
 * and a variable font embeds as whatever single instance the reader guesses.
 */
const JUNICODE_URLS: Record<FontStyle, string> = {
  regular: 'fonts/junicode/Junicode-Regular.otf',
  italic: 'fonts/junicode/Junicode-Italic.otf'
}

/** The face used when a profile names a family this app cannot embed. */
export const FALLBACK_FAMILY = 'EB Garamond'

/**
 * The OpenType features used for **both** measuring and drawing.
 *
 * This was, for a long time, a list of things switched *off*. Ligatures went
 * first, then Junicode's contextual alternates, both for the same reason:
 * pdf-lib wrote no width for a glyph no code point reaches, so an `f_i` printed
 * as a full em of white space — "his fi ndingsto the assembled" — and copied
 * out as line noise besides. The comment here called it "a deliberate, unhappy
 * trade" and picked the readable half.
 *
 * The trade is off. `font-widths.ts` writes the missing widths, so the features
 * a book face was designed around can be left alone, and the defaults below are
 * the font's own: ligatures, contextual alternates, kerning and the rest.
 *
 * What stays off is a choice about typography rather than a workaround:
 *
 * - `dlig` — discretionary ligatures (ct, st, sp). Handsome on a title page and
 *   distracting through 300 pages of body text; a face that wants them wants
 *   them by the editor's decision, not by default.
 * - `hlig` — historical ligatures, which in most faces means the long-s forms.
 *   A reprint that has *preserved* its original orthography already carries
 *   real long-s characters from the scan; synthesising more from modern `s`
 *   would change what the book says, which the proof step exists to prevent.
 *
 * Whatever is decided here must be used by the measurer *and* the embedder, or
 * the two disagree about how wide a word is — which is why this constant is
 * exported rather than written out twice.
 */
export const LAYOUT_FEATURES: TypeFeatures = {
  dlig: false,
  hlig: false
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
  /** Font bytes for a face, for `PDFDocument.embedFont`. Null when unavailable. */
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
const tables = new Map<string, Promise<FontTable>>()

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
 * The font table for a set of families, built once and shared.
 *
 * The design gate rebuilds its preview on every answer, and the export builds
 * the same book again at the end; all of them want the same faces. Keying the
 * table by its family set means the TTFs are parsed once per session rather
 * than once per radio button.
 */
export function fontTableFor(families: readonly string[]): Promise<FontTable> {
  const key = [...new Set(families)].sort().join('|')
  let pending = tables.get(key)
  if (!pending) {
    pending = loadFonts(families)
    tables.set(key, pending)
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

  /**
   * The features a run is laid out with: the shared defaults, plus `smcp` when
   * the run asked for small capitals *and* the face has them. Asking for a
   * feature a font does not carry is harmless — fontkit ignores it — but the
   * engine decides that question up front so the measured width and the drawn
   * glyphs come from the same answer.
   */
  const featuresFor = (ref: FontRef): TypeFeatures =>
    ref.smallCaps ? { ...LAYOUT_FEATURES, smcp: true } : LAYOUT_FEATURES

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
      const run = face.font.layout(text, featuresFor(ref))
      let units = 0
      for (const glyph of run.glyphs) units += glyph.advanceWidth
      return (units / face.font.unitsPerEm) * sizePt
    },

    inkExtents(text, ref, sizePt) {
      const face = faceFor(ref)
      if (!face || text.length === 0) {
        return { left: 0, right: text.length * sizePt * 0.5 }
      }

      // Walk the run with a pen, exactly as the writer will, and take each
      // glyph's own outline bounds rather than its advance box. The two differ
      // by the side bearings, which is the whole reason this exists.
      const run = face.font.layout(text, featuresFor(ref))
      const scale = sizePt / face.font.unitsPerEm
      let pen = 0
      let left = Infinity
      let right = -Infinity
      for (const glyph of run.glyphs) {
        const box = glyph.bbox
        // A space has no outline; fontkit reports an empty or inverted box for
        // it. Skipping it is right: a line centred on its ink should not count
        // a trailing space, which is exactly the kind of thing that shifts a
        // heading and cannot be seen.
        if (box && box.maxX > box.minX) {
          left = Math.min(left, pen + box.minX * scale)
          right = Math.max(right, pen + box.maxX * scale)
        }
        pen += glyph.advanceWidth * scale
      }
      // Nothing but spaces: fall back to the advance box, which is the honest
      // answer for a run with no ink in it.
      if (left === Infinity) return { left: 0, right: pen }
      return { left, right }
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

    hasSmallCaps(family) {
      const face = faces.get(`${resolve(family)}|regular`)
      return face ? face.font.availableFeatures.includes('smcp') : false
    },

    resolve,
    substitutions
  }
}
