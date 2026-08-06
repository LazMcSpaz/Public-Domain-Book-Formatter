/**
 * The finished interior: the whole book, laid out and written to a PDF.
 *
 * The same three calls the preview makes, without the page limit and without
 * the rasterizing. That is deliberate — it is what "the preview is the PDF"
 * means in practice. If this function and `renderPreview` did their layout
 * differently, the gate would be approving something other than the deliverable.
 *
 * Browser-only.
 */
import type { BookDocument } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import { englishHyphenator, layout, type LayoutEdition, type LayoutWarning } from '@core/layout'
import { fontTableFor } from './fonts'
import { renderPdf } from './pdf-out'

export interface Interior {
  bytes: Uint8Array
  /** The measured page count — what the cover spine needs. */
  pageCount: number
  /** Typeface families embedded in the file. */
  embeddedFamilies: string[]
  /** Lines that would not fit their measure. */
  warnings: LayoutWarning[]
  /** Where each chapter opens, ready for a TOC with measured page numbers. */
  chapterPages: { title: string; level: number; pageIndex: number }[]
  /** Families asked for but unavailable, mapped to what was used instead. */
  substitutions: [string, string][]
}

export interface InteriorOptions {
  edition: LayoutEdition
  /** Called as pages are written, so a long book can show progress. */
  onProgress?: (done: number, total: number) => void
}

export async function renderInterior(
  doc: BookDocument,
  profile: StyleProfile,
  options: InteriorOptions
): Promise<Interior> {
  const fonts = await fontTableFor([profile.bodyFont, profile.headingFont])

  const book = layout(doc, profile, fonts, {
    edition: options.edition,
    hyphenate: englishHyphenator()
  })

  const pdf = await renderPdf(book, fonts, {
    title: options.edition.title,
    author: options.edition.author,
    ...(options.onProgress
      ? {
          onPage: (done, total) => {
            options.onProgress?.(done, total)
            // Yield to the event loop so a three-hundred-page book does not
            // freeze the tab while it is written.
            return new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
      : {})
  })

  return {
    bytes: pdf.bytes,
    pageCount: pdf.pageCount,
    embeddedFamilies: pdf.embeddedFamilies,
    warnings: book.warnings,
    chapterPages: book.chapterPages,
    substitutions: [...fonts.substitutions.entries()]
  }
}
