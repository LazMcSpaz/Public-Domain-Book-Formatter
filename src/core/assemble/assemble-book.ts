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
import type { ImageEditOp } from '@core/model'
import { dispositionFor, type PageRole } from '@core/pages'
import {
  shiftEmphasis,
  tableToText,
  wordCount,
  type PageTranscription,
  type TranscribedBlock
} from '@core/transcribe'

/** A block in the assembled book, with provenance back to its source page. */
export interface BookBlock extends TranscribedBlock {
  /**
   * Stable identity, so a correction can name what it corrects.
   *
   * Derived from the *transcribed* block that started this one —
   * `p{pageIndex}b{blockIndex}` — rather than from its position in the output.
   * That distinction is the whole point: the output is re-derived whenever the
   * user removes a page or accepts a different set of illustrations, and an id
   * counted off the output would slide out from under every edit already made.
   * The input never moves; it is the thing that was paid for.
   *
   * A block joined across a page seam keeps the id of its first half, because
   * that is where it begins to be this paragraph.
   */
  id: string
  /** Pages this block's text came from (more than one when a seam was joined). */
  sourcePages: number[]
}

export interface Footnote {
  /** Sequential id used for the reference mark in the body. */
  id: string
  /**
   * The marker as printed in the original (e.g. "1", "*", "†").
   *
   * Empty for a note nobody printed — one the *editor* wrote. Such a note is
   * found by its `anchor` instead, which is why an empty marker is a legitimate
   * value here rather than a missing one.
   */
  originalMarker: string
  text: string
  /** Page the note was printed on. */
  pageIndex: number
  /** True when no body text referenced this marker. */
  orphaned: boolean
  /**
   * Where the editor put this note, for one they wrote themselves.
   *
   * A scanned note is located by finding its printed marker in the text. A new
   * one has no printed marker to find, so it carries its position directly:
   * `at` is a character offset into the block's text, and the note attaches to
   * the word before it, exactly as a printed marker would.
   *
   * Deliberately *not* done by inserting a marker character into the text. That
   * would work — the note would then be indistinguishable from a scanned one —
   * but the marker would show up in the proof sheet's edit box, where it reads
   * as a typo and one backspace would silently orphan the note.
   */
  anchor?: { blockId: string; at: number }
}

export interface ChapterEntry {
  /** The id of the block this heading is, so the contents can match on it. */
  id: string
  title: string
  level: number
  /** Index into `blocks` where the chapter starts. */
  blockIndex: number
  sourcePage: number
}

/**
 * A region of a source page that the user confirmed is an illustration.
 *
 * This is what the *platform* hands in: it has already cropped the pixels, so
 * the size here is the size of the crop that will be embedded, not of the
 * region on the scan. That distinction is the whole point — the DPI check
 * divides these pixels by the printed inches, and dividing by anything else
 * would report a resolution the book does not have.
 */
export interface IllustrationSource {
  id: string
  /** Source page the pixels were cropped from. */
  pageIndex: number
  sourceWidth: number
  sourceHeight: number
}

/**
 * Where a picture came from.
 *
 * `scan` was cut out of the book being reprinted, and knows which leaf it was
 * printed on — which is what lets the engine place it without being told.
 * `supplied` is the editor's own, has no leaf, and so must be told.
 */
export type IllustrationOrigin = 'scan' | 'supplied'

/** An illustration in the assembled book, with the caption it was printed under. */
export interface Illustration extends IllustrationSource {
  /**
   * The caption as the original printed it, or null. Taken out of the body
   * flow: a caption typeset as an ordinary paragraph, several pages from the
   * picture it describes, is worse than no caption at all.
   */
  caption: string | null
  /**
   * The block this picture should follow, when the user has said where it goes.
   *
   * Absent means "wherever the engine decides", which is after the last text
   * that shared the picture's page — the most the scan itself can tell us. A
   * null value means the very front of the body, which is a real answer and so
   * has to be distinguishable from not having answered.
   */
  anchorAfterBlockId?: string | null
  /** Defaults to `scan`. A supplied picture has no source leaf to fall back on. */
  origin?: IllustrationOrigin
  /**
   * Retouching to apply over the original pixels before embedding — crop,
   * straighten, levels and the rest of SPEC §6.
   *
   * Never applied to the stored pixels, only carried beside them, so the
   * original survives every edit and any of them can be undone. `sourceWidth`
   * and `sourceHeight` already account for the ops that change the size,
   * because the DPI check divides by them.
   */
  edits?: ImageEditOp[]
}

/**
 * Something the *editor* wrote that is a division of the book, not a paragraph
 * of it — an introduction, a translator's note, an afterword, an appendix.
 *
 * A section is not a block and cannot be modelled as one. It flows over as many
 * pages as it needs, it carries its own title in the contents, and where it sits
 * decides how it is numbered: front matter is roman and comes before the body,
 * back matter is arabic and continues after it.
 *
 * This is the third thing the app can *add* to a book rather than recover from
 * one, and the only one long enough to be the differentiating content a
 * public-domain reprint needs.
 */
