/**
 * A chapter turned into the thing a voice is handed.
 *
 * Pure, and deliberately upstream of anything that makes a sound: what gets
 * read, in what order, with what silence between, is a question about the book
 * rather than about synthesis, and keeping it here means it can be looked at
 * and tested without two hundred megabytes of model.
 *
 * ## What it refuses to do quietly
 *
 * A block this cannot read is **reported, never dropped**. That is the footnote
 * rule (`notesDropped`, `imagesDropped`) applied to the one output where a gap
 * is hardest to notice: a reader skimming a page sees a missing paragraph, and
 * a listener three hundred pages in has no idea that anything was there. So
 * every block in a chapter either becomes a piece of the script or appears in
 * `unread` with a reason, and nothing is allowed to fall between.
 *
 * ## Silence is part of the text
 *
 * Prose read with no pauses is unlistenable, and pauses are not decoration —
 * they are how a heading is heard as a heading and a paragraph break as a
 * break. They are emitted as explicit pieces rather than left to the voice,
 * because the voice is given one paragraph at a time and cannot know what
 * follows.
 */
import type { BookDocument, BookBlock, ChapterEntry, Footnote } from '@core/assemble'
// The module, not the barrel. `@core/layout` re-exports the line breaker,
// whose named import from the CommonJS `tex-linebreak` is fine in the browser
// and under vitest and fails under vite's SSR door — which is how every script
// in `scripts/` loads core. Measured: the barrel import shipped green under 2007
// tests and `read-book.mjs` could not start.
import { prepareFootnotes } from '@core/layout/footnotes'
import { GLOSSARY_MARK } from '@core/annotate'
import { speakHeadingNumbers } from './roman'
import { applyPronunciations, type Pronunciation } from './pronounce'

/**
 * Marks printed for the eye, taken out before anything is said.
 *
 * The glossary circle is the one that matters here and it is not a decoration
 * to be tidied — it is a degree sign, and measured on this shelf's own text
 * `occultism°` is read as **"occultism degrees"**. A book that marks a hundred
 * headwords would gain a hundred spoken words that are not in it, each one
 * sounding like the author wrote it.
 *
 * Only marks that exist to be *looked* at belong here. Nothing that a reader
 * would say out loud is removed, because a reading that quietly drops words is
 * the failure this whole module is arranged against.
 */
export function withoutSilentMarks(text: string): string {
  return text.replaceAll(GLOSSARY_MARK, '')
}

/**
 * A line that titles the lines under it.
 *
 * Measured in *The Human Aura*: "Nervous System—" and "Blood and Organs—" each
 * open a group of four items, and the dash is already silent, so what makes
 * them read as an interruption rather than a title is nothing to do with the
 * words. It is the pacing — an ordinary paragraph gap either side puts them on
 * the same level as the items they are naming.
 *
 * Deliberately narrow. A paragraph that ends in a dash mid-thought is ordinary
 * in prose of this period, so a label has to be short as well, and must not end
 * the way a sentence ends.
 */
