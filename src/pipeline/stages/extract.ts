/**
 * Extract stage (SPEC §3 "Extract pages") — REAL.
 *
 * Renders the source PDF's pages to images in `workDir` via the pdftoppm
 * wrapper, then seeds `ctx.document` with the page count and per-page records
 * (image paths). Page dimensions/words are filled in by the OCR stage.
 */
import type { SourceDocument, SourcePage } from '@core/model'
import { extractPages, pdfPageCount } from '@tooling/wrappers'
import type { PipelineContext, Stage } from '../stage'

const PAGE_PREFIX = 'page'

export const extractStage: Stage = {
  name: 'extract',
  async run(ctx: PipelineContext): Promise<void> {
    // Best-effort count so pdftoppm filenames are predictable; falls back to a
    // directory listing isn't needed here because the count gates the loop.
    const count = await pdfPageCount(ctx.pdfPath, ctx.run)

    const imagePaths = await extractPages(
      ctx.pdfPath,
      ctx.workDir,
      {
        dpi: 300,
        format: 'png',
        prefix: PAGE_PREFIX,
        firstPage: count ? 1 : undefined,
        lastPage: count ?? undefined
      },
      ctx.run
    )

    const pageCount = count ?? imagePaths.length
    const pages: SourcePage[] = imagePaths.map((imagePath, index) => ({
      index,
      imagePath,
      width: 0,
      height: 0,
      dpi: 300,
      words: [],
      regions: []
    }))

    const document: SourceDocument = {
      pdfPath: ctx.pdfPath,
      pageCount,
      pages
    }
    ctx.document = document
    ctx.pages = pages
  }
}
