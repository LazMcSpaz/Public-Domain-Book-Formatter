/**
 * Structure-detection stage (SPEC §3; SPEC §12 #11–12) — STUB.
 *
 * Candidate chapter/heading detection (confirmable in review) lands later. This
 * is a typed no-op so the pipeline ordering is fixed now.
 *
 * TODO(SPEC §12 #11–12): detect probable headings from layout/typography, emit
 * `{kind:'heuristic', source:'structure', label:'probable heading'}` flags, and
 * feed confirmed headings into the auto-generated TOC.
 */
import type { PipelineContext, Stage } from '../stage'

export const structureStage: Stage = {
  name: 'structure',
  async run(_ctx: PipelineContext): Promise<void> {
    // No-op until SPEC §12 #11–12 structure detection lands.
  },
}
