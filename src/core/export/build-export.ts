/**
 * The edition facts, and an honest account of what came out.
 *
 * This used to assemble XeLaTeX source. It doesn't any more: the app lays the
 * book out itself and pdf-lib writes the file, so the only things left for this
 * module to do are the ones that were never about TeX — folding the gates'
 * answers into a set of edition details, naming the file, and reporting what
 * the interior actually contains against what the book had in it.
 *
 * That last part is the point. The interior is the deliverable now, so a book
 * that quietly lost its footnotes would otherwise pass every check here.
 *
 * Pure: no I/O, no rendering.
 */
import type { KdpValidationReport, StyleProfile } from '@core/model'
import type { BookDocument } from '@core/assemble'
import { validateKdp } from '@core/typeset'

/** The edition details only the user can supply. */
export interface EditionDetails {
  title: string
  author: string
  /** Who is publishing *this* reprint — not the original publisher. */
  imprint: string | null
  copyrightHolder: string | null
  isbn: string | null
  editionDate: string | null
  editionStatement: string | null
  /** Extra copyright-page lines, e.g. the public-domain statement. */
  notices: string[]
}

export interface BuildExportInput {
  document: BookDocument
  profile: StyleProfile
  edition: EditionDetails
  /**
   * Estimated final page count, used only for the KDP gutter check. The true
   * count is known once the book has been laid out; until then the scan's page
   * count is the honest stand-in.
   */
  estimatedPageCount: number
  /**
   * Results of an actual layout run, once there has been one. Supplying this is
   * what turns the estimated page count and the un-run layout checks into real
   * ones — the report is otherwise explicit that it is pre-typeset.
   *
   * `notesPlaced` and `notesDropped` come from the same run. They are reported
   * rather than assumed because the interior is the deliverable now: a book
   * that quietly lost two hundred footnotes would pass every other check here.
   */
  typeset?: {
    pageCount: number
    warnings: string[]
    notesPlaced?: number
    notesCollected?: number
    notesDropped?: { id: string; reason: string }[]
  }
  /**
   * What to do with notes whose reference mark was never found — the answer to
   * the structure gate's question. Dropping them is the default because a note
   * placed in the wrong spot is worse than one the gate told the user about.
   */
  omitOrphanFootnotes?: boolean
}

export interface BuildExportResult {
  /** A safe file name derived from the title. */
  fileName: string
  /** What the KDP checks say about the style, before the PDF exists. */
  validation: KdpValidationReport
  /** Things worth telling the user that aren't KDP's business. */
  notes: string[]
}

/**
 * The statement a public-domain reprint should carry. The original work is not
 * under copyright — only this edition's own typesetting and apparatus are — and
 * saying so plainly is both accurate and what the source deserves.
 */
export function publicDomainNotice(originalYear: string | null): string {
  const origin = originalYear ? `first published in ${originalYear}, ` : ''
  return (
    `The original work, ${origin}is in the public domain. ` +
    'This edition’s typesetting and design are new.'
  )
}

/** A file name that survives every filesystem: ASCII, no separators, bounded. */
export function safeFileName(title: string, extension: string): string {
  const stem =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase() || 'book'
  return `${stem}.${extension}`
}

/** Empty strings mean "not given" for these fields, not "given as blank". */
function trimmedOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/**
 * Fold the export gate's answers into the edition details. Kept here rather
 * than in the wizard so the mapping lives next to the thing that consumes it.
 *
 * Every field it reads comes from one gate. That is not a coincidence: the
 * title, the author and the original year used to be asked at Gate 1, before
 * anything had read the title page, so the user had to go and find them. They
 * are asked at the export gate now, prefilled from what the vision pass read,
 * which puts all of the copyright page's facts in one place.
 */
export function editionFromAnswers(exportAnswers: Record<string, unknown>): EditionDetails {
  const originalYear = trimmedOrNull(exportAnswers['originalYear'])
  const notices: string[] = []
  if (exportAnswers['publicDomainNotice'] !== false) {
    notices.push(publicDomainNotice(originalYear))
  }

  return {
    title: trimmedOrNull(exportAnswers['title']) ?? 'Untitled',
    author: trimmedOrNull(exportAnswers['author']) ?? '',
    imprint: trimmedOrNull(exportAnswers['imprint']),
    copyrightHolder: trimmedOrNull(exportAnswers['copyrightHolder']),
    isbn: trimmedOrNull(exportAnswers['isbn']),
    editionDate: trimmedOrNull(exportAnswers['editionDate']),
    editionStatement: trimmedOrNull(exportAnswers['editionStatement']),
    notices
  }
}

export function buildExport(input: BuildExportInput): BuildExportResult {
  const { document, profile, edition } = input

  // Before a layout run the page count is the scan's and there are no layout
  // warnings — `typeset: false` makes the report say that, instead of ticking
  // two boxes it hasn't earned.
  const validation = validateKdp({
    profile,
    pageCount: input.typeset?.pageCount ?? input.estimatedPageCount,
    warnings: input.typeset?.warnings ?? [],
    typeset: input.typeset !== undefined
  })

  const notes: string[] = []

  if (document.chapters.length === 0) {
    notes.push('No chapters were detected, so the book has no table of contents.')
  } else if (input.typeset) {
    notes.push(
      `The table of contents lists ${document.chapters.length} heading(s), with the ` +
        'page numbers this edition actually prints.'
    )
  }

  // What happened to the notes, in the book that was built. Silence here would
  // be the worst possible reporting: a reader only finds a missing footnote
  // once the book is printed.
  if (document.footnotes.length > 0 && input.typeset) {
    const placed = input.typeset.notesPlaced ?? 0
    const collected = input.typeset.notesCollected ?? 0
    const dropped = input.typeset.notesDropped ?? []
    if (placed > 0) {
      notes.push(`${placed} footnote(s) were set at the foot of the page they belong to.`)
    }
    if (collected > 0) {
      notes.push(
        `${collected} footnote(s) had no reference mark and were collected at the end of ` +
          'the book, where you can place them by hand.'
      )
    }
    if (dropped.length > 0) {
      notes.push(
        `${dropped.length} footnote(s) could not be placed — ${dropped[0]!.reason}. ` +
          'They are in the transcription but not in the PDF.'
      )
    }
  } else {
    const orphans = document.footnotes.filter((f) => f.orphaned)
    if (orphans.length > 0) {
      notes.push(
        (input.omitOrphanFootnotes ?? true)
          ? `${orphans.length} footnote(s) had no reference mark and were left out.`
          : `${orphans.length} footnote(s) had no reference mark and were collected at the end.`
      )
    }
  }
  if (document.skipped.length > 0) {
    notes.push(`${document.skipped.length} page(s) were deliberately not transcribed.`)
  }
  if (!edition.isbn) {
    notes.push('No ISBN — fine for a KDP-assigned one, but the copyright page will omit it.')
  }

  return {
    fileName: safeFileName(edition.title, 'pdf'),
    validation,
    notes
  }
}
