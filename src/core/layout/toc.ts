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
 * ## When the numbers are in the prose
 *
 * An analytical contents of the older kind carries page references inside its
 * descriptions — *The Mahatma Letters* closes every group of topics on one,
 * `; 52-3.` — and those are set to this edition's pages too
 * (`./contents-pages`). They cannot be reserved the way the folio column is:
 * `52-3` may become `61` or `178-80`, so the descriptions, and with them the
 * contents, change length between the passes. What saves the scheme is that
 * the body's folios restart at 1 after roman-numbered front matter, so the
 * contents' length cannot move a page the body prints; what it *can* move is
 * the roman folio of a division the editor wrote into the front matter after
 * it, and those are in the contents too.
 *
 * So the invariant checked is the real one, and not the page count that stood
 * in for it: **every number the contents prints equals the number its own
 * layout gives when asked again.** Pass one is laid out with no numbers and
 * the references taken out; each later pass prints what the pass before it
 * measured, and is accepted only when re-measuring it gives back exactly what
 * it printed. One more pass is allowed when it does not — a front-matter folio
 * moved by the contents' new length settles there — and if that still
 * disagrees, the numberless pass is printed and a warning says so.
 *
 * Pure: `layout()` is a pure function of its inputs, which is what makes
 * "run it again" a legitimate way to solve this at all.
 */
import type { StyleProfile } from '@core/model'
import type { BookDocument } from '@core/assemble'
import type { ContentsReference } from '@core/pages'
import { ENDNOTES_TITLE, layout, type LayoutOptions, type TocLine } from './paginate'
import { headingsWithoutMarks, prepareFootnotes } from './footnotes'
import { contentsPages, synopsisWithPages } from './contents-pages'
import type { TextMeasurer } from './measure'
import type { LaidOutBook } from './types'

/** What a contents prints that a layout has to supply: per entry, its folio and its references. */
interface ContentsNumbers {
  folios: (string | null)[]
  references: (string | null)[][]
}

/**
 * Lay the book out with a contents page whose numbers are real.
 *
 * Falls back to a single pass when there is nothing to list, or when the caller
 * only wants a sample: a contents page built from four pages of a four-hundred
 * page book would be worse than none, and the design preview is the only caller
 * that asks for a sample.
 *
 * `engine` is the layout run each pass, and is only ever not `layout` in a
 * test: a guard whose fallback cannot be made to fire is a guard nobody knows
 * reports, and an engine that disagrees with itself on demand is the one way
 * to make it fire.
 */