export function looksLikeLabel(text: string): boolean {
  const trimmed = text.trim()
  if (/[.!?]["'’”]?$/u.test(trimmed)) return false
  if (!/[—–:-]$/u.test(trimmed)) return false
  return trimmed.split(/\s+/u).filter(Boolean).length <= 6
}

/**
 * A printer's ornament: a row of stars marking a break, and not a word.
 *
 * Measured, because it does not look like a problem until it is heard: the
 * three rows of `* * * * * * * *` in the last chapter are read aloud as
 * **"asterisk asterisk asterisk"**. What the row means is a pause, so a pause
 * is what it becomes — which is a translation of the mark rather than a
 * dropping of it.
 */
export function looksOrnamental(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && !/[\p{L}\p{N}]/u.test(trimmed)
}

/** One thing to say, or one silence to leave. */
export interface SpokenPiece {
  kind: 'heading' | 'label' | 'paragraph' | 'note-intro' | 'note' | 'pause'
  /** What to say. Absent on a pause. */
  text?: string
  /** How long to say nothing for. Absent on anything else. */
  seconds?: number
  /** The block or footnote this came from, for checking against the book. */
  id?: string
}

/** A block the reading could not use, and why. Never silently omitted. */
export interface UnreadBlock {
  id: string
  kind: string
  why: string
}

export interface ReadingScript {
  /** The chapter's title, as a person would name the file. */
  title: string
  /** The number line printed over the title, where the book prints one. */
  label?: string
  pieces: SpokenPiece[]
  unread: UnreadBlock[]
  /** Words to be spoken, for checking the duration that comes back is sane. */
  words: number
}

/** How long to leave between things, in seconds. */
const PAUSE = {
  /** After a chapter's number line, before its title. */
  overTitle: 0.4,
  /** After the title, before the first paragraph. */
  afterHeading: 1.2,
  /** Between paragraphs. */
  paragraph: 0.6,
  /** Before the notes at the end of a chapter. */
  beforeNotes: 1.6,
  /** Between one note and the next. */
  betweenNotes: 0.5,
  /** Before a heading that opens a section inside a chapter. */
  beforeSection: 1.4,
  /** Before a line that titles what follows — it opens a group. */
  beforeLabel: 1,
  /** After one, and shorter, so the first item under it sounds attached. */
  afterLabel: 0.45,
  /** A printer's ornament, which means a break and is not a word. */
  ornament: 1.5
}

/** Block kinds that are read as ordinary prose. */
// `blockquote`, not `quote`: the kind is named in `@core/transcribe` and this set
// once carried a name that nothing emits, so every block quotation in every
// book came back "nothing knows how to read a blockquote". No book had one
// until *Uncommon Therapy*, whose case reports are all set as quotations —
// 71 blocks, ten thousand words, reported unread and counted in nothing.
const PROSE = new Set(['paragraph', 'blockquote', 'list-item', 'caption'])

/**
 * The chapters a listener counts, which are the level-1 openings.
 *
 * `doc.chapters` is the *contents'* list and holds more than chapters: a
 * subheading set inside a chapter earns an entry there because the contents
 * page shows it, and so does a divider the editor wrote between two books.
 * Counting those as chapters is wrong twice over, and the second way is the
 * serious one.
 *
 * The first is only confusing — the numbering stops matching the book's spine,
 * so "chapter 11" of the combined *Human Aura* was a section in the middle of
 * chapter VIII.
 *
 * The second loses text. Slicing from one entry to the next ended chapter
 * VIII's reading at that section: its audio stopped on "The following table,
 * committed to memory, will be of help to him", and the table and three closing
 * paragraphs were never spoken. Nothing reported it, because `unread` accounts
 * for blocks *inside* the slice and these had fallen outside it — a gap with a
 * green report beside it, which is the exact failure this module is arranged
 * against. Three chapters of that one book were short this way.
 */
export function spokenChapters(doc: BookDocument): ChapterEntry[] {
  return doc.chapters.filter((chapter) => chapter.level === 1)
}

/**
 * The blocks belonging to one chapter, by its place in {@link spokenChapters}.
 *
 * Sliced between this chapter's opening block and the next *chapter's* rather
 * than by counting headings, because a chapter can open with two of them — a
 * number over a title — and counting would start every chapter one block late.
 */
export function chapterBlocks(doc: BookDocument, index: number): BookBlock[] {
  const chapters = spokenChapters(doc)
  const chapter = chapters[index]
  if (chapter === undefined) return []
  const from = doc.blocks.findIndex((block) => block.id === chapter.id)
  if (from < 0) return []
  const next = chapters[index + 1]
  const to = next ? doc.blocks.findIndex((block) => block.id === next.id) : -1
  return doc.blocks.slice(from, to < 0 ? doc.blocks.length : to)
}

/**
 * The notes whose reference falls inside this chapter's blocks.
 *
 * Matched on the block a note is anchored to, or the page it was printed on for
 * one that came off the paper. A note that belongs to no chapter is not this
 * function's problem to hide: `readChapter` reports it.
 */
export function chapterNotes(doc: BookDocument, blocks: readonly BookBlock[]): Footnote[] {
  const ids = new Set(blocks.map((block) => block.id))
  const pages = new Set(blocks.flatMap((block) => block.sourcePages))
  return doc.footnotes.filter((note) =>
    note.anchor ? ids.has(note.anchor.blockId) : pages.has(note.pageIndex)
  )
}

/**
 * One chapter, as a script.
 *
 * The pronunciation list is applied to everything and the chapter-number rule
 * only to headings, because `I` is also the commonest pronoun in English.
 */
export function readChapter(
  doc: BookDocument,
  index: number,
  pronunciations: readonly Pronunciation[] = []
): ReadingScript {
  const blocks = chapterBlocks(doc, index)
  const entry = spokenChapters(doc)[index]
  const pieces: SpokenPiece[] = []
  const unread: UnreadBlock[] = []

  const said = (text: string) => applyPronunciations(withoutSilentMarks(text), pronunciations)
  const heading = (text: string) => said(speakHeadingNumbers(text))

  // A footnote's reference mark is printed for the eye and read aloud as a
  // number: "families who live in poverty 1 ." came back as "poverty one".
  // The engine already walks every block and deletes each mark it pairs with a
  // note, so the text spoken is that walk's output and not a second opinion
  // about where the marks are — one implementation, the one that sets the
  // page. A block the walk has no entry for is read as it stands.
  const marked = prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks).blocks
  const spoken = new Map(doc.blocks.map((block, i) => [block.id, marked[i]?.text ?? block.text]))

  // One silence between two things, never two.
  //
  // Emitting a gap after a piece *and* before the next one stacks them: a label
  // followed by its first item came out with 0.45s and then 0.6s, which is a
  // second of silence where the point was to make the item sound attached. So
  // the gap is carried forward and written once, immediately before whatever it
  // precedes.
  let gap = 0
  for (const block of blocks) {
    const text = (spoken.get(block.id) ?? block.text).trim()
    if (text.length === 0) {
      unread.push({ id: block.id, kind: block.kind, why: 'the block is empty' })
      continue
    }
    if (looksOrnamental(text)) {
      // The ornament *is* the silence, so it replaces the gap rather than
      // adding to it. It carries its own id, which is how it stays accounted
      // for without being spoken.
      pieces.push({ kind: 'pause', seconds: PAUSE.ornament, id: block.id })
      gap = 0
      continue
    }
    if (block.kind === 'table') {
      // Read as prose a table is "cell | cell | cell", which is worse than a
      // gap because it sounds like the book. Left out, and said so.
      unread.push({ id: block.id, kind: block.kind, why: 'a table cannot be read aloud as prose' })
      continue
    }
    if (block.kind !== 'heading' && !PROSE.has(block.kind)) {
      unread.push({
        id: block.id,
        kind: block.kind,
        why: `nothing knows how to read a ${block.kind}`
      })
      continue
    }

    const isHeading = block.kind === 'heading'
    const isLabel = !isHeading && looksLikeLabel(text)
    if (isHeading) {
      // Two kinds of heading, and they want opposite amounts of air.
      //
      // A number line over a title is one opening, not two, so the two are set
      // close together and the gap is fixed rather than widened by whatever
      // came before. A heading that follows prose is a new section inside the
      // chapter and needs *more* room than a paragraph break, not less — read
      // with the opening's gap it sounds like a sentence that lost its verb.
      //
      // Which one this is, is read off what was last said rather than tracked
      // in a variable, so an ornament or a skipped table between two headings
      // cannot leave the answer stale.
      const opensWithTheOneBefore = pieces.at(-1)?.kind === 'heading'
      gap = pieces.length === 0 ? 0 : opensWithTheOneBefore ? PAUSE.overTitle : PAUSE.beforeSection
    } else if (isLabel) gap = Math.max(gap, PAUSE.beforeLabel)

    if (gap > 0) pieces.push({ kind: 'pause', seconds: gap })
    pieces.push({
      kind: isHeading ? 'heading' : isLabel ? 'label' : 'paragraph',
      text: isHeading ? heading(text) : said(text),
      id: block.id
    })
    gap = isHeading ? PAUSE.afterHeading : isLabel ? PAUSE.afterLabel : PAUSE.paragraph
  }

  const notes = chapterNotes(doc, blocks)
  if (notes.length > 0) {
    pieces.push({ kind: 'pause', seconds: Math.max(gap, PAUSE.beforeNotes) })
    pieces.push({
      kind: 'note-intro',
      // Announced rather than run on. A note read straight after the last
      // paragraph is heard as another paragraph, and the reader is a sentence
      // into it before realising the book has stopped.
      text: notes.length === 1 ? 'A note to this chapter.' : `Notes to this chapter.`
    })
    for (const note of notes) {
      pieces.push({ kind: 'pause', seconds: PAUSE.betweenNotes })
      pieces.push({ kind: 'note', text: said(note.text.trim()), id: note.id })
    }
  }

  const words = pieces
    .filter((piece) => piece.text !== undefined)
    .reduce((n, piece) => n + (piece.text ?? '').split(/\s+/u).filter(Boolean).length, 0)

  return {
    title: entry?.title ?? 'Untitled',
    label: entry?.label,
    pieces,
    unread,
    words
  }
}

/**
 * How many pieces at the head of a script make up the chapter's opening.
 *
 * The music under a chapter is timed from the end of its title, so something
 * has to say where the title ends. "The last heading in the chapter" was that
 * something, and it was right only for as long as a heading could not appear
 * anywhere but the top.
 *
 * The moment a chapter kept its own section headings, it stopped being right in
 * the worst available way. Measured on chapter VIII of *The Human Aura*: the
 * last heading is "TABLE OF HEALING COLORS.", six and a half minutes in, so the
 * bed was planned around a 390-second opening. There is no 390 seconds of
 * music, the fade was pulled in to where the file ends, and what a listener
 * hears is twenty seconds of music playing on under the first paragraph — which
 * is the one thing `planOpening` was written to prevent.
 *
 * So the opening is the run of headings the chapter *starts* with, pauses
 * between them included. Anything else ends it.
 */
export function openingPieces(script: ReadingScript): number {
  let count = 0
  for (const [index, piece] of script.pieces.entries()) {
    if (piece.kind === 'heading') count = index + 1
    else if (piece.kind !== 'pause') break
  }
  return count
}

/**
 * How long the finished audio ought to be, roughly, in seconds.
 *
 * Not a target and not enforced. It is the number to compare a render against:
 * a chapter that comes back at half its expected length has lost something, and
 * without this that is only discoverable by listening to all of it.
 */
export function expectedSeconds(script: ReadingScript, wordsPerSecond = 2.6): number {
  const silence = script.pieces.reduce((n, piece) => n + (piece.seconds ?? 0), 0)
  return script.words / wordsPerSecond + silence
}
