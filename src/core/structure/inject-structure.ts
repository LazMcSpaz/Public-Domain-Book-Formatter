/**
 * Structural markup injection for export (SPEC §5/§7).
 *
 * The review markdown is the plain cleaned text; the structure the user
 * confirmed/tagged lives *alongside* it as `StructuralTag` ranges, not as markup
 * inside the text. Pandoc/XeLaTeX only see the text, so without this step the
 * exported PDF has no chapters, no table of contents, no block quotes or verse —
 * the book is one undifferentiated blob.
 *
 * This pass produces an export-only copy of the markdown with the structure
 * rendered as Markdown so Pandoc turns it into real LaTeX:
 *   - `heading`   → ATX heading (`#` × level; with `--top-level-division=chapter`
 *                   level 1 becomes `\chapter`). Only *confirmed* headings count
 *                   (they are auto-detected; the user vets them).
 *   - `blockquote`/`epigraph` → Markdown blockquote (`>` lines → `quote`).
 *   - `verse`     → Markdown line block (`|` lines → line-broken poetry).
 * Other tag types (footnote/table/caption/frontmatter) are left to future passes.
 *
 * It never touches the stored project markdown or the coordinate map — it's a
 * fresh string built for typesetting.
 */
import type { StructuralTag, StructuralTagType } from '@core/model'

/** Structural tag types this pass knows how to render, and how to gate them. */
const BLOCK_TYPES: ReadonlySet<StructuralTagType> = new Set([
  'heading',
  'blockquote',
  'epigraph',
  'verse'
])

/** A confirmed heading tag carries `data.confirmed === true`. */
export function confirmedHeadings(tags: StructuralTag[]): StructuralTag[] {
  return tags.filter((t) => t.type === 'heading' && t.data?.['confirmed'] === true)
}

/**
 * Tags eligible for injection: confirmed headings (auto-detected → vetted) plus
 * every explicitly user-created block tag (which needs no confirmation).
 */
function injectable(tags: StructuralTag[]): StructuralTag[] {
  return tags.filter((t) => {
    if (!BLOCK_TYPES.has(t.type)) return false
    if (t.type === 'heading') return t.data?.['confirmed'] === true
    return true
  })
}

function headingLevel(tag: StructuralTag): number {
  const raw = tag.data?.['level']
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.min(6, Math.floor(raw))
  }
  return 1
}

/** Collapse to a single clean line (headings). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Non-empty, trimmed lines of a covered block (quotes/verse). */
function blockLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** Render one tag's covered text as a Markdown block, or null to skip. */
function renderTag(tag: StructuralTag, covered: string): string | null {
  switch (tag.type) {
    case 'heading': {
      const text = oneLine(covered)
      return text ? `${'#'.repeat(headingLevel(tag))} ${text}` : null
    }
    case 'blockquote':
    case 'epigraph': {
      const lines = blockLines(covered)
      return lines.length ? lines.map((l) => `> ${l}`).join('\n') : null
    }
    case 'verse': {
      const lines = blockLines(covered)
      // Markdown line block: each line prefixed with "| " preserves line breaks.
      return lines.length ? lines.map((l) => `| ${l}`).join('\n') : null
    }
    default:
      return null
  }
}

/**
 * Return an export copy of `markdown` with structural tags rendered as Markdown
 * blocks. Tags are applied from the end backwards so each splice leaves earlier
 * offsets valid; overlapping tags are dropped (the later-starting one wins) so a
 * splice never lands inside an already-rewritten block. Out-of-range/empty tags
 * are skipped.
 */
export function injectStructure(markdown: string, tags: StructuralTag[]): string {
  const ordered = injectable(tags)
    .filter(
      (t) => t.range.start >= 0 && t.range.end <= markdown.length && t.range.end > t.range.start
    )
    .sort((a, b) => b.range.start - a.range.start) // descending by start

  let out = markdown
  let lastStart = out.length // no tag may reach at/after the previous splice point
  for (const tag of ordered) {
    if (tag.range.end > lastStart) continue // overlaps an already-applied tag
    const block = renderTag(tag, out.slice(tag.range.start, tag.range.end))
    if (!block) continue
    const before = out.slice(0, tag.range.start).replace(/\s+$/, '')
    const after = out.slice(tag.range.end).replace(/^\s+/, '')
    // Blank lines around the block so Pandoc parses it standalone.
    out = `${before}\n\n${block}\n\n${after}`
    lastStart = tag.range.start
  }
  return out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
}
