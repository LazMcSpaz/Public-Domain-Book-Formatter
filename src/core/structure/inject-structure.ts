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
 *   - `footnote`  → the note text is pulled out of the body flow and a Pandoc
 *                   footnote reference (`[^fnN]`) is spliced in at the in-text
 *                   ref mark, with a matching `[^fnN]: …` definition appended;
 *                   Pandoc/XeLaTeX then set it at the page bottom (SPEC §5).
 * Remaining tag types (table/caption/frontmatter) are left to future passes.
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

/** A pre-rendered block to splice into the body at a zero-width point (images). */
export interface BodyInsert {
  /** Char offset in the original markdown to insert at. */
  offset: number
  /** The Markdown/LaTeX block to insert (surrounded by blank lines on splice). */
  block: string
}

/**
 * Internal unified splice op: replace `[start,end)` with `block`.
 * `inline` ops splice without blank-line wrapping (for in-text footnote refs and
 * pulling note text out); `block` ops are set off as their own paragraph.
 */
interface SpliceOp {
  start: number
  end: number
  block: string
  inline?: boolean
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Footnote ops (SPEC §5): for each footnote tag, splice a Pandoc footnote ref
 * `[^fnN]` in place of the in-text mark, delete the note text from the body, and
 * collect a `[^fnN]: …` definition to append. Returns the inline ops plus the
 * definition blocks (appended at end of body). Skips malformed/out-of-range tags.
 */
function footnoteOps(
  markdown: string,
  tags: StructuralTag[]
): { ops: SpliceOp[]; definitions: string[] } {
  const ops: SpliceOp[] = []
  const definitions: string[] = []
  let n = 0
  for (const tag of tags) {
    if (tag.type !== 'footnote') continue
    const d = tag.data ?? {}
    const refStart = num(d['refStart'])
    const refEnd = num(d['refEnd'])
    const noteStart = num(d['noteStart'])
    const noteEnd = num(d['noteEnd'])
    if (refStart === null || refEnd === null || noteStart === null || noteEnd === null) continue
    if (refEnd <= refStart || noteEnd <= noteStart) continue
    if (refEnd > markdown.length || noteEnd > markdown.length || refStart < 0 || noteStart < 0) {
      continue
    }
    // Ref and note must be disjoint (else the splices would collide).
    if (refStart < noteEnd && noteStart < refEnd) continue

    const noteText = markdown.slice(noteStart, noteEnd).replace(/\s+/g, ' ').trim()
    if (!noteText) continue

    const label = `fn${++n}`
    ops.push({ start: refStart, end: refEnd, block: `[^${label}]`, inline: true })
    ops.push({ start: noteStart, end: noteEnd, block: '', inline: true }) // pull note out
    definitions.push(`[^${label}]: ${noteText}`)
  }
  return { ops, definitions }
}

/**
 * Assemble the export body: render structural tags as Markdown blocks, resolve
 * footnotes, and splice in any pre-rendered inserts (e.g. image figures), all
 * against the *original* offsets. Ops are applied end-first so earlier offsets
 * stay valid; a tag/insert that would land inside an already-applied block is
 * dropped. Returns a fresh string — the stored markdown/coordinate map are
 * untouched.
 */
export function assembleBody(
  markdown: string,
  tags: StructuralTag[],
  inserts: BodyInsert[] = []
): string {
  const tagOps: SpliceOp[] = injectable(tags)
    .filter(
      (t) => t.range.start >= 0 && t.range.end <= markdown.length && t.range.end > t.range.start
    )
    .map((t) => ({
      start: t.range.start,
      end: t.range.end,
      block: renderTag(t, markdown.slice(t.range.start, t.range.end)) ?? ''
    }))
    .filter((op) => op.block.length > 0)

  const { ops: fnOps, definitions } = footnoteOps(markdown, tags)

  const insertOps: SpliceOp[] = inserts
    .filter((i) => i.offset >= 0 && i.offset <= markdown.length && i.block.trim().length > 0)
    .map((i) => ({ start: i.offset, end: i.offset, block: i.block }))

  // Footnote definitions are appended after the whole body, as their own blocks.
  const defOps: SpliceOp[] = definitions.map((block) => ({
    start: markdown.length,
    end: markdown.length,
    block
  }))

  // Apply from the end backwards. Ties: process inserts after tags at the same
  // point so an image tucks just past a heading rather than splitting it.
  const ops = [...tagOps, ...fnOps, ...insertOps, ...defOps].sort(
    (a, b) => b.start - a.start || b.end - a.end || a.end - a.start - (b.end - b.start)
  )

  let out = markdown
  let lastStart = out.length // nothing may reach at/after the previous splice point
  for (const op of ops) {
    if (op.end > lastStart) continue // overlaps an already-applied block
    // Inline ops (footnote ref / note deletion) may legitimately be empty and
    // must not gain blank lines; block ops are set off as their own paragraph.
    if (!op.inline && op.block.length === 0) continue
    const before = out.slice(0, op.start)
    const after = out.slice(op.end)
    out = op.inline
      ? `${before}${op.block}${after}`
      : `${before.replace(/\s+$/, '')}\n\n${op.block}\n\n${after.replace(/^\s+/, '')}`
    lastStart = op.start
  }
  return out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
}

/**
 * Return an export copy of `markdown` with structural tags rendered as Markdown
 * blocks. Thin wrapper over {@link assembleBody} with no image inserts.
 */
export function injectStructure(markdown: string, tags: StructuralTag[]): string {
  return assembleBody(markdown, tags)
}
