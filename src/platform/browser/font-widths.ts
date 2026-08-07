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
/** What `widenWidths` changed about a face's glyph list. */
export interface WidenResult {
  /** Glyphs no code point reaches, added so they get a width. */
  added: Glyph[]
  /** Glyphs the font itself cannot measure, left out so the book can be built. */
  dropped: Glyph[]
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

/**
 * Whether a glyph can be written into the PDF at all.
 *
 * Reading the metrics is the test because that is what pdf-lib does to build
 * the width array, and it is where a malformed font gives way. Crimson Pro
 * ships a final glyph named `NULL`, mapped from U+0000, whose outline record
 * runs past the end of its `glyf` table; fontkit raises "Trying to access
 * beyond buffer length" the moment anything asks how wide it is.
 *
 * That one glyph made the whole face unusable — every book set in Crimson Pro
 * failed at the export gate with a message naming neither the font nor the
 * glyph. It is not a glyph any book prints, so the right answer is to leave it
 * out rather than to refuse the book. If a *needed* glyph were ever dropped,
 * `verifyWidths` raises: dropping is silent only when it is harmless.
 */
function isWritable(glyph: Glyph): boolean {
  try {
    void glyph.advanceWidth
    return true
  } catch {
    return false
  }
}

/** Every glyph some code point maps to — what pdf-lib would have used alone. */
function reachableGlyphs(font: FontkitFont): { byId: Map<number, Glyph>; dropped: Glyph[] } {
  const byId = new Map<number, Glyph>()
  const dropped: Glyph[] = []
  for (const codePoint of font.characterSet) {
    const glyph = font.glyphForCodePoint(codePoint)
    if (!glyph) continue
    if (isWritable(glyph)) byId.set(glyph.id, glyph)
    else if (!dropped.some((g) => g.id === glyph.id)) dropped.push(glyph)
  }
  return { byId, dropped }
}

/**
 * Widen one font's glyph list to cover the text it was actually used to draw.
 *
 * Returns what changed, for the caller's report and for the tests: glyphs
 * `added` because no code point reaches them, and glyphs `dropped` because the
 * font cannot say how wide they are.
 */
export function widenWidths(font: PDFFont, texts: Iterable<string>): WidenResult {
  const embedder = embedderOf(font)
  if (!embedder) return { added: [], dropped: [] }

  const { byId, dropped } = reachableGlyphs(embedder.font)
  const added: Glyph[] = []
  for (const text of texts) {
    // The same features pdf-lib will encode with, so the glyphs collected here
    // are exactly the glyphs written into the content stream. Reading them off
    // the embedder rather than taking them as an argument means the two cannot
    // be given different answers.
    for (const glyph of embedder.font.layout(text, embedder.fontFeatures).glyphs) {
      if (byId.has(glyph.id)) continue
      if (!isWritable(glyph)) continue
      byId.set(glyph.id, glyph)
      added.push(glyph)
    }
  }
  // Both directions count as a change: a face may need nothing added and still
  // need its broken glyph taken out.
  if (added.length === 0 && dropped.length === 0) return { added, dropped }

  const glyphs = [...byId.values()].sort((a, b) => a.id - b.id)
  embedder.glyphCache = {
    access: () => glyphs,
    getValue: () => glyphs,
    invalidate() {}
  }
  return { added, dropped }
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
    // Laying out is itself fallible: `layout` positions glyphs, which reads
    // their advances, so a string that reaches an unmeasurable glyph raises
    // here rather than returning one. A check that throws is a check that
    // tells the caller nothing, so the text is named instead.
    try {
      for (const glyph of embedder.font.layout(text, embedder.fontFeatures).glyphs) {
        if (!covered.has(glyph.id)) missing.add(glyph.name ?? String(glyph.id))
      }
    } catch {
      missing.add(`unsettable text: “${text.slice(0, 40)}”`)
    }
  }
  return [...missing]
}
