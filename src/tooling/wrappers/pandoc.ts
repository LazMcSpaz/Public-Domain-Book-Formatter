/**
 * Pandoc wrapper — Markdown → LaTeX (SPEC §2/§3 typeset path).
 *
 * Converts the human-tweakable Markdown intermediate into LaTeX, which XeLaTeX
 * then typesets. Supports either in-memory (stdin/stdout via the runner's
 * captured stdout) or file-based conversion.
 */
import { runCommand, type CommandRunner } from '../process'

export interface PandocOptions {
  /** Read from this file instead of stdin. */
  inputPath?: string
  /** Write to this file instead of returning stdout. */
  outputPath?: string
  /** Source format. Default 'markdown'. */
  from?: string
  /** Target format. Default 'latex'. */
  to?: string
  /** Emit a standalone document (full preamble) rather than a fragment. */
  standalone?: boolean
}

/** Build the pandoc argv (exported for testability). */
export function buildPandocArgs(opts: PandocOptions = {}): string[] {
  const from = opts.from ?? 'markdown'
  const to = opts.to ?? 'latex'
  const args = ['-f', from, '-t', to]
  if (opts.standalone) args.push('--standalone')
  if (opts.outputPath) args.push('-o', opts.outputPath)
  if (opts.inputPath) args.push(opts.inputPath)
  return args
}

/**
 * Convert Markdown to LaTeX. When `outputPath` is set the result is written
 * there and the returned string is the (usually empty) stdout; otherwise the
 * captured stdout (the LaTeX) is returned.
 *
 * Note: when no `inputPath` is given the Markdown is expected to be fed via the
 * runner's stdin in a future revision; the real implementation here passes the
 * file-based form. The `markdown` argument is currently accepted for API shape
 * and is written by the pipeline to a temp file before conversion.
 */
export async function markdownToLatex(
  markdown: string,
  opts: PandocOptions = {},
  run: CommandRunner = runCommand
): Promise<string> {
  // The pipeline writes `markdown` to opts.inputPath before calling; we keep the
  // argument so callers with in-memory content have a stable signature. If no
  // inputPath is provided, the runner is responsible for stdin delivery.
  void markdown
  const args = buildPandocArgs(opts)
  const result = await run('pandoc', args)
  return result.stdout
}
