/**
 * Assemble per-page transcriptions into a single book document.
 *
 * The vision pass sees one page at a time, but a book does not respect page
 * boundaries: paragraphs run across the edge, words break with a hyphen at a
 * line end that happens to be a page end, and footnotes sit at the bottom of
 * the page whose text refers to them. This pass repairs those seams, which is
 * mostly deterministic work that needs no model.
 *
 * It also enforces the front-matter decision: the original title/copyright
 * pages are a *source of metadata* for a new edition, and the scanned TOC and
 * index are discarded because their page numbers refer to the original
 * pagination and would be wrong in ours.
 *
 * Pure: no I/O, no model calls.
 */
import { dispositionFor, type PageRole } from '@core/pages'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

/** A block in the assembled book, with provenance back to its source page. */
export interface BookBlock extends TranscribedBlock {
  /** Pages this block's text came from (more than one when a seam was joined). */
  sourcePages: number[]
}

export interface Footnote {
  /** Sequential id used for the reference mark in the body. */
  id: string
  /** The marker as printed in the original (e.g. "1", "*", "†"). */
  originalMarker: string
  text: string
  /** Page the note was printed on. */
  pageIndex: number
  /** True when no body text referenced this marker. */
  orphaned: boolean
}

export interface ChapterEntry {
  title: string
  level: number
  /** Index into `blocks` where the chapter starts. */
  blockIndex: number
  sourcePage: number
}

export interface BookDocument {
  /** Body blocks in reading order, seams repaired. */
  blocks: BookBlock[]
  /** Notes pulled out of the page flow, in order of first reference. */
  footnotes: Footnote[]
  /** Chapters, for the regenerated table of contents. */
  chapters: ChapterEntry[]
  /** Content set apart from the main flow (dedication, epigraph, colophon). */
  asides: BookBlock[]
  /** Pages deliberately not transcribed, and why. */
  skipped: { pageIndex: number; role: PageRole; reason: string }[]
}

/** A hyphen at the end of a block that continues — a word split by the page break. */
const TRAILING_HYPHEN = /(\p{L})[-\u00AD]\s*$/u

/**
 * Soft hyphens (U+00AD) are invisible line-break hints. OCR and scans emit them
 * inside words, where they survive into the output invisibly, break text search,
 * and can produce odd breaks at typeset time. Strip any that aren't doing the
 * page-seam job handled by `joinText`.
 */
export function stripSoftHyphens(text: string): string {
  return text.replace(/\u00AD/gu, '')
}

/**
 * True when two blocks should be joined into one. The model's own
 * continues* hints are trusted first; failing that, punctuation is a reliable
 * fallback (a paragraph that ends without terminal punctuation and is followed
 * by lowercase text is almost always one sentence split by the page edge).
 */
export function shouldJoin(previous: TranscribedBlock, next: TranscribedBlock): boolean {
  if (previous.kind !== next.kind) return false
  if (previous.kind !== 'paragraph' && previous.kind !== 'verse') return false
  if (previous.continuesNext || next.continuesPrevious) return true

  const prevText = previous.text.trimEnd()
  const nextText = next.text.trimStart()
  if (!prevText || !nextText) return false

  const endsOpen = !/[.!?:;"')\]]\s*$/.test(prevText) || TRAILING_HYPHEN.test(prevText)
  const startsLower = /^[\p{Ll}]/u.test(nextText)
  return endsOpen && startsLower
}

/** Join two block texts, healing a hyphen split across the page break. */
export function joinText(previous: string, next: string): string {
  const left = previous.trimEnd()
  const right = next.trimStart()
  if (TRAILING_HYPHEN.test(left)) {
    // "chirur-" + "geon" → "chirurgeon". The hyphen was line-wrap, not spelling.
    return left.replace(/[-­]\s*$/, '') + right
  }
  return `${left} ${right}`
}

interface AssembleOptions {
  /** Drop pages whose role says they are regenerated or empty. Default true. */
  applyDispositions?: boolean
}

export function assembleBook(
  transcriptions: readonly PageTranscription[],
  options: AssembleOptions = {}
): BookDocument {
  const applyDispositions = options.applyDispositions ?? true

  const blocks: BookBlock[] = []
  const asides: BookBlock[] = []
  const footnotes: Footnote[] = []
  const skipped: BookDocument['skipped'] = []

  const ordered = [...transcriptions].sort((a, b) => a.pageIndex - b.pageIndex)

  for (const page of ordered) {
    const disposition = applyDispositions ? dispositionFor(page.role) : 'transcribe'

    if (disposition === 'discard' || disposition === 'extract-metadata') {
      skipped.push({
        pageIndex: page.pageIndex,
        role: page.role,
        reason:
          disposition === 'extract-metadata'
            ? 'Used for book details; replaced by your own front matter.'
            : 'Regenerated for this edition, or blank.'
      })
      continue
    }

    const target = disposition === 'transcribe-aside' ? asides : blocks

    for (const block of page.blocks) {
      // Footnotes leave the body flow entirely and are re-attached at typeset time.
      if (block.kind === 'footnote') {
        footnotes.push({
          id: `fn${footnotes.length + 1}`,
          originalMarker: block.marker ?? '*',
          text: stripSoftHyphens(block.text.trim()),
          pageIndex: page.pageIndex,
          orphaned: false
        })
        continue
      }

      const previous = target[target.length - 1]
      if (previous && shouldJoin(previous, block)) {
        previous.text = stripSoftHyphens(joinText(previous.text, block.text))
        if (!previous.sourcePages.includes(page.pageIndex)) {
          previous.sourcePages.push(page.pageIndex)
        }
        previous.continuesNext = block.continuesNext
        continue
      }

      target.push({
        ...block,
        text: stripSoftHyphens(block.text),
        sourcePages: [page.pageIndex]
      })
    }
  }

  markOrphanFootnotes(blocks, footnotes)

  const chapters: ChapterEntry[] = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'heading')
    .map(({ b, i }) => ({
      title: b.text.trim(),
      level: b.level ?? 1,
      blockIndex: i,
      sourcePage: b.sourcePages[0] ?? 0
    }))

  return { blocks, footnotes, chapters, asides, skipped }
}

/**
 * A note whose marker never appears in the body can't be re-linked. Flagged
 * rather than dropped — losing a footnote silently is worse than showing one
 * that needs a human to place it.
 */
function markOrphanFootnotes(blocks: readonly BookBlock[], footnotes: Footnote[]): void {
  const bodyText = blocks.map((b) => b.text).join(' ')
  for (const note of footnotes) {
    const marker = note.originalMarker.trim()
    if (!marker) {
      note.orphaned = true
      continue
    }
    // Digit markers are matched as standalone tokens so "1" doesn't match "1662".
    const pattern = /^\d+$/.test(marker)
      ? new RegExp(`(?<!\\d)${marker}(?!\\d)`)
      : new RegExp(escapeRegExp(marker))
    note.orphaned = !pattern.test(bodyText)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word count of the assembled body — a sanity figure for the review gate. */
export function bookWordCount(doc: BookDocument): number {
  return doc.blocks.reduce((n, b) => n + b.text.split(/\s+/).filter((w) => w.length > 0).length, 0)
}

/** How many seams were healed — reported so the join logic isn't invisible. */
export function seamCount(doc: BookDocument): number {
  return doc.blocks.filter((b) => b.sourcePages.length > 1).length
}
