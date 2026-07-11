/**
 * Structural markup injection for export (SPEC §5/§7).
 *
 * The review markdown is the plain cleaned text; the structure the user
 * confirmed lives *alongside* it as `StructuralTag` ranges, not as markup inside
 * the text. Pandoc/XeLaTeX only see the text, so without this step the exported
 * PDF has no chapters, no table of contents, and empty running heads — the book
 * is one undifferentiated blob.
 *
 * This pass produces an export-only copy of the markdown with the confirmed
 * structure rendered as Markdown so Pandoc turns it into real LaTeX: confirmed
 * `heading` tags become ATX headings (`#` × level, so `--top-level-division=
 * chapter` maps level 1 → `\chapter`). It never touches the stored project
 * markdown or the coordinate map — it's a fresh string built for typesetting.
 */
import type { StructuralTag } from '@core/model'

/** A confirmed heading tag carries `data.confirmed === true`. */
export function confirmedHeadings(tags: StructuralTag[]): StructuralTag[] {
  return tags.filter((t) => t.type === 'heading' && t.data?.['confirmed'] === true)
}

function headingLevel(tag: StructuralTag): number {
  const raw = tag.data?.['level']
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.min(6, Math.floor(raw))
  }
  return 1
}

/** Collapse a heading's covered text to a single clean line. */
function headingText(markdown: string, tag: StructuralTag): string {
  return markdown.slice(tag.range.start, tag.range.end).replace(/\s+/g, ' ').trim()
}

/**
 * Return an export copy of `markdown` with confirmed heading tags rendered as
 * ATX Markdown headings. Tags are applied from the end backwards so each splice
 * leaves earlier offsets valid. Empty/whitespace headings and out-of-range tags
 * are skipped.
 */
export function injectStructure(markdown: string, tags: StructuralTag[]): string {
  const headings = confirmedHeadings(tags)
    .filter(
      (t) => t.range.start >= 0 && t.range.end <= markdown.length && t.range.end > t.range.start
    )
    .sort((a, b) => b.range.start - a.range.start) // descending

  let out = markdown
  for (const tag of headings) {
    const text = headingText(out, tag)
    if (!text) continue
    const marker = '#'.repeat(headingLevel(tag))
    const before = out.slice(0, tag.range.start)
    const after = out.slice(tag.range.end)
    // Blank lines around the heading so Pandoc parses it as its own block, not
    // part of a surrounding paragraph.
    out = `${before.replace(/\s+$/, '')}\n\n${marker} ${text}\n\n${after.replace(/^\s+/, '')}`
  }
  return out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
}
