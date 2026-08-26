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
import {
  dispositionFor,
  isNumberLine,
  readSynopsis,
  synopsisKey,
  synopsisLooksSound,
  type PageRole,
  type SynopsisEntry
} from '@core/pages'
import {
  shiftEmphasis,
  tableToText,
  wordCount,
  type BlockKind,
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
  /**
   * A number line set small above this heading: "BOOK ONE" over "THE HUMAN
   * AURA".
   *
   * The book's own openings get this from a *run* of headings — "LESSON I."
   * followed by "THE ASTRAL SENSES." is two lines on the leaf and one opening
   * in the book — and `headingRunEnd` decides which is which by reading the
   * first line. That inference is the only thing available when the words came
   * off paper, and it cannot serve a heading the editor wrote: "BOOK TWO"
   * standing alone before a chapter must *separate* the two books, while "BOOK
   * TWO" over "THE ASTRAL WORLD" is one opening, and no rule can tell those
   * apart from the text. So the editor says which, and this is where it is
   * said.
   */
  label?: string
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
  /**
   * Word indices the note sets in italic, the same convention a block uses.
   *
   * A note names books more often than the text around it does — this edition's
   * own notes name a dozen — and until this existed it was the only kind of
   * block in the book that could not italicise one. A tag typed in hope printed
   * as the tag.
   */
  emphasis?: number[]
  /** Word indices the note sets bold. See `TranscribedBlock.strong`. */
  strong?: number[]
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
  /**
   * The id of the block this heading is, so the contents can match on it.
   *
   * For a chapter opened by more than one heading (see {@link label}) this is
   * the *first* of them, because that is the block the opening starts at.
   */
  id: string
  title: string
  /**
   * The line printed over the title, where the book prints one.
   *
   * A great many books open a chapter with two headings — a number and a name,
   * "LESSON I." over "THE ASTRAL SENSES." — and the reading brings them back as
   * two heading blocks, because on the page that is what they are. Treating
   * them as two chapters is the wrong answer three times over: the contents
   * lists every chapter twice, the running head says "LESSON I." for a page or
   * two before changing its mind, and with chapters opening recto each lesson
   * costs two extra leaves, one carrying a number and nothing else. This book
   * lost forty pages that way.
   *
   * So a run of consecutive headings is one chapter: the last is what the
   * chapter is *called*, and everything before it is the label over it. The
   * title is the last rather than the whole run joined because the title is
   * what the running head shows and what a recovered synopsis is matched on.
   */
  label?: string
  level: number
  /**
   * What the original contents page said this chapter contains.
   *
   * Recovered from the scanned contents, which is otherwise discarded — and
   * discarded for one reason only, that its page numbers describe a pagination
   * this edition does not have. The prose beside those numbers is editorial
   * work that belongs to the book, and in an analytical contents of this kind
   * it is the whole point of the page. Absent when the book had no such
   * contents, or when the parse was not sound enough to trust.
   */
  synopsis?: string
  /**
   * What the original contents called this chapter, when that is not what the
   * chapter head calls it.
   *
   * The regenerated contents takes its titles from the chapter heads, so where
   * a book disagrees with itself the contents' own wording was silently
   * replaced by the head's. *Thought Vibration* lists "Thought-Waves and Their
   * Power of Reproduction" and heads the chapter "Process of Reproduction",
   * both set clearly in 1908, and which the publishers meant is not
   * recoverable; printing one in both places puts a word into the book that is
   * not in it.
   *
   * Set only when the two differ, judged by `synopsisKey`, so a book whose
   * pages agree carries nothing extra.
   */
  contentsTitle?: string
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
  /**
   * A number line set small over the title, as a chapter's is.
   *
   * "BOOK ONE" over "THE HUMAN AURA", not "BOOK ONE — THE HUMAN AURA" run
   * together on one line and left to wrap wherever the measure happens to
   * fall. The book's own chapters already open this way — "LESSON I." over
   * "THE ASTRAL SENSES." — so a division that names itself the same way is set
   * the same way, by the same code, rather than by a second convention.
   */
  label?: string
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
  /**
   * Descriptions read off the original contents that no chapter claimed.
   *
   * The footnote rule applied to the other restoration that can fail. An
   * analytical contents is editorial work — a paragraph per chapter, written by
   * whoever made the book — and matching it to the body is where it can go
   * wrong: the contents of *The Human Aura* calls chapter V "The Aura
   * Kaleidoscope" while the chapter itself is headed "THE AURIC KALEIDOSCOPE",
   * and three descriptions fell on the floor for differences of that kind.
   *
   * Silence there is the worst outcome available: the contents still prints,
   * only plainer, so nothing looks broken and the prose was read and thrown
   * away. Reported, never dropped.
   */
  synopsesUnmatched: { title: string; label: string; synopsis: string }[]
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

/** Blocks whose second half can arrive under another name. See `shouldJoin`. */
const RUNS_ON: readonly BlockKind[] = ['paragraph', 'verse', 'list-item', 'blockquote']

/**
 * True when two blocks should be joined into one. The model's own
 * continues* hints are trusted first; failing that, punctuation is a reliable
 * fallback (a paragraph that ends without terminal punctuation and is followed
 * by lowercase text is almost always one sentence split by the page edge).
 *
 * ## Why a page break relaxes the rules
 *
 * The pass reads one leaf at a time, which is what makes it affordable and is
 * also why the *second half* of something is so often misfiled. A list item
 * broken by the page edge continues on the next leaf with no number in front
 * of it; a quotation continues with no opening quotation mark. Read on its own,
 * that leaf begins with an ordinary paragraph, and the pass is right to say so
 * — it is looking at a paragraph.
 *
 * Requiring the two kinds to match therefore left a sentence in two pieces
 * every time a list or a quotation crossed a leaf, which in one real book was
 * eight broken sentences the reader would meet in print. Across a seam the
 * kinds may differ and the first block's kind wins: a list item that runs on is
 * still a list item.
 *
 * Within a single leaf nothing is relaxed. There a change of kind is a real
 * change — two consecutive list items are two items, and merging them because
 * one happened to end without a full stop would be inventing a paragraph.
 */
export function shouldJoin(
  previous: TranscribedBlock,
  next: TranscribedBlock,
  acrossSeam = false
): boolean {
  const kindsDiffer = previous.kind !== next.kind
  if (acrossSeam) {
    if (!RUNS_ON.includes(previous.kind)) return false
    // The continuation is a paragraph, or the same kind read correctly.
    if (next.kind !== 'paragraph' && next.kind !== previous.kind) return false
    // A block that *opens* a quotation is starting something, not continuing a
    // sentence. This is the one signal that separates the two cases, and
    // without it the relaxation above merges the paragraphs of a long
    // quotation: printing convention opens every one of them with a quotation
    // mark and closes only the last, so the pass marks the whole run as
    // continuing — which is true of the quotation and false of the sentence.
    if (kindsDiffer && /^\s*["“]/.test(next.text)) return false
  } else {
    if (kindsDiffer) return false
    if (previous.kind !== 'paragraph' && previous.kind !== 'verse') return false
  }
  if (previous.continuesNext || next.continuesPrevious) return true

  const prevText = previous.text.trimEnd()
  const nextText = next.text.trimStart()
  if (!prevText || !nextText) return false

  const endsOpen = !/[.!?:;"')\]]\s*$/.test(prevText) || TRAILING_HYPHEN.test(prevText)
  const startsLower = /^[\p{Ll}]/u.test(nextText)
  return endsOpen && startsLower
}

/**
 * The compounds this book sets with a hyphen *mid-line*, as evidence.
 *
 * A block's text is already joined within its leaf, so any `word-word` inside
 * one is a hyphen the compositor set on purpose rather than one he used to
 * break a line. That makes the book its own witness for the only question a
 * page seam raises: was the hyphen the word's, or the wrap's?
 *
 * The seam pair itself can never appear here, because its two halves are on
 * different leaves and therefore in different blocks.
 */
export function hyphenatedCompounds(texts: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const text of texts) {
    for (const m of text.matchAll(/[\p{L}]+-[\p{L}]+/gu)) found.add(m[0]!.toLowerCase())
  }
  return found
}

/**
 * Join two block texts, healing a hyphen split across the page break.
 *
 * `known` is what the book itself spells with a hyphen. Without it every seam
 * hyphen is healed away, which is right for `chirur-` + `geon` and wrong for
 * `thought-` + `habit` — and wrong in the quietest way there is, because the
 * two halves sit on different leaves, so each leaf reads correctly against its
 * own render and no per-page check can ever see the join.
 */
export function joinText(previous: string, next: string, known?: ReadonlySet<string>): string {
  const left = previous.trimEnd()
  const right = next.trimStart()
  if (TRAILING_HYPHEN.test(left)) {
    const stem = left.replace(/[-­]\s*$/, '')
    const stemWord = /[\p{L}]+$/u.exec(stem)?.[0] ?? ''
    const tailWord = /^[\p{L}]+/u.exec(right)?.[0] ?? ''
    if (stemWord && tailWord && known?.has(`${stemWord}-${tailWord}`.toLowerCase())) {
      // The book's own spelling. "thought-" + "habit" is thought-habit, not
      // thoughthabit, and the book says so four times mid-line.
      return `${stem}-${right}`
    }
    // "chirur-" + "geon" → "chirurgeon". The hyphen was line-wrap, not spelling.
    return stem + right
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

  // The book's own hyphenated compounds, gathered before anything is joined —
  // the witness that decides whether a hyphen at a page seam is the word's or
  // the line-wrap's. Built from every leaf, including the ones dispositions
  // will drop, because a compound is a fact about the book's spelling wherever
  // it is set.
  const ownCompounds = hyphenatedCompounds(
    ordered.flatMap((page) => page.blocks.map((b) => b.text))
  )

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
      // Whether the page edge sits between these two, which is the only place
      // the kind rules relax.
      const acrossSeam = previous !== undefined && !previous.sourcePages.includes(page.pageIndex)
      if (joinable && shouldJoin(previous, block, acrossSeam)) {
        // Emphasis is carried as word indices, so the second half's italics have
        // to move along by however many words the first half had — or they land
        // on the wrong words once the two are one paragraph.
        if (block.emphasis?.length) {
          previous.emphasis = [
            ...(previous.emphasis ?? []),
            ...shiftEmphasis(block.emphasis, wordCount(previous.text))
          ]
        }
        if (block.strong?.length) {
          previous.strong = [
            ...(previous.strong ?? []),
            ...shiftEmphasis(block.strong, wordCount(previous.text))
          ]
        }
        previous.text = stripSoftHyphens(joinText(previous.text, block.text, ownCompounds))
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

  const chapters = deriveChapters(blocks)

  // The original contents, read for its prose and matched to the chapters the
  // body actually has. Matched on letters and digits alone, because a contents
  // page and a chapter opening are typeset differently — "MIND-READING, AND
  // BEYOND" against "MIND READING, AND BEYOND." is a difference in hyphenation
  // and a full stop, not in what the chapter is called.
  //
  // Only attached when the parse comes back sound. A ragged one means the page
  // was not laid out the way the reader assumes, and printing a mangled
  // contents under the author's name is worse than printing a plain one.
  //
  // Read a *run* of contents leaves at a time rather than all of them at once.
  // A volume that binds two works has two contents pages, and their folios
  // ascend twice: *The Human Aura* runs 5 to 79 and *The Astral World* starts
  // again at 5. Handed to `synopsisLooksSound` as one sequence that is not
  // ascending, so the whole parse was refused and both books lost the
  // analytical contents that is the one thing worth reading off such a page.
  //
  // Grouping by consecutive leaf keeps each work's contents a single work's
  // contents, so the ascending rule stays exactly as strict as it was. It is
  // the leaves that say where one ends: they are not adjacent.
  const contentsRuns: PageTranscription[][] = []
  for (const page of ordered) {
    if (page.role !== 'table-of-contents') continue
    const run = contentsRuns[contentsRuns.length - 1]
    const last = run?.[run.length - 1]
    if (run && last && page.pageIndex === last.pageIndex + 1) run.push(page)
    else contentsRuns.push([page])
  }
  const synopses = contentsRuns.flatMap((run) => {
    const parsed = readSynopsis(
      run.flatMap((page) => page.blocks.map((b) => ({ kind: b.kind, text: b.text })))
    )
    return synopsisLooksSound(parsed) ? parsed : []
  })
  const synopsesUnmatched: BookDocument['synopsesUnmatched'] = []
  if (synopses.length > 0) {
    const described = synopses.filter((e) => e.synopsis.length > 0)
    const byTitle = new Map(described.map((e) => [synopsisKey(e.title), e]))
    // The chapter *number*, as a second way in. A book can call a chapter two
    // things — *The Human Aura* lists "The Aura Kaleidoscope" in its contents
    // and heads the chapter "THE AURIC KALEIDOSCOPE" — and three of its ten
    // descriptions fell on the floor for differences of that kind. The number
    // is the one name both pages agree on, and matching on it is exact rather
    // than fuzzy: `Chapter V.` and `CHAPTER V.` key the same, and `Chapter IV`
    // does not key to `Chapter V`.
    //
    // Titles first, because a book that repeats a number — a second series
    // starting again at I — would have two entries under it, and a title that
    // matches is unambiguous where a number might not be.
    //
    // Every entry under a label, not one: a volume that binds two works has two
    // Chapter Vs, and a map keyed by label kept only the second. That silently
    // dropped three of *The Human Aura*'s descriptions — the three whose
    // contents wording differs from the chapter's own heading, which are
    // exactly the ones that have no title match to fall back on. Both lists are
    // in document order, so taking the first unclaimed entry gives Book One's
    // Chapter V to Book One.
    const byLabel = new Map<string, SynopsisEntry[]>()
    for (const entry of described) {
      if (!entry.label) continue
      const key = synopsisKey(entry.label)
      byLabel.set(key, [...(byLabel.get(key) ?? []), entry])
    }
    const claimed = new Set<SynopsisEntry>()
    for (const chapter of chapters) {
      const labelled = chapter.label ? (byLabel.get(synopsisKey(chapter.label)) ?? []) : []
      const found = byTitle.get(synopsisKey(chapter.title)) ?? labelled.find((e) => !claimed.has(e))
      if (!found || claimed.has(found)) continue
      chapter.synopsis = found.synopsis
      if (found.title && synopsisKey(found.title) !== synopsisKey(chapter.title)) {
        chapter.contentsTitle = found.title
      }
      claimed.add(found)
    }
    for (const entry of described) {
      if (claimed.has(entry)) continue
      synopsesUnmatched.push({
        title: entry.title,
        label: entry.label,
        synopsis: entry.synopsis
      })
    }
  }

  // A picture on a page that was dropped goes with it: its pixels came from a
  // leaf the user removed, and embedding them would put back the one thing they
  // asked to take out.
  illustrations.sort((a, b) => a.pageIndex - b.pageIndex || a.id.localeCompare(b.id))

  // Nothing the scan contains is a section: they are written, never read.
  return {
    blocks,
    footnotes,
    chapters,
    asides,
    illustrations,
    sections: [],
    skipped,
    synopsesUnmatched
  }
}

/**
 * The chapter list, from whatever the blocks now are.
 *
 * Exported and shared because it is derived *twice*: once when the scan is
 * assembled, and again by `applyEdits` after a correction, since retyping a
 * heading changes what the contents says. Two copies of this rule had already
 * drifted — the second dropped every recovered synopsis on the floor, so an
 * analytical contents was read off the original, matched to the body, and then
 * silently discarded on its way to the page.
 *
 * A run of consecutive headings is one chapter. See {@link ChapterEntry.label}.
 */
/**
 * The last block of the heading run that starts at `from`.
 *
 * One implementation, because there were two and they drifted. The assembler
 * used it to decide what a chapter is; the layout engine had its own copy to
 * decide which headings are set small above a title, and only the first learned
 * that a number line is what holds a run together. The result was a book whose
 * contents listed a division and whose pages set that division as a
 * superscription over the chapter beneath it, silently losing the chapter.
 *
 * A number line (`CHAPTER XI.`, `LESSON III.`) is incomplete on its own and
 * absorbs the heading after it. A complete heading absorbs nothing.
 */
export function headingRunEnd(
  blocks: readonly { kind: string; text: string }[],
  from: number
): number {
  let end = from
  while (
    end + 1 < blocks.length &&
    blocks[end + 1]!.kind === 'heading' &&
    isNumberLine(blocks[end]!.text)
  )
    end++
  return end
}

export function deriveChapters(blocks: readonly BookBlock[]): ChapterEntry[] {
  const chapters: ChapterEntry[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.kind !== 'heading') continue
    const end = headingRunEnd(blocks, i)
    const first = blocks[i]!
    const last = blocks[end]!
    const label =
      last.label?.trim() ||
      blocks
        .slice(i, end)
        .map((b) => b.text.trim())
        .filter((t) => t.length > 0)
        .join(' ')
    chapters.push({
      id: first.id,
      title: last.text.trim(),
      ...(label ? { label } : {}),
      // The shallowest level in the run: a number tagged level 2 over a title
      // tagged level 3 is still the opening of a chapter, and the pass tags
      // these inconsistently or not at all.
      level: Math.min(...blocks.slice(i, end + 1).map((b) => b.level ?? 1)),
      blockIndex: i,
      sourcePage: first.sourcePages[0] ?? 0
    })
    i = end
  }
  return chapters
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
