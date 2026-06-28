/**
 * Auto-generated table of contents (SPEC §7).
 *
 * Built from confirmed `heading` StructuralTags in document order. The original
 * scanned TOC (with wrong page numbers) is discarded; this rebuilds from the
 * structure the user confirmed. `pageNumber` is null here — the real *edition*
 * page number is only known after typesetting (Phase 4), so it is filled in then.
 *
 * Pure: derives entirely from its inputs.
 */
import type { StructuralTag, TocEntry } from '@core/model'

function levelFromData(data: StructuralTag['data']): number {
  const raw = data?.['level']
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw)
  }
  return 1
}

export function buildToc(tags: StructuralTag[], markdown: string): TocEntry[] {
  return tags
    .filter((t) => t.type === 'heading')
    .slice()
    .sort((a, b) => a.range.start - b.range.start)
    .map((tag) => {
      const title = markdown.slice(tag.range.start, tag.range.end).trim().replace(/\s+/g, ' ')
      return {
        title,
        level: levelFromData(tag.data),
        outputOffset: tag.range.start,
        pageNumber: null
      }
    })
}
