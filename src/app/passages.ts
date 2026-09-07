/**
 * The book as one column, built once for both surfaces that show it.
 *
 * The galley edits this column and the reading view marks it, and they must be
 * the *same* column: a highlight names a block id and an offset into that
 * block's text, so a reader that assembled its own list of passages could put a
 * mark on a paragraph the editor never touched, and no check downstream would
 * see anything wrong. One builder, therefore, exactly as `deriveChapters`
 * became one after `applyEdits` was found keeping a second copy of the rule.
 */
import { withMarkup } from '@core/transcribe'
import type { BlockKind } from '@core/transcribe'
import type { BookDocument } from '@core/assemble'
import type { BookEdit } from '@core/edits'

/**
 * One unit of the column.
 *
 * A body passage is a real block and edits target its id. A section passage is
 * one paragraph of a division the editor wrote: its block exists only in the
 * assembled document, so editing it rewrites the owning `section` edit's text
 * at that paragraph's index instead.
 */
export interface Passage {
  id: string
  kind: BlockKind
  /** Current text, markup on — the string an edit must be written in terms of. */
  text: string
  label?: string
  level?: number
  origin: { type: 'body' } | { type: 'section'; sectionId: string; index: number }
}

/**
 * The whole book in reading order: divisions set before the body, the body,
 * divisions after — the order a reader meets them in, and the order the memo
 * and highlight sheets are sorted into.
 */
export function passagesOf(doc: BookDocument, edits: readonly BookEdit[]): Passage[] {
  const ofSection = (placement: 'front' | 'back'): Passage[] =>
    doc.sections
      .filter((s) => s.placement === placement)
      .flatMap((s) =>
        s.blocks.map((b, index) => ({
          id: b.id,
          kind: b.kind,
          text: withMarkup(b.text, b.emphasis, b.strong),
          origin: { type: 'section' as const, sectionId: s.id, index }
        }))
      )
  // A division with nothing written yet has no blocks in the document — the
  // engine refuses to set an empty one — so a freshly added introduction would
  // be invisible here, with nowhere to type its first word. It gets a
  // placeholder passage, sourced from its own record.
  const inDoc = new Set(doc.sections.map((s) => s.id))
  const placeholders = (placement: 'front' | 'back'): Passage[] =>
    edits
      .filter(
        (e): e is BookEdit & { kind: 'section' } =>
          e.kind === 'section' && e.placement === placement && !inDoc.has(e.sectionId)
      )
      .map((e) => ({
        id: `${e.sectionId}/b0`,
        kind: 'paragraph' as const,
        text: '',
        origin: { type: 'section' as const, sectionId: e.sectionId, index: 0 }
      }))
  const body: Passage[] = doc.blocks.map((b) => ({
    id: b.id,
    kind: b.kind,
    text: withMarkup(b.text, b.emphasis, b.strong),
    ...(b.label ? { label: b.label } : {}),
    ...(b.level !== undefined ? { level: b.level } : {}),
    origin: { type: 'body' as const }
  }))
  return [
    ...ofSection('front'),
    ...placeholders('front'),
    ...body,
    ...ofSection('back'),
    ...placeholders('back')
  ]
}

/** One entry in the outline: a division, or a chapter of the body. */
export interface OutlineEntry {
  id: string
  label: string
  kind: 'division' | 'chapter'
}

/**
 * The outline, for a column that is otherwise one long scroll: divisions set
 * before the body, the chapters, divisions after — the same list the contents
 * page is built from, so it cannot disagree with the book.
 */
export function outlineOf(doc: BookDocument): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const s of doc.sections.filter((x) => x.placement === 'front')) {
    const first = s.blocks[0]
    if (first) entries.push({ id: first.id, label: s.title, kind: 'division' })
  }
  for (const c of doc.chapters) {
    entries.push({
      id: c.id,
      label: c.label ? `${c.label} · ${c.title}` : c.title,
      kind: 'chapter'
    })
  }
  for (const s of doc.sections.filter((x) => x.placement === 'back')) {
    const first = s.blocks[0]
    if (first) entries.push({ id: first.id, label: s.title, kind: 'division' })
  }
  return entries
}

/**
 * The first passage of each division, which carries its title on the page.
 *
 * Keyed by passage id so the column can put a heading above the right one
 * without a second pass over the document.
 */
export function sectionTitlesOf(
  doc: BookDocument,
  edits: readonly BookEdit[]
): Map<string, { sectionId: string; title: string }> {
  const out = new Map<string, { sectionId: string; title: string }>()
  for (const section of doc.sections) {
    const first = section.blocks[0]
    if (first) out.set(first.id, { sectionId: section.id, title: section.title })
  }
  // A division with nothing written yet is a placeholder passage, and it needs
  // its title most of all: it is otherwise an empty line with no way to tell
  // which of two freshly added divisions it is.
  const inDoc = new Set(doc.sections.map((s) => s.id))
  for (const e of edits) {
    if (e.kind !== 'section' || inDoc.has(e.sectionId)) continue
    out.set(`${e.sectionId}/b0`, { sectionId: e.sectionId, title: e.title })
  }
  return out
}
