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
  /**
   * Where the *ink* of `text` starts and ends, relative to its origin.
   *
   * Not the same as the advance box, and the difference is what makes a
   * centred line look off-centre. Advance width includes each glyph's side
   * bearings, and those differ by letter: a line ending in `D` has a tight
   * right bearing where one ending in `A` has a wide one, because the
   * diagonal terminates early. Centre two such lines by advance and the ink
   * lands two or three points apart — measured on a real cover, and visible.
   *
   * The same family of problem `optical.ts` solves for hanging punctuation,
   * and answered the same way: measure what is drawn, not the box around it.
   *
   * Used by the cover composer, where every line is centred display type.
   * The interior deliberately still centres its headings on the advance box —
   * changing that would move type on pages this app has already set, for a
   * refinement nobody has asked for there.
   */
  inkExtents(text: string, font: FontRef, sizePt: number): { left: number; right: number }
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
    // The fake has no outlines, so its ink *is* its advance box. That keeps
    // every layout assertion an exact integer while still driving the code
    // path a real font takes.
    inkExtents: (text, _font, sizePt) => ({
      left: 0,
      right: [...text].length * sizePt * emRatio
    }),
    metrics: (_font, sizePt) => ({
      ascent: sizePt * 0.75,
      descent: sizePt * 0.25,
      lineGap: 0
    }),
    // The fixed-width measurer stands in for a font it does not have, so it
    // reports the capability the engine's default path assumes: none.
    hasSmallCaps: () => false
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
  const extents = new Map<string, { left: number; right: number }>()
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
    inkExtents(text, font, sizePt) {
      // Cached beside the widths and keyed the same way. A cover asks for the
      // same title at a dozen sizes while `fitText` searches, and each ask
      // walks the glyph outlines.
      const key = ['ink', font.family, font.style, font.smallCaps ? 'sc' : '', sizePt, text].join(
        '\u0000'
      )
      let e = extents.get(key)
      if (e === undefined) {
        e = inner.inkExtents(text, font, sizePt)
        extents.set(key, e)
      }
      return e
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
    hasSmallCaps: (family) => inner.hasSmallCaps(family)
  }
}
