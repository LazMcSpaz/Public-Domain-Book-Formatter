/**
 * Image-detection stage (SPEC §6).
 *
 * Runs the pure, low-trust `detectRegions` heuristic over each page's OCR layout
 * to populate `SourcePage.regions` with candidate illustration regions
 * (`accepted: null`). Detection is explicitly a first guess; the user
 * reviews/accepts/rejects each region in the image-editing mode.
 *
 * Mirrors the OCR stage's pattern: writes the updated pages back to `ctx.pages`
 * and, if present, `ctx.document.pages`.
 */
import type { SourcePage } from '@core/model'
import { detectRegions } from '@core/image'
import type { PipelineContext, Stage } from '../stage'

export const imageDetectStage: Stage = {
  name: 'image-detect',
  async run(ctx: PipelineContext): Promise<void> {
    const pages = ctx.pages ?? []
    const updated: SourcePage[] = pages.map((page) => ({
      ...page,
      regions: detectRegions(page)
    }))

    ctx.pages = updated
    if (ctx.document) ctx.document.pages = updated
  }
}
