/**
 * Markdown stage (SPEC §3 "Intermediate format: Markdown") — REAL-ish.
 *
 * Assembles the human-readable, hand-tweakable Markdown intermediate from the
 * cleaned text. This is the document handed to the review instrument (SPEC §4)
 * and later to Pandoc → XeLaTeX. For v1 it normalizes paragraph spacing; richer
 * structural rendering arrives once the structure stage is implemented.
 */
import type { PipelineContext, Stage } from '../stage'

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
    ctx.markdown = assembleMarkdown(cleaned)
  }
}
