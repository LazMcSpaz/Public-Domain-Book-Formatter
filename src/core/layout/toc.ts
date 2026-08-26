/**
 * A table of contents with page numbers that are measured, not guessed.
 *
 * The original edition's contents page was discarded on purpose — its page
 * numbers describe a pagination this book no longer has. Regenerating it means
 * solving a circle: the numbers only exist once the book has been laid out, and
 * inserting the pages that carry them moves everything they refer to.
 *
 * The circle is cut by making the contents' *length* independent of the numbers:
 *
 *   Pass 1  every entry, with the folio column left blank. The contents is
 *           therefore already the right number of pages, so the body falls
 *           exactly where it finally will, and `chapterPages` is the truth.
 *   Pass 2  the same entries, with the measured folios filled in. Same titles,
 *           same levels, same count, and the folio sits in a fixed-width column
 *           — so the layout is identical apart from the numbers now being on it.
 *
 * Two passes, and the second cannot invalidate the first. That property comes
 * from `buildContents` reserving the folio column whether or not it has a
 * number to put in it; the guard here is a check on it, not a hope.
 *
 * Pure: `layout()` is a pure function of its inputs, which is what makes
 * "run it again" a legitimate way to solve this at all.
 */
import type { StyleProfile } from '@core/model'
import type { BookDocument } from '@core/assemble'
import { ENDNOTES_TITLE, layout, type LayoutOptions, type TocLine } from './paginate'
import { prepareFootnotes } from './footnotes'
import type { TextMeasurer } from './measure'
import type { LaidOutBook } from './types'

/**
 * Lay the book out with a contents page whose numbers are real.
 *
 * Falls back to a single pass when there is nothing to list, or when the caller
 * only wants a sample: a contents page built from four pages of a four-hundred
 * page book would be worse than none, and the design preview is the only caller
 * that asks for a sample.
 */
export function layoutWithToc(
  doc: BookDocument,
  profile: StyleProfile,
  measurer: TextMeasurer,
  options: LayoutOptions
): LaidOutBook {
  if (options.maxBodyPages !== undefined) return layout(doc, profile, measurer, options)
  if (doc.chapters.length === 0 && doc.sections.length === 0 && options.orphanNotes !== 'collect') {
    return layout(doc, profile, measurer, options)
  }

  // Entries come from the document, not from the first pass's `chapterPages`,
  // so the two passes are laying out provably the same list. Only the folios
  // differ between them.
  //
  // In the order the engine will record them: front matter the editor wrote,
  // then the book's own chapters, then back matter. Each carries the id of the
  // heading it is, because the folios are matched back by *identity* — pairing
  // by array position would hand every chapter the wrong number the moment an
  // introduction was added in front of them.
  const front = doc.sections.filter((x) => x.placement === 'front')
  const back = doc.sections.filter((x) => x.placement === 'back')

  const entries: TocLine[] = [
    ...front.map((section) => ({
      id: `${section.id}-title`,
      title: section.title,
      ...(section.label ? { label: section.label } : {})
    })),
    // A contents that sets a paragraph under each chapter has nowhere to put a
    // subhead: it arrives as a bare centred line with a folio and no
    // description, between chapters that have one, and reads as a chapter whose
    // description has gone missing. The chapter's own description names them
    // anyway. A plain contents still lists them, indented by level, which is
    // what the indent is for.
    ...doc.chapters
      .filter((chapter) => !profile.contentsSynopsis || (chapter.level ?? 1) === 1)
      .map((chapter) => ({
        id: chapter.id,
        // The name the book's own contents gave it, where the two pages
        // disagree. Printing the chapter head in both places would replace the
        // contents' wording with the head's, and which the publishers meant is
        // not recoverable from the paper.
        title: chapter.contentsTitle ?? chapter.title,
        ...(chapter.label ? { label: chapter.label } : {}),
        level: chapter.level,
        // Only when the style asks. The descriptions are long — twenty of them
        // turn a one-leaf contents into four — so this is a preference and not
        // a consequence of the book having had them.
        ...(profile.contentsSynopsis && chapter.synopsis ? { synopsis: chapter.synopsis } : {})
      })),
    ...back.map((section) => ({
      id: `${section.id}-title`,
      title: section.title,
      ...(section.label ? { label: section.label } : {})
    }))
  ].map((entry) => ({ level: 1, ...entry, folio: null }))

  // A collected-endnotes section is a chapter as far as the contents is
  // concerned, and whether there will be one is decided by the document and the
  // option alone — never by a layout — so both passes agree about it.
  if (options.orphanNotes === 'collect') {
    const { orphans } = prepareFootnotes(doc.blocks, doc.footnotes)
    if (orphans.length > 0) {
      entries.push({ id: 'endnotes', title: ENDNOTES_TITLE, level: 1, folio: null })
    }
  }

  // Nothing to list after all: a book with no chapters whose notes all found
  // their references. One pass, and no contents page.
  if (entries.length === 0) return layout(doc, profile, measurer, options)

  const first = layout(doc, profile, measurer, { ...options, toc: entries })

  const placed = new Map(first.chapterPages.map((c) => [c.id, c.pageIndex]))
  const numbered: TocLine[] = entries.map((entry) => {
    const pageIndex = placed.get(entry.id)
    const folio = pageIndex === undefined ? null : (first.pages[pageIndex]?.folio ?? null)
    return { ...entry, folio }
  })

  const second = layout(doc, profile, measurer, { ...options, toc: numbered })

  // If filling the numbers in changed the pagination, the contents is now
  // describing a book that no longer exists. It cannot happen while the folio
  // column is fixed — but a silently wrong contents page is exactly the kind of
  // error a reader would trust, so the invariant is checked rather than assumed.
  //
  // And it *did* happen: a descriptive contents printed its folio line only
  // once the number was known, so pass two ran a line per entry longer, and the
  // combined volume's contents spilled onto another leaf. The guard caught it
  // and did the safe thing — and the safe thing is pass one, which has no page
  // numbers in it at all. The cause is fixed (the line is reserved in both
  // passes now), but the fallback still has to say so: a contents page with no
  // numbers is worse than a wrong one, because nothing about it looks wrong.
  // Reported on the `warnings` channel, which otherwise carries overfull lines
  // — a stretch of that meaning, and better than the alternative of shipping
  // this in silence.
  if (second.pages.length !== first.pages.length) {
    const contentsPage = first.pages.findIndex((p) => p.kind === 'contents')
    return {
      ...first,
      warnings: [
        ...first.warnings,
        {
          pageIndex: contentsPage < 0 ? 0 : contentsPage,
          text:
            'The contents page is printing without page numbers: filling them in ' +
            'changed the length of the book, so the numbered pass had to be discarded.'
        }
      ]
    }
  }

  return second
}
