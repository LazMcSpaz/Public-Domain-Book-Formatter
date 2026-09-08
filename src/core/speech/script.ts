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
import type { BookDocument, BookBlock, Footnote } from '@core/assemble'
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

/** One thing to say, or one silence to leave. */
export interface SpokenPiece {
  kind: 'heading' | 'paragraph' | 'note-intro' | 'note' | 'pause'
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
  betweenNotes: 0.5
}

/** Block kinds that are read as ordinary prose. */
const PROSE = new Set(['paragraph', 'quote', 'list-item', 'caption'])

/**
 * The blocks belonging to one chapter, by its entry in the document.
 *
 * Sliced between this chapter's opening block and the next one's rather than by
 * counting headings, because a chapter can open with two of them — a number
 * over a title — and counting would start every chapter one block late.
 */
export function chapterBlocks(doc: BookDocument, index: number): BookBlock[] {
  const chapter = doc.chapters[index]
  if (chapter === undefined) return []
  const from = doc.blocks.findIndex((block) => block.id === chapter.id)
  if (from < 0) return []
  const next = doc.chapters[index + 1]
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
  const entry = doc.chapters[index]
  const pieces: SpokenPiece[] = []
  const unread: UnreadBlock[] = []

  const said = (text: string) => applyPronunciations(withoutSilentMarks(text), pronunciations)
  const heading = (text: string) => said(speakHeadingNumbers(text))

  let lastWasHeading = false
  for (const block of blocks) {
    const text = block.text.trim()
    if (text.length === 0) {
      unread.push({ id: block.id, kind: block.kind, why: 'the block is empty' })
      continue
    }
    if (block.kind === 'heading') {
      if (pieces.length > 0) pieces.push({ kind: 'pause', seconds: PAUSE.overTitle })
      pieces.push({ kind: 'heading', text: heading(text), id: block.id })
      lastWasHeading = true
      continue
    }
    if (block.kind === 'table') {
      // Read as prose a table is "cell | cell | cell", which is worse than a
      // gap because it sounds like the book. Left out, and said so.
      unread.push({ id: block.id, kind: block.kind, why: 'a table cannot be read aloud as prose' })
      continue
    }
    if (!PROSE.has(block.kind)) {
      unread.push({
        id: block.id,
        kind: block.kind,
        why: `nothing knows how to read a ${block.kind}`
      })
      continue
    }
    pieces.push({
      kind: 'pause',
      seconds: lastWasHeading ? PAUSE.afterHeading : PAUSE.paragraph
    })
    pieces.push({ kind: 'paragraph', text: said(text), id: block.id })
    lastWasHeading = false
  }

  const notes = chapterNotes(doc, blocks)
  if (notes.length > 0) {
    pieces.push({ kind: 'pause', seconds: PAUSE.beforeNotes })
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
