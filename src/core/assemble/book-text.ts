/**
 * Every word the book prints, in one string, in the notation an editor writes.
 *
 * There was no such thing, and there needed to be: the ruling check
 * (`unapplied`, `@core/queries`) was handed `doc.blocks` and called it the
 * book, so a correction that landed in a **footnote** read as never applied,
 * and one whose wording carried an `<i>` could not be found at all because a
 * block's `text` has the emphasis stripped out into word indices. Both were
 * measured on *Isis Unveiled*: three of eight corrections the editor had ruled
 * on came back as outstanding after they had been made, which is the failure
 * mode CLAUDE.md names — a guard that cries wolf is what stops anyone reading
 * the guard.
 *
 * So the rule for what counts as the book lives here, once, rather than in
 * whichever caller happens to need it. That is the same lesson `deriveChapters`
 * taught: a second copy of a rule agrees with the first until the day it
 * doesn't.
 *
 * **Markup is put back**, because that is how the text is written down
 * everywhere a person or a session touches it — `drive.mjs body` hands back
 * exactly these strings, an edit is written in terms of them, and a ruling's
 * correction is quoted from them.
 *
 * The order is the order the book is read in and nothing depends on it, but
 * it costs nothing to keep and makes the string worth looking at when a check
 * goes wrong.
 *
 * Pure: no DOM, no I/O.
 */
import { withMarkup, type InlinePart } from '@core/transcribe'
import type { BookDocument } from './assemble-book'

/**
 * The book's whole text: front and back divisions the editor wrote, the
 * original contents' descriptions, the body, matter set apart, every caption,
 * and every footnote — including the ones no marker in the body reaches, which
 * print as collected endnotes and are text a reader will see.
 *
 * The descriptions are in because they are prose of the original's that this
 * edition prints, and the editor rules on them like any other: ten rulings on
 * the contents of *The Mahatma Letters* were reported outstanding for ever
 * while the check looked only at blocks. Matched to a chapter or not, since a
 * correction to one has landed whether or not the style prints it.
 */
export function bookText(doc: BookDocument): string {
  return printedTexts(doc)
    .map((p) => p.text)
    .join('\n')
}

/** One stretch of what the book prints, with where it comes from. */
export interface PrintedText {
  /** A block's id, `fn<n>` for a note, or the kind of matter and its place. */
  id: string
  text: string
}

/**
 * The same text as `bookText`, in the same order, a stretch at a time and
 * named — for a check that has to say *where* a word is.
 *
 * It exists because the spelling check kept its own list of what the book is,
 * the body, the notes and the editor's sections, and that list left out the
 * original contents' descriptions. KDP's spell-check of *The Mahatma Letters*
 * (10 November 2026) found `deaih-bed`, `crueily` and `physcists` in Barker's
 * analytical contents, which this edition prints and nothing here had ever
 * read. One rule for "what the book prints", here, is the repair, so a check
 * cannot read less of the book than the reader does. `markup: false` gives
 * the plain words, for checks that read words rather than notation.
 */
export function printedTexts(doc: BookDocument, options: { markup?: boolean } = {}): PrintedText[] {
  const markup = options.markup ?? true
  const parts: PrintedText[] = []
  const of = (b: {
    text: string
    emphasis?: number[]
    strong?: number[]
    smallCaps?: number[]
    parts?: InlinePart[]
  }): string => (markup ? withMarkup(b.text, b.emphasis, b.strong, b.smallCaps, b.parts) : b.text)
  const push = (id: string, text: string): void => {
    if (text !== '') parts.push({ id, text })
  }
  const section = (s: BookDocument['sections'][number], k: number): void => {
    push(`section${k}:label`, s.label ?? '')
    push(`section${k}:title`, s.title)
    for (const b of s.blocks) push(b.id, of(b))
  }

  doc.sections.forEach((s, k) => {
    if (s.placement === 'front') section(s, k)
  })
  synopsesPrinted(doc).forEach((s, k) =>
    push(`synopsis${k}${s.pages.length ? `@p${s.pages[0]}` : ''}`, s.text)
  )
  for (const b of doc.blocks) push(b.id, of(b))
  doc.asides.forEach((b, k) => push(b.id ?? `aside${k}`, of(b)))
  doc.illustrations.forEach((illustration, k) => {
    if (illustration.caption) push(`caption${k}`, illustration.caption)
  })
  doc.footnotes.forEach((n, k) => push(`fn${k + 1}`, of(n)))
  doc.sections.forEach((s, k) => {
    if (s.placement === 'back') section(s, k)
  })
  return parts
}

/**
 * Every description read off the original contents, with the leaves it was
 * read from — what one leaf of the contents prints, for a question about it.
 */
export function synopsesPrinted(
  doc: Pick<BookDocument, 'chapters' | 'synopsesUnmatched'>
): { text: string; pages: number[] }[] {
  return [
    ...doc.chapters.flatMap((c) =>
      c.synopsis !== undefined ? [{ text: c.synopsis, pages: c.synopsisSource?.pages ?? [] }] : []
    ),
    ...doc.synopsesUnmatched.map((u) => ({ text: u.synopsis, pages: u.source?.pages ?? [] }))
  ]
}
