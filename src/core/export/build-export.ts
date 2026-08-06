/**
 * Assemble the finished LaTeX source for a book.
 *
 * This is the join between everything upstream — the assembled document, the
 * style the design interview produced, and the edition details the user gave —
 * and the typesetter. It is deliberately pure: it returns a string, so the
 * whole export can be asserted in tests without a TeX installation, which is
 * the only part of the pipeline that cannot run here.
 *
 * The compile itself lives behind `TexEngine` (see ./tex-engine), so a browser
 * TeX that turns out not to work can be swapped without touching any of this.
 */
import type {
  FrontMatterFields,
  KdpValidationReport,
  PerBookConfig,
  StyleProfile,
  TocEntry
} from '@core/model'
import type { BookDocument } from '@core/assemble'
import { emitAsides, emitBody, tocFromDocument, validateKdp } from '@core/typeset'
import { resolveOrnamentPaths, BUILTIN_ORNAMENTS } from '@core/ornament'
import { buildLatexDocument } from '@core/typeset'

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
  /** Directory the converted ornament PDFs will sit in at compile time. */
  ornamentDir?: string
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
  /** Complete, compilable XeLaTeX source. */
  tex: string
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

/**
 * TOC entries for the document. `outputOffset` is carried through the type but
 * is meaningless here — the native `\tableofcontents` resolves real page
 * numbers during the TeX run, so nothing downstream reads these two fields.
 */
function tocEntries(document: BookDocument): TocEntry[] {
  return tocFromDocument(document).map((c) => ({
    title: c.title,
    level: c.level,
    outputOffset: 0,
    pageNumber: null
  }))
}

/** Empty strings mean "not given" for these fields, not "given as blank". */
function trimmedOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/**
 * Fold the identity gate's answers and the export gate's answers into the
 * edition details. Kept here rather than in the wizard so the mapping lives
 * next to the thing that consumes it.
 */
export function editionFromAnswers(
  identity: Record<string, unknown>,
  exportAnswers: Record<string, unknown>
): EditionDetails {
  const originalYear = trimmedOrNull(identity['originalYear'])
  const notices: string[] = []
  if (exportAnswers['publicDomainNotice'] !== false) {
    notices.push(publicDomainNotice(originalYear))
  }

  return {
    title: trimmedOrNull(identity['title']) ?? 'Untitled',
    author: trimmedOrNull(identity['author']) ?? '',
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

  const config: PerBookConfig = {
    title: edition.title,
    author: edition.author,
    isbn: edition.isbn,
    editionDate: edition.editionDate,
    trimSize: profile.trimSize
  }

  const frontMatter: FrontMatterFields = {
    isbn: edition.isbn,
    publicationDate: edition.editionDate,
    editionStatement: edition.editionStatement,
    imprint: edition.imprint,
    copyrightHolder: edition.copyrightHolder,
    notices: edition.notices
  }

  // Asides (dedication, epigraph) belong in the front matter, ahead of the
  // body, which is why they are emitted separately and joined here.
  const asides = emitAsides(document)
  const body = emitBody(document, {
    dropCap: profile.dropCap,
    chapterOrnament: profile.ornaments.chapterOpener !== null,
    omitOrphanFootnotes: input.omitOrphanFootnotes
  })
  const bodyLatex = asides ? `${asides}\n\n${body}` : body

  const tex = buildLatexDocument({
    profile,
    config,
    frontMatter,
    toc: tocEntries(document),
    bodyLatex,
    // Only reference ornament *files* when a caller says where they will be.
    // The default export hands over a lone `.tex`, so pointing it at converted
    // PDFs nobody has produced would just make the document fail to compile;
    // `buildLatexDocument` draws the ornament typographically instead.
    ...(input.ornamentDir
      ? {
          ornamentPaths: resolveOrnamentPaths(
            profile.ornaments,
            BUILTIN_ORNAMENTS,
            input.ornamentDir
          )
        }
      : {})
  })

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
    const dropped = input.typeset.notesDropped ?? []
    if (placed > 0) {
      notes.push(`${placed} footnote(s) were set at the foot of the page they belong to.`)
    }
    if (dropped.length > 0) {
      notes.push(
        `${dropped.length} footnote(s) could not be placed — ${dropped[0]!.reason}. ` +
          'They are in the source text but not in the PDF.'
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
    tex,
    fileName: safeFileName(edition.title, 'tex'),
    validation,
    notes
  }
}