export interface BookSection {
  id: string
  placement: 'front' | 'back'
  title: string
  blocks: BookBlock[]
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
  /** Confirmed illustrations, in source-page order, with their captions. */
  illustrations: Illustration[]
  /** Divisions the editor wrote: an introduction, an afterword, an appendix. */
  sections: BookSection[]
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
 * A block with the scan's artefacts off it, structure included.
 *
 * A table's cells carry the same soft hyphens its text does, and cleaning only
 * the text would leave the two describing different tables \u2014 which is precisely
 * the drift `normalizeTable` exists to prevent, so the cells are cleaned and
 * the text re-derived from them rather than the other way round.
 */
function cleaned(block: BookBlock): BookBlock {
  if (block.kind !== 'table' || !block.cells) return block
  const cells = block.cells.map((row) => row.map(stripSoftHyphens))
  return { ...block, cells, text: tableToText(cells) }
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
  /**
   * Pages the *user* chose to leave out at the review gate. Recorded in
   * `skipped` rather than silently dropped, so the export screen can still
   * account for every page of the scan.
   */
  excludePages?: readonly number[]
  /**
   * Illustrations the user confirmed at the structure gate, already cropped.
   *
   * They arrive here rather than being discovered here because finding them is
   * pixel work: `detectRegions` reads the OCR word boxes, which is deliberately
   * a *different* witness from the model that read the text.
   */
  illustrations?: readonly IllustrationSource[]
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

  const excluded = new Set(options.excludePages ?? [])

  // Illustrations grouped by the page they were cropped from, so a caption can
  // be matched to a picture while that page is being walked.
  const byPage = new Map<number, IllustrationSource[]>()
  for (const source of options.illustrations ?? []) {
    const list = byPage.get(source.pageIndex) ?? []
    list.push(source)
    byPage.set(source.pageIndex, list)
  }
  const illustrations: Illustration[] = []
  // Set when real text has been dropped between two pages, so the first block
  // of the next page is not stitched onto the last block of the previous one.
  let seamBroken = false

  for (const page of ordered) {
    if (excluded.has(page.pageIndex)) {
      skipped.push({
        pageIndex: page.pageIndex,
        role: page.role,
        reason: 'you chose to leave this page out'
      })
      // Real text is being dropped here, so joining the pages either side of
      // the gap would splice together two halves of a sentence that never met —
      // a fabrication, and an invisible one. Clearing the flags is not enough:
      // `shouldJoin` fires on *either* side's continuation flag, and the next
      // page still carries `continuesPrevious`.
      //
      // This is deliberately not done for a page dropped by its disposition: a
      // plate or a blank carries no body text, so the paragraph genuinely does
      // run across it.
      const last = blocks[blocks.length - 1]
      if (last) last.continuesNext = false
      seamBroken = true
      continue
    }

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

    // Captions are consumed by the pictures on this page, in the order both
    // appear. A page with more captions than pictures leaves the extras in the
    // flow, where they read as short paragraphs — wrong, but visible, which
    // beats deleting a line of the book on a guess.
    const pictures = byPage.get(page.pageIndex) ?? []
    let nextPicture = 0

    for (const [blockIndex, block] of page.blocks.entries()) {
      if (block.kind === 'caption' && nextPicture < pictures.length) {
        const picture = pictures[nextPicture++]!
        illustrations.push({ ...picture, caption: stripSoftHyphens(block.text.trim()) })
        continue
      }

      // Footnotes leave the body flow entirely and are re-attached at typeset time.
      if (block.kind === 'footnote') {
        const marker = block.marker ?? '*'
        footnotes.push({
          id: `fn${footnotes.length + 1}`,
          originalMarker: marker,
          text: stripLeadingMarker(stripSoftHyphens(block.text.trim()), marker),
          pageIndex: page.pageIndex,
          orphaned: false
        })
        continue
      }

      const previous = target[target.length - 1]
      const joinable = previous !== undefined && !seamBroken
      seamBroken = false
      if (joinable && shouldJoin(previous, block)) {
        // Emphasis is carried as word indices, so the second half's italics have
        // to move along by however many words the first half had — or they land
        // on the wrong words once the two are one paragraph.
        if (block.emphasis?.length) {
          previous.emphasis = [
            ...(previous.emphasis ?? []),
            ...shiftEmphasis(block.emphasis, wordCount(previous.text))
          ]
        }
        previous.text = stripSoftHyphens(joinText(previous.text, block.text))
        if (!previous.sourcePages.includes(page.pageIndex)) {
          previous.sourcePages.push(page.pageIndex)
        }
        previous.continuesNext = block.continuesNext
        continue
      }

      target.push(
        cleaned({
          ...block,
          id: `p${page.pageIndex}b${blockIndex}`,
          text: stripSoftHyphens(block.text),
          sourcePages: [page.pageIndex]
        })
      )
    }

    // Pictures this page never printed a caption for. Uncaptioned is normal in
    // old books — plates often carry nothing but the plate.
    for (let n = nextPicture; n < pictures.length; n++) {
      illustrations.push({ ...pictures[n]!, caption: null })
    }
  }

  markOrphanFootnotes(blocks, footnotes)

  const chapters: ChapterEntry[] = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'heading')
    .map(({ b, i }) => ({
      id: b.id,
      title: b.text.trim(),
      level: b.level ?? 1,
      blockIndex: i,
      sourcePage: b.sourcePages[0] ?? 0
    }))

