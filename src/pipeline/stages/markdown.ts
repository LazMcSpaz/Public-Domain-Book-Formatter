/**
 * Markdown stage (SPEC §3 "Intermediate format: Markdown") — REAL-ish.
 *
 * Assembles the human-readable, hand-tweakable Markdown intermediate from the
 * cleaned text. This is the document handed to the review instrument (SPEC §4)
 * and later to Pandoc → XeLaTeX. For v1 it normalizes paragraph spacing; richer
 * structural rendering arrives once the structure stage is implemented.
 *
 * Finally it re-aligns the coordinate map to this assembled text so hover-sync
 * and scroll-sync point at the right words: the map was seeded in the OCR stage
 * against a different string, and every text edit since (page joins, cleanup,
 * blank-run collapsing, trimming) has shifted offsets (see align-map.ts).
 */
import type { PipelineContext, Stage } from '../stage'
import { realignCoordinateMap } from './align-map'

/** Collapse runs of blank lines and trim trailing whitespace into clean MD. */
export function assembleMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const markdownStage: Stage = {
  name: 'markdown',
  async run(ctx: PipelineContext): Promise<void> {
    const cleaned = ctx.markdown ?? ''
    const markdown = assembleMarkdown(cleaned)
    ctx.markdown = markdown
    if (ctx.coordinateMap) {
      ctx.coordinateMap = realignCoordinateMap(ctx.pages ?? [], markdown, ctx.coordinateMap)
    }
  }
}
