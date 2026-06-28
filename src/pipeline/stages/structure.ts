/**
 * Structure-detection stage (SPEC §3; SPEC §12 #11–12).
 *
 * Detects probable headings from layout/typography via the pure
 * `detectHeadings` heuristic, appends the low-trust
 * `{kind:'heuristic', source:'structure', label:'probable heading'}` flags to
 * the context, and seeds `ctx.tags` with candidate `heading` StructuralTags
 * (`data:{ level, confirmed:false }`). The user confirms these in review; the
 * confirmed headings feed the auto-generated TOC (SPEC §7).
 */
import type { StructuralTag } from '@core/model'
import { detectHeadings } from '@core/structure'
import type { PipelineContext, Stage } from '../stage'

export const structureStage: Stage = {
  name: 'structure',
  async run(ctx: PipelineContext): Promise<void> {
    const { candidates, flags } = detectHeadings(
      ctx.pages ?? [],
      ctx.markdown ?? '',
      ctx.coordinateMap ?? []
    )

    ctx.flags = [...(ctx.flags ?? []), ...flags]

    const tags: StructuralTag[] = candidates.map((c, n) => ({
      id: `tag_h${n}`,
      type: 'heading',
      range: { start: c.range.start, end: c.range.end },
      data: { level: c.level, confirmed: false }
    }))
    ctx.tags = [...(ctx.tags ?? []), ...tags]
  }
}
