/**
 * Corrections to the original contents' synopses.
 *
 * A synopsis is read off the contents leaves and carried on the chapter it
 * describes (or reported unmatched), never in `doc.blocks` — the contents is
 * front matter this edition regenerates, so its leaves are not body text. That
 * left the one stretch of the original's prose this edition still prints with
 * no way to be corrected: the editor of *The Mahatma Letters* ruled on ten
 * faults inside its contents (`——` for `—`, `re-received`, `indestructable`,
 * `The Masters first duty`) and nothing could apply one.
 *
 * So a synopsis is corrected the way the book's own footnotes are: a
 * `synopsis-text` edit carries the whole corrected text, keyed by the contents
 * block the entry opened with (`p22b0`), and is applied over the pristine
 * reading each time the book is assembled. The ruling keeps the page as
 * printed — it is in the transcription — and the edition prints the
 * correction. The text is the synopsis as printed, page references and all,
 * so a ruling quoted from the contents (`the teaching re-received; 178-9.`)
 * is found in it and lands through `sweep` like any other.
 *
 * The references are structure, and a correction moves the characters they
 * point at, so they are read again from the corrected text by the same
 * `readReferences` that read them at assembly — over the same sequence, the
 * run of consecutive contents leaves the entry came from, because the
 * sequence is what tells a page from a count.
 *
 * Pure.
 */
import { readReferences, type SynopsisSource } from '@core/pages'
import { parseInlineMarkup } from '@core/transcribe'
import type { BookDocument } from '@core/assemble'

type Chapters = BookDocument['chapters']
type Unmatched = BookDocument['synopsesUnmatched']

/** A synopsis the document carries, wherever it is carried. */
export interface CarriedSynopsis {
  /** What a `synopsis-text` edit names. */
  id: string
  text: string
  /** The contents leaves it was read from. */
  pages: number[]
  /** The chapter it is printed under, or null for one nothing claimed. */
  chapterId: string | null
  /** How the contents named the entry — its label, else its title. */
  name: string
}

/** `p22b3` → [22, 3], for putting synopses back into contents order. */
function position(id: string): [number, number] {
  const m = /^p(\d+)b(\d+)$/u.exec(id)
  return m ? [Number(m[1]), Number(m[2])] : [Number.MAX_SAFE_INTEGER, 0]
}

function byPosition(a: { id: string }, b: { id: string }): number {
  const [pa, ba] = position(a.id)
  const [pb, bb] = position(b.id)
  return pa - pb || ba - bb
}

/** Every synopsis the document carries, in the order the contents printed them. */
export function synopsesOf(
  doc: Pick<BookDocument, 'chapters' | 'synopsesUnmatched'>
): CarriedSynopsis[] {
  const out: CarriedSynopsis[] = []
  for (const chapter of doc.chapters) {
    if (chapter.synopsis === undefined || !chapter.synopsisSource) continue
    out.push({
      id: chapter.synopsisSource.id,
      text: chapter.synopsis,
      pages: chapter.synopsisSource.pages,
      chapterId: chapter.id,
      name: chapter.label ? `${chapter.label} ${chapter.title}` : chapter.title
    })
  }
  for (const entry of doc.synopsesUnmatched) {
    if (!entry.source) continue
    out.push({
      id: entry.source.id,
      text: entry.synopsis,
      pages: entry.source.pages,
      chapterId: null,
      name: entry.label || entry.title
    })
  }
  return out.sort(byPosition)
}

/**
 * The first leaf of the run of contents leaves `leaf` belongs to — the same
 * grouping assembly reads references in. The contents' leaves are the ones
 * it skipped as contents; with none recorded, everything is one run.
 */
function runOf(leaf: number, contentsLeaves: ReadonlySet<number>): number {
  if (contentsLeaves.size === 0) return 0
  let first = leaf
  while (contentsLeaves.has(first - 1)) first--
  return first
}

/** Corrected text as a synopsis holds it: plain, one line. */
function plain(text: string): string {
  return parseInlineMarkup(text).text.replace(/\s+/gu, ' ').trim()
}

/**
 * The chapters and the unmatched entries with the corrections in and the
 * references read again. Returns its inputs untouched when there is nothing
 * to correct, so a book with no such edit is the same document whether or not
 * it went through here. An emptied synopsis is removed, as an emptied note is.
 */
export function withSynopsisTexts(
  chapters: Chapters,
  unmatched: Unmatched,
  texts: ReadonlyMap<string, string>,
  skipped: BookDocument['skipped']
): { chapters: Chapters; unmatched: Unmatched } {
  if (texts.size === 0) return { chapters, unmatched }

  // Every carried synopsis as a mutable record, corrected.
  interface Carried {
    source: SynopsisSource
    text: string
  }
  const corrected = (source: SynopsisSource, text: string): Carried => {
    const fix = texts.get(source.id)
    return { source: { ...source }, text: fix === undefined ? text : plain(fix) }
  }
  const chapterCarried = new Map<string, Carried>()
  for (const chapter of chapters) {
    if (chapter.synopsis !== undefined && chapter.synopsisSource) {
      chapterCarried.set(chapter.id, corrected(chapter.synopsisSource, chapter.synopsis))
    }
  }
  const unmatchedCarried = unmatched.map((entry) =>
    entry.source ? corrected(entry.source, entry.synopsis) : null
  )

  // The references, read again over each run of contents leaves in order.
  const contentsLeaves = new Set(
    skipped.filter((s) => s.role === 'table-of-contents').map((s) => s.pageIndex)
  )
  const runIn = [...chapterCarried.values(), ...unmatchedCarried]
    .filter((c): c is Carried => c !== null && c.source.references !== undefined)
    .sort((a, b) => byPosition(a.source, b.source))
  const runs = new Map<number, Carried[]>()
  for (const c of runIn) {
    const key = runOf(c.source.pages[0] ?? 0, contentsLeaves)
    runs.set(key, [...(runs.get(key) ?? []), c])
  }
  for (const run of runs.values()) {
    readReferences(run.map((c) => c.text)).forEach((refs, i) => {
      run[i]!.source.references = refs
    })
  }

  return {
    chapters: chapters.map((chapter) => {
      const c = chapterCarried.get(chapter.id)
      if (!c) return chapter
      if (c.text === '') {
        const { synopsis: _synopsis, synopsisSource: _source, ...rest } = chapter
        return rest
      }
      return { ...chapter, synopsis: c.text, synopsisSource: c.source }
    }),
    unmatched: unmatched.flatMap((entry, i) => {
      const c = unmatchedCarried[i]
      if (!c) return [entry]
      if (c.text === '') return []
      return [{ ...entry, synopsis: c.text, source: c.source }]
    })
  }
}
