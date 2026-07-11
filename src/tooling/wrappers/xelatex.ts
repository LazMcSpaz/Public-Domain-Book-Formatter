/**
 * XeLaTeX wrapper — typeset LaTeX to PDF (SPEC §2/§4 typeset tier).
 *
 * Runs xelatex in nonstopmode with an explicit output directory, then parses
 * the TeX log for overfull/underfull boxes and bad line breaks. Per SPEC §4
 * these surface as *quality flags* (heuristics) — never probabilities.
 */
import * as path from 'node:path'
import { runCommand, type CommandRunner } from '../process'

export interface XelatexOptions {
  /** Extra `xelatex` args appended before the tex file. */
  extraArgs?: string[]
  /**
   * How many times to run xelatex. A book needs at least two passes so the
   * table of contents, running heads, and page cross-references resolve (the
   * first pass writes `.toc`/`.aux`, later passes read them). Default 1 for
   * simple callers; the export pipeline uses 3 so TOC-induced page shifts settle.
   */
  passes?: number
}

export interface TypesetResult {
  pdfPath: string
  /** Human-readable quality warnings parsed from the log. */
  warnings: string[]
}

/** Build the xelatex argv (exported for testability). */
export function buildXelatexArgs(
  texPath: string,
  outDir: string,
  opts: XelatexOptions = {}
): string[] {
  return [
    '-interaction=nonstopmode',
    '-halt-on-error',
    `-output-directory=${outDir}`,
    ...(opts.extraArgs ?? []),
    texPath
  ]
}

/**
 * Parse overfull/underfull box and bad-break warnings out of a XeLaTeX log.
 * Exported so it can be unit-tested against fake log text without running TeX.
 */
export function parseLogWarnings(log: string): string[] {
  const warnings: string[] = []
  const lines = log.split(/\r?\n/)
  for (const line of lines) {
    if (/^(Overfull|Underfull)\s+\\[hv]box/.test(line)) {
      warnings.push(line.trim())
    } else if (/Loose|Tight\s+\\hbox/.test(line)) {
      warnings.push(line.trim())
    } else if (/^Missing character|^Font .* not found/.test(line)) {
      warnings.push(line.trim())
    }
  }
  return warnings
}

/**
 * Typeset `texPath`, writing the PDF into `outDir`. Returns the output PDF path
 * and any quality warnings parsed from the run's combined output. The log is
 * read from the runner's stdout (xelatex echoes its log to stdout under
 * nonstopmode); the actual `.log` file path is derived for callers that prefer
 * to read it from disk.
 */
export async function typeset(
  texPath: string,
  outDir: string,
  opts: XelatexOptions = {},
  run: CommandRunner = runCommand
): Promise<TypesetResult> {
  const args = buildXelatexArgs(texPath, outDir, opts)
  const passes = Math.max(1, Math.floor(opts.passes ?? 1))
  // Warnings from the LAST pass are the ones that reflect the final layout
  // (earlier passes report transient over/underfull boxes that later resolve).
  let result = await run('xelatex', args, { cwd: outDir })
  for (let i = 1; i < passes; i++) {
    result = await run('xelatex', args, { cwd: outDir })
  }

  const base = path.basename(texPath).replace(/\.tex$/i, '')
  const pdfPath = path.join(outDir, `${base}.pdf`)
  const warnings = parseLogWarnings(`${result.stdout}\n${result.stderr}`)
  return { pdfPath, warnings }
}
