/**
 * Footnote linking (SPEC §5).
 *
 * The footnote tag does two jobs: it pulls the note text out of the body flow
 * *and* re-links it to its in-text reference mark, so XeLaTeX can set it at the
 * page bottom. This module models that association as a plain, serializable
 * `FootnoteLink`, which is stored in `StructuralTag.data`.
 *
 * Pure: no side effects, no I/O.
 */
import type { OutputRange } from '@core/model'

export interface FootnoteLink {
  /** Output range of the in-text reference mark (e.g. the superscript digit). */
  refRange: OutputRange
  /** Output range of the pulled-out note text. */
  noteRange: OutputRange
  /** The marker glyph/label tying ref to note (e.g. "1", "*", "†"). */
  marker: string
}

/**
 * Derive a marker from the ref-mark text if the caller didn't supply one. Falls
 * back to the trimmed ref slice; empty → "*".
 */
function deriveMarker(markdown: string, refRange: OutputRange): string {
  const raw = markdown.slice(refRange.start, refRange.end).trim()
  return raw.length > 0 ? raw : '*'
}

export function linkFootnote(params: {
  markdown: string
  refRange: OutputRange
  noteRange: OutputRange
  marker?: string
}): FootnoteLink {
  const { markdown, refRange, noteRange } = params
  const marker =
    params.marker !== undefined && params.marker.length > 0
      ? params.marker
      : deriveMarker(markdown, refRange)
  return {
    refRange: { start: refRange.start, end: refRange.end },
    noteRange: { start: noteRange.start, end: noteRange.end },
    marker
  }
}

/**
 * Serialize a FootnoteLink into the `Record<string, unknown>` shape stored in a
 * footnote StructuralTag's `data`. Kept flat and primitive-friendly so it
 * round-trips through JSON persistence.
 */
export function footnoteTagData(link: FootnoteLink): Record<string, unknown> {
  return {
    marker: link.marker,
    refStart: link.refRange.start,
    refEnd: link.refRange.end,
    noteStart: link.noteRange.start,
    noteEnd: link.noteRange.end
  }
}
