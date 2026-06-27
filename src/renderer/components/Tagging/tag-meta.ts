/**
 * Shared presentation metadata for the structural tag types (SPEC §5).
 * Centralizes the per-type label, color, and a short badge glyph so the context
 * menu, structure panel, and output-pane decorations all agree.
 */
import type { StructuralTagType } from '@core/model'

export interface TagMeta {
  type: StructuralTagType
  label: string
  /** Short badge text shown at a tag's start in the output pane. */
  badge: string
  /** Accent color used for the underline / left-border / badge background. */
  color: string
}

export const TAG_META: Record<StructuralTagType, TagMeta> = {
  footnote: { type: 'footnote', label: 'Footnote', badge: 'fn', color: '#b5651d' },
  blockquote: { type: 'blockquote', label: 'Block quote', badge: 'bq', color: '#3b7a9b' },
  verse: { type: 'verse', label: 'Verse / poetry', badge: 'v', color: '#6a4c93' },
  heading: { type: 'heading', label: 'Chapter heading', badge: 'h', color: '#2e7d32' },
  table: { type: 'table', label: 'Table', badge: 'tb', color: '#8d6e63' },
  epigraph: { type: 'epigraph', label: 'Epigraph', badge: 'ep', color: '#ad1457' },
  caption: { type: 'caption', label: 'Caption', badge: 'cap', color: '#00838f' },
  frontmatter: { type: 'frontmatter', label: 'Front-matter element', badge: 'fm', color: '#5d737e' }
}

/** All tag types in the order shown in menus / panels. */
export const TAG_TYPES: StructuralTagType[] = [
  'heading',
  'footnote',
  'blockquote',
  'verse',
  'epigraph',
  'caption',
  'table',
  'frontmatter'
]

/** Stable id helper: prefers crypto.randomUUID, falls back to time+rand. */
export function newTagId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
