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
import { withMarkup } from '@core/transcribe'
import type { BookDocument } from './assemble-book'

/**
 * The book's whole text: front and back divisions the editor wrote, the body,
 * matter set apart, every caption, and every footnote — including the ones no
 * marker in the body reaches, which print as collected endnotes and are text a
 * reader will see.
 */
export function bookText(doc: BookDocument): string {
  const parts: string[] = []
  const marked = (b: { text: string; emphasis?: number[]; strong?: number[] }): string =>
    withMarkup(b.text, b.emphasis, b.strong)

  for (const section of doc.sections.filter((s) => s.placement === 'front')) {
    parts.push(section.label ?? '', section.title, ...section.blocks.map(marked))
  }
  parts.push(...doc.blocks.map(marked))
  parts.push(...doc.asides.map(marked))
  for (const illustration of doc.illustrations) {
    if (illustration.caption) parts.push(illustration.caption)
  }
  parts.push(...doc.footnotes.map(marked))
  for (const section of doc.sections.filter((s) => s.placement === 'back')) {
    parts.push(section.label ?? '', section.title, ...section.blocks.map(marked))
  }

  return parts.filter((p) => p !== '').join('\n')
}
