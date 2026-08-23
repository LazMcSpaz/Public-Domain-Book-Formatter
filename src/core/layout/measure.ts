/**
 * The seam that keeps the layout engine pure.
 *
 * Measuring text needs a font file; a font file needs a platform. Rather than
 * let that pull the DOM into `core`, the engine takes a `TextMeasurer` and asks
 * it for widths. The browser supplies one backed by fontkit — *the same call
 * pdf-lib makes when it encodes text*, so what the engine measures and what the
 * PDF draws are identical by construction rather than by hope.
 *
 * Tests supply {@link fixedWidthMeasurer}, whose glyphs are all one width, so
 * every break lands on an exact integer and assertions say what they mean.
 *
 * Pure: an interface and a deterministic fake.
 */
import type { FontRef } from './types'

/** Vertical metrics for a face at a size, in points. */
export interface FontMetrics {
  /** Distance from the baseline to the top of the tallest glyph. Positive. */
  ascent: number
  /** Distance from the baseline down to the lowest descender. Positive. */
  descent: number
  /** The font's own recommended extra space between lines. Often zero. */
  lineGap: number
}

export interface TextMeasurer {
  /** Advance width of `text` set in `font` at `sizePt`, in points. */
  widthOf(text: string, font: FontRef, sizePt: number): number
  metrics(font: FontRef, sizePt: number): FontMetrics
  /**
   * Whether this family carries real small capitals.
   *
   * The engine has to ask, because only three of the seven faces offered do —
   * and one of the four without them is IM FELL English, the face recommended
   * for exactly the 17th-century books most likely to want the look. Asking
   * keeps the alternative honest: a face with no `smcp` gets full capitals,
   * which is a different texture, rather than capitals scaled down, which is a
   * forgery.
   */
  hasSmallCaps(family: string): boolean
  /**
   * Whether this family carries a real bold.
   *
   * Five of the seven do. IM FELL English does not — it is a digitisation of
   * types cut before bold existed as a thing a face had — and neither does
   * anything else the user may add later. Asking is what keeps the alternative
   * honest: a strong run in a face with no bold is set in italic rather than in
   * a bold smeared out of the regular outlines.
   */
  hasBold(family: string): boolean
}

/**
 * A measurer whose every glyph is `emRatio` of the point size wide.
 *
 * Real fonts make line breaks depend on the exact face, which would make the
 * layout tests assertions about EB Garamond rather than about the engine. With
 * a fixed width, "this 40-point-wide line fits four 10-point words" is
 * arithmetic, and a failing test means the engine changed.
 */
export function fixedWidthMeasurer(emRatio = 0.5): TextMeasurer {
  return {
    widthOf: (text, _font, sizePt) => [...text].length * sizePt * emRatio,
    metrics: (_font, sizePt) => ({
      ascent: sizePt * 0.75,
      descent: sizePt * 0.25,
      lineGap: 0
    }),
    // The fixed-width measurer stands in for a font it does not have, so it
    // reports the capability the engine's default path assumes: none.
    hasSmallCaps: () => false,
    hasBold: () => false
  }
}

/**
 * Wrap a measurer in a cache.
 *
 * Knuth–Plass measures every word of a paragraph, and pagination may run the
 * whole book more than once (the footnote re-flow, the two-pass TOC). Book
 * vocabulary repeats heavily, so this turns most measurements into a map hit.
 */
export function cachedMeasurer(inner: TextMeasurer): TextMeasurer {
  const widths = new Map<string, number>()
  const metrics = new Map<string, FontMetrics>()
  return {
    widthOf(text, font, sizePt) {
      // `smallCaps` is part of the key: the same word at the same size is a
      // different width in small capitals, and leaving it out would serve one
      // measurement for both.
      const key = [font.family, font.style, font.smallCaps ? 'sc' : '', sizePt, text].join('\u0000')
      let w = widths.get(key)
      if (w === undefined) {
        w = inner.widthOf(text, font, sizePt)
        widths.set(key, w)
      }
      return w
    },
    metrics(font, sizePt) {
      const key = [font.family, font.style, sizePt].join('\u0000')
      let m = metrics.get(key)
      if (m === undefined) {
        m = inner.metrics(font, sizePt)
        metrics.set(key, m)
      }
      return m
    },
    // Not cached: it is a lookup in a small table, and caching a capability
    // behind the same wrapper that caches measurements would invite the two to
    // be invalidated on different schedules.
    hasSmallCaps: (family) => inner.hasSmallCaps(family),
    hasBold: (family) => inner.hasBold(family)
  }
}