export function layoutWithToc(
  doc: BookDocument,
  profile: StyleProfile,
  measurer: TextMeasurer,
  options: LayoutOptions,
  engine: typeof layout = layout
): LaidOutBook {
  if (options.maxBodyPages !== undefined) return engine(doc, profile, measurer, options)
  if (doc.chapters.length === 0 && doc.sections.length === 0 && options.orphanNotes !== 'collect') {
    return engine(doc, profile, measurer, options)
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
  // A chapter title that carries a footnote's reference mark is stored with the
  // mark in it, and the contents must print the title rather than the mark. The
  // same lookup the layout uses, from the same call, so the two passes cannot
  // name a chapter differently.
  const titleMarks = headingsWithoutMarks(
    doc.blocks,
    prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks)
  )
  const titled = (title: string): string => titleMarks.get(title.trim()) ?? title

  const front = doc.sections.filter((x) => x.placement === 'front')
  const back = doc.sections.filter((x) => x.placement === 'back')

  const entries: TocLine[] = [
    ...front.map((section) => ({
      id: `${section.id}-title`,
      title: section.title,
      ...(section.label ? { label: section.label } : {})
    })),
    ...doc.chapters
      .filter((chapter) => chapter.level <= profile.contentsDepth)
      .map((chapter) => ({
        id: chapter.id,
        // A chapter the body only numbers is named as the original contents
        // named it, with the number set as its label.
        ...(chapter.contentsTitle
          ? {
              title: chapter.contentsTitle,
              label: chapter.label
                ? `${chapter.label} ${titled(chapter.title)}`
                : titled(chapter.title)
            }
          : {
              title: titled(chapter.title),
              ...(chapter.label ? { label: chapter.label } : {})
            }),
        level: chapter.level,
        // Only when the style asks. The descriptions are long — twenty of them
        // turn a one-leaf contents into four — so this is a preference and not a
        // consequence of the book having had them.
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
    // The bare marks go in here too, and must: whether there is a collected
    // endnotes section is decided in this pass and again in the layout, and a
    // difference between the two is a contents that names a section the book
    // does not print. Two calls, one set of inputs.
    const { orphans } = prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks)
    if (orphans.length > 0) {
      entries.push({ id: 'endnotes', title: ENDNOTES_TITLE, level: 1, folio: null })
    }
  }

  // Nothing to list after all: a book with no chapters whose notes all found
  // their references. One pass, and no contents page.
  if (entries.length === 0) return engine(doc, profile, measurer, options)

  // The page references in each entry's description, in the entry's order.
  // Kept apart from the text, which carries them as the original printed them.
  const sources = entries.map((entry) =>
    entry.synopsis !== undefined
      ? doc.chapters.find((c) => c.id === entry.id)?.synopsisSource
      : undefined
  )
  const references: ContentsReference[][] = sources.map((source) => source?.references ?? [])

  // The entries as one pass prints them: with the numbers a pass measured, or
  // with none and every reference taken out.
  const lines = (numbers: ContentsNumbers | null): TocLine[] =>
    entries.map((entry, i) => ({
      ...entry,
      folio: numbers ? numbers.folios[i]! : null,
      ...(entry.synopsis !== undefined
        ? {
            synopsis: synopsisWithPages(
              entry.synopsis,
              references[i]!,
              numbers ? numbers.references[i]! : null
            )
          }
        : {})
    }))

  // What a layout says the contents should print. A chapter's folio is matched
  // back by identity; a reference is asked of the pages this layout set.
  const measured = (book: LaidOutBook): ContentsNumbers => {
    const placed = new Map(book.chapterPages.map((c) => [c.id, c.pageIndex]))
    const pages = contentsPages(doc, book)
    return {
      folios: entries.map((entry) => {
        const pageIndex = placed.get(entry.id)
        return pageIndex === undefined ? null : (book.pages[pageIndex]?.folio ?? null)
      }),
      references: entries.map((entry, i) =>
        references[i]!.map((ref) => pages.printed(ref, entry.synopsis ?? '', sources[i]?.pages[0]))
      )
    }
  }
  const same = (a: ContentsNumbers, b: ContentsNumbers): boolean =>
    JSON.stringify(a) === JSON.stringify(b)

  const first = engine(doc, profile, measurer, { ...options, toc: lines(null) })

  // Each pass prints what the one before it measured, and stands only if
  // measuring it again gives back what it printed. One more pass is allowed:
  // the numbers going in can change the contents' length, which moves the
  // roman folio of anything the editor wrote after it, and the pass after that
  // prints the moved number. The body's own folios cannot move — they restart
  // at 1 after the front matter — which is why one more is enough.
  let printed = measured(first)
  for (let pass = 0; pass < 2; pass++) {
    const book = engine(doc, profile, measurer, { ...options, toc: lines(printed) })
    const again = measured(book)
    if (same(printed, again)) return withUnplaced(book, printed, entries, references)
    printed = again
  }

  // The numbers never agreed with the layout that printed them, so the
  // contents is describing a book that does not exist. Printing it anyway is
  // the error a reader would trust; printing none is what is left, and it has
  // to say so.
  //
  // This fired once for a different reason: a descriptive contents printed
  // its folio line only once the number was known, so pass two ran a line per
  // entry longer, and the combined volume's contents spilled onto another leaf.
  // The cause is fixed (the line is reserved in both passes now), but the
  // fallback still has to report: a contents page with no numbers is worse
  // than a wrong one, because nothing about it looks wrong. Reported on the
  // `warnings` channel, which otherwise carries overfull lines — a stretch of
  // that meaning, and better than the alternative of shipping this in silence.
  const contentsPage = first.pages.findIndex((p) => p.kind === 'contents')
  return {
    ...first,
    warnings: [
      ...first.warnings,
      {
        pageIndex: contentsPage < 0 ? 0 : contentsPage,
        text:
          'The contents page is printing without page numbers: the numbers it would ' +
          'print did not agree with the layout that printed them after another pass, ' +
          'so the numbered passes were discarded.'
      }
    ]
  }
}

/**
 * A layout whose contents is right, with one warning more where a reference
 * in the original's contents names a page this edition could not place — a
 * folio the original never prints, or a page past the end of the text. Such a
 * reference is printed without a number, and the reader is not told where it
 * went unless this says so.
 */
function withUnplaced(
  book: LaidOutBook,
  numbers: ContentsNumbers,
  entries: readonly TocLine[],
  references: readonly ContentsReference[][]
): LaidOutBook {
  const missing: string[] = []
  references.forEach((refs, i) =>
    refs.forEach((ref, k) => {
      if (numbers.references[i]![k] !== null) return
      const original = entries[i]!.synopsis?.slice(ref.start, ref.end) ?? String(ref.from)
      missing.push(`${entries[i]!.label ?? entries[i]!.title} (${original})`)
    })
  )
  if (missing.length === 0) return book
  const contentsPage = book.pages.findIndex((p) => p.kind === 'contents')
  return {
    ...book,
    warnings: [
      ...book.warnings,
      {
        pageIndex: contentsPage < 0 ? 0 : contentsPage,
        text:
          `${missing.length} page reference${missing.length === 1 ? '' : 's'} in the ` +
          'original contents name a page this edition cannot place, and print without a ' +
          `number: ${missing.join(', ')}`
      }
    ]
  }
}
