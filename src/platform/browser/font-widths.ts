/**
 * Give every glyph the book actually prints a width in the PDF.
 *
 * ## The defect this repairs
 *
 * pdf-lib embeds a custom face as a Type0 font with Identity-H encoding, and
 * `encodeText` already writes **glyph ids** — so the encoding was never the
 * problem. The problem is one list. `CustomFontEmbedder` builds the glyph set
 * for both the `/W` width array and the `ToUnicode` map by walking the font's
 * *character set* and taking the glyph each code point maps to:
 *
 *     for (codePoint of font.characterSet) glyphs.push(font.glyphForCodePoint(codePoint))
 *
 * A glyph arrived at any other way is in neither. Two kinds of glyph are:
 *
 * - **ligatures** — `f_i` answers to no single code point;
 * - **contextual alternates** — Junicode's `f.rf`, substituted for an `f`
 *   standing before another `f` so the two do not collide.
 *
 * Missing from `/W`, such a glyph takes the default width of a full em: a
 * gaping hole mid-word and every following word shoved right. Missing from
 * `ToUnicode`, a reader falls back to reading the CID as a code point, so the
 * page that says "difference" copies out as "diβerence" — which is also what a
 * screen reader says aloud.
 *
 * The app's answer until now was to switch the offending features off. That
 * works, and it costs a book its ligatures.
 *
 * ## The repair
 *
 * Widen the list: keep every code-point-reachable glyph, then add the glyphs
 * the book's own text lays out to. Both then carry real `codePoints` — a
 * ligature glyph reports the components it stands for, `[f, i]` — so `/W` gets
 * a true width and `ToUnicode` gets a *better* mapping than before, because
 * "ﬁ" now copies out as "fi".
 *
 * Only the glyphs the book uses are added, never the whole font. Adding
 * everything is worse than doing nothing: most glyphs in a large face are
 * reachable from no code point and report none, and an empty `ToUnicode` entry
 * poisons extraction for the entire document. Junicode extracted as line noise
 * when that was tried.
 *
 * ## Why this reaches into pdf-lib
 *
 * There is no public seam. `glyphCache` is an instance property holding a
 * `Cache` — an object with `access`/`getValue`/`invalidate` — populated lazily
 * on first read, which happens during `save()`. Replacing it before then is the
 * whole intervention, and pdf-lib is pinned, so the shape cannot move under us
 * without a lockfile change. `verifyWidths` below turns any future drift into a
 * loud failure rather than a book with holes in it.
 */
import type { PDFFont } from 'pdf-lib'
import type { Font as FontkitFont, Glyph, TypeFeatures } from '@pdf-lib/fontkit'

/**
 * The private shape of pdf-lib's `CustomFontEmbedder` that this module needs.
 * Declared rather than imported because pdf-lib exports none of it.
 */
interface GlyphCache {
  access(): Glyph[]
  getValue(): Glyph[] | undefined
  invalidate(): void
}
interface CustomEmbedder {
  font: FontkitFont
  fontFeatures?: TypeFeatures
  glyphCache: GlyphCache
}

/** True for a face embedded from bytes; false for a standard PDF font. */
function embedderOf(font: PDFFont): CustomEmbedder | null {
  const embedder = (font as unknown as { embedder?: Partial<CustomEmbedder> }).embedder
  if (!embedder?.font || !embedder.glyphCache) return null
  return embedder as CustomEmbedder
}

/** Every glyph some code point maps to — what pdf-lib would have used alone. */
function reachableGlyphs(font: FontkitFont): Map<number, Glyph> {
  const byId = new Map<number, Glyph>()
  for (const codePoint of font.characterSet) {
    const glyph = font.glyphForCodePoint(codePoint)
    if (glyph) byId.set(glyph.id, glyph)
  }
  return byId
}

/**
 * Widen one font's glyph list to cover the text it was actually used to draw.
 *
 * Returns the glyphs added, for the caller's report and for the tests. An empty
 * result is the normal case for a face whose features produced nothing exotic.
 */
export function widenWidths(font: PDFFont, texts: Iterable<string>): Glyph[] {
  const embedder = embedderOf(font)
  if (!embedder) return []

  const byId = reachableGlyphs(embedder.font)
  const added: Glyph[] = []
  for (const text of texts) {
    // The same features pdf-lib will encode with, so the glyphs collected here
    // are exactly the glyphs written into the content stream. Reading them off
    // the embedder rather than taking them as an argument means the two cannot
    // be given different answers.
    for (const glyph of embedder.font.layout(text, embedder.fontFeatures).glyphs) {
      if (byId.has(glyph.id)) continue
      byId.set(glyph.id, glyph)
      added.push(glyph)
    }
  }
  if (added.length === 0) return []

  const glyphs = [...byId.values()].sort((a, b) => a.id - b.id)
  embedder.glyphCache = {
    access: () => glyphs,
    getValue: () => glyphs,
    invalidate() {}
  }
  return added
}

/**
 * Confirm every glyph the book prints will get a width, and say which will not.
 *
 * The check the widening is worthless without. Its failure mode is silence —
 * text drawn through a path the collector missed lays out to a glyph nobody
 * added, and the only symptom is a printed page with a hole in it. So this is
 * asserted rather than assumed, and the caller raises it: a book that cannot be
 * set correctly must not be handed to someone about to sell it.
 */
export function verifyWidths(font: PDFFont, texts: Iterable<string>): string[] {
  const embedder = embedderOf(font)
  if (!embedder) return []

  const covered = new Set(embedder.glyphCache.access().map((g) => g.id))
  const missing = new Set<string>()
  for (const text of texts) {
    for (const glyph of embedder.font.layout(text, embedder.fontFeatures).glyphs) {
      if (!covered.has(glyph.id)) missing.add(glyph.name ?? String(glyph.id))
    }
  }
  return [...missing]
}
