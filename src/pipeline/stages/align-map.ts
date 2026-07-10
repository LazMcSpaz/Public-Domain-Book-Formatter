/**
 * Coordinate-map realignment (SPEC §2 backbone; output-offset convention).
 *
 * The OCR stage seeds each token's `output` range against a naive "all words
 * joined by single spaces" string. But the markdown actually handed to the
 * review instrument is built and then mutated by later stages (pages joined by
 * blank lines, ligature/long-s normalization, header/footer stripping, blank-run
 * collapsing, trimming). Those edits shift character offsets, so the seeded
 * ranges drift out of sync with `ProjectFile.markdown` — the source crop (which
 * is bbox-based) stays correct while the output-side highlight lands on the
 * wrong word, and the error accumulates through the book.
 *
 * This pass re-derives every token's `output` range by walking the tokens in
 * document order and locating each one's text in the final markdown from a
 * monotonically-advancing cursor. It degrades locally: a token whose text was
 * rewritten (e.g. a ligature) or dropped just gets a zero-width range and the
 * cursor doesn't advance, so the following tokens re-sync instead of the whole
 * tail drifting.
 */
import type { MappingEntry, SourcePage } from '@core/model'

/**
 * How far past the cursor we'll look for a token before giving up. Consecutive
 * in-order tokens are normally 1–2 chars apart (a space, or a page break); the
 * window only needs to absorb small length changes from cleanup, not jump over
 * large stretches (which would risk matching a later, identical word).
 */
const SEARCH_WINDOW = 240

/** Strip leading/trailing non-alphanumerics so "inter-" can match "inter". */
function core(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')
}

/**
 * Find `token` in `text` at or after `from`, within the search window. Tries an
 * exact match first, then the alphanumeric core (handles trailing hyphens and
 * attached punctuation that cleanup may have altered). Returns the match start
 * and length, or null when nothing plausible is nearby.
 */
function locate(
  text: string,
  token: string,
  from: number
): { start: number; length: number } | null {
  if (token.length > 0) {
    const exact = text.indexOf(token, from)
    if (exact >= 0 && exact - from <= SEARCH_WINDOW) {
      return { start: exact, length: token.length }
    }
  }
  const c = core(token)
  if (c.length > 0 && c !== token) {
    const approx = text.indexOf(c, from)
    if (approx >= 0 && approx - from <= SEARCH_WINDOW) {
      return { start: approx, length: c.length }
    }
  }
  return null
}

/**
 * Return a new set of entries whose `output` ranges point at the tokens' real
 * positions in `markdown`. Tokens are matched in the pages' document order (the
 * same order the OCR stage built the map in). Entries are returned sorted by
 * output start, matching `CoordinateMap`'s invariant. Entries without a
 * corresponding word are passed through unchanged.
 */
export function realignCoordinateMap(
  pages: SourcePage[],
  markdown: string,
  entries: MappingEntry[]
): MappingEntry[] {
  const byId = new Map(entries.map((e) => [e.tokenId, e]))
  const touched = new Set<string>()
  const result: MappingEntry[] = []
  let cursor = 0

  for (const page of pages) {
    for (const word of page.words) {
      const entry = byId.get(word.id)
      if (!entry) continue
      touched.add(word.id)

      const hit = locate(markdown, word.text, cursor)
      if (hit) {
        result.push({ ...entry, output: { start: hit.start, end: hit.start + hit.length } })
        cursor = hit.start + hit.length
      } else {
        // Rewritten/dropped token: collapse to a zero-width anchor at the cursor
        // and don't advance, so the next token re-syncs from here.
        const at = Math.min(cursor, markdown.length)
        result.push({ ...entry, output: { start: at, end: at } })
      }
    }
  }

  // Preserve any entries that had no matching word (defensive; normally none).
  for (const entry of entries) {
    if (!touched.has(entry.tokenId)) result.push(entry)
  }

  result.sort((a, b) => a.output.start - b.output.start || a.output.end - b.output.end)
  return result
}
