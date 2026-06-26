/**
 * Image-detection stage (SPEC §6) — STUB.
 *
 * Layout analysis will flag candidate illustration regions (low trust) and
 * leave markers in the text flow. Not yet implemented: this is a typed no-op so
 * the pipeline shape is complete and the ordering is fixed.
 *
 * TODO(SPEC §6): run layout analysis over each page image, populate
 * `SourcePage.regions` with `ImageRegion` candidates (accepted: null), and
 * insert placement markers into the output. Detection is explicitly low-trust.
 */
import type { PipelineContext, Stage } from '../stage'

export const imageDetectStage: Stage = {
  name: 'image-detect',
  async run(_ctx: PipelineContext): Promise<void> {
    // No-op until SPEC §6 layout analysis lands.
  },
}