  // A picture on a page that was dropped goes with it: its pixels came from a
  // leaf the user removed, and embedding them would put back the one thing they
  // asked to take out.
  illustrations.sort((a, b) => a.pageIndex - b.pageIndex || a.id.localeCompare(b.id))

  // Nothing the scan contains is a section: they are written, never read.
  return { blocks, footnotes, chapters, asides, illustrations, sections: [], skipped }
}

/**
 * A note whose marker never appears in the body can't be re-linked. Flagged
 * rather than dropped — losing a footnote silently is worse than showing one
 * that needs a human to place it.
 */
function markOrphanFootnotes(blocks: readonly BookBlock[], footnotes: Footnote[]): void {
  const bodyText = blocks.map((b) => b.text).join(' ')
  for (const note of footnotes) {
    const pattern = footnoteMarkerPattern(note.originalMarker)
    note.orphaned = pattern === null || !pattern.test(bodyText)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Drop a note's own marker from the front of its text.
 *
 * The printed page repeats the marker at the head of the note ("1. See Croll,
 * lib. ii.") — and the model transcribes what it sees, inconsistently. LaTeX's
 * `\footnote` prints its own marker, so leaving it in yields a doubled "¹1.".
 * Fixing this deterministically is right: it is a transcription that is
 * *accurate*, just not what the new edition needs.
 *
 * The marker must be followed by punctuation or whitespace, so "1662 was the
 * year" is never mistaken for a marker plus text.
 */
export function stripLeadingMarker(text: string, marker: string): string {
  const trimmed = text.trim()
  const m = marker.trim()
  if (!m) return trimmed

  const forms = /^\d+$/.test(m) ? [m, toSuperscript(m)] : [m]
  for (const form of forms) {
    const rest = trimmed.replace(new RegExp(`^${escapeRegExp(form)}(?:[.)\\]:]\\s*|\\s+)`), '')
    // Never strip the note down to nothing — a note that is only its marker is
    // already broken, and emptying it would hide that.
    if (rest !== trimmed && rest.length > 0) return rest
  }
  return trimmed
}

/**
 * Superscript forms of 0-9. Note ¹²³ come from Latin-1 and the rest from the
 * U+2070 block, so this cannot be written as a range.
 */
const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const SUPERSCRIPT_CLASS = `[${SUPERSCRIPT_DIGITS.join('')}]`

function toSuperscript(digits: string): string {
  return [...digits].map((d) => SUPERSCRIPT_DIGITS[Number(d)]!).join('')
}

/**
 * Where a footnote's printed marker appears in body text — the single source of
 * truth for both orphan detection and footnote attachment, which have to agree
 * or a note gets flagged as unplaceable and then silently placed anyway.
 *
 * Two things make this less trivial than an indexOf:
 *
 * 1. A bare digit marker must not match inside a numeral — "1" is not the
 *    reference mark in "printed in 1662".
 * 2. The reference mark in the text is usually *superscript* ("grosse.¹") while
 *    the marker is reported as a plain digit. Matching only the plain form
 *    orphans essentially every numbered footnote in a real book.
 *
 * Returns null for an empty marker, which can never be located.
 */
export function footnoteMarkerPattern(marker: string): RegExp | null {
  const trimmed = marker.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return new RegExp(escapeRegExp(trimmed))

  const superscript = toSuperscript(trimmed)
  return new RegExp(
    `(?<!\\d)${trimmed}(?!\\d)` + `|(?<!${SUPERSCRIPT_CLASS})${superscript}(?!${SUPERSCRIPT_CLASS})`
  )
}

/** Word count of the assembled body — a sanity figure for the review gate. */
export function bookWordCount(doc: BookDocument): number {
  return doc.blocks.reduce((n, b) => n + b.text.split(/\s+/).filter((w) => w.length > 0).length, 0)
}

/** How many seams were healed — reported so the join logic isn't invisible. */
export function seamCount(doc: BookDocument): number {
  return doc.blocks.filter((b) => b.sourcePages.length > 1).length
}
