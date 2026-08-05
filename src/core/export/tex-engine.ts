/**
 * The seam between "we have LaTeX source" and "we have a PDF".
 *
 * Running TeX in a browser (SwiftLaTeX's XeTeX/WASM) is the one part of this
 * pipeline that has never been proven here — the sandbox blocks its assets. So
 * the compile is an interface with a swappable implementation rather than a
 * hard dependency: if browser TeX doesn't work out, only this file's
 * implementations change, and the export still hands the user a complete `.tex`
 * they can compile anywhere.
 *
 * This module is pure — the engine implementations are injected.
 */

export interface TexCompileInput {
  /** Complete XeLaTeX source. */
  tex: string
  /** Extra files the source references, keyed by the path used in the source. */
  assets?: Record<string, Uint8Array>
  signal?: AbortSignal
}

export interface TexCompileResult {
  pdf: Uint8Array
  /** Final interior page count — what the user needs for the cover spine. */
  pageCount: number
  /** Layout warnings lifted out of the TeX log. */
  warnings: string[]
  /** The raw log, kept so a failure can be diagnosed rather than guessed at. */
  log: string
}

export interface TexEngine {
  readonly name: string
  /** Whether this engine can run here. Checked before anything is promised. */
  available(): Promise<boolean>
  compile(input: TexCompileInput): Promise<TexCompileResult>
}

/**
 * Raised when the compile fails. Carries the log, because a TeX error without
 * its log is not actionable.
 */
export class TexCompileError extends Error {
  constructor(
    message: string,
    readonly log: string
  ) {
    super(message)
    this.name = 'TexCompileError'
  }
}

/**
 * The engine used when no TeX is available. It reports itself unavailable
 * rather than pretending — the export step then offers the `.tex` download,
 * which is a real deliverable, not a consolation prize.
 */
export const noTexEngine: TexEngine = {
  name: 'none',
  available: async () => false,
  compile: async () => {
    throw new TexCompileError(
      'No TeX engine is available in this browser. Download the .tex file and ' +
        'compile it with XeLaTeX (TeX Live, MiKTeX, or Overleaf).',
      ''
    )
  }
}

/**
 * Lift the layout complaints out of a TeX log.
 *
 * Only overfull/underfull boxes and bad page breaks are kept: they are the ones
 * that show up as a visibly ragged printed page. TeX's log is otherwise mostly
 * font and file chatter, and surfacing all of it would bury the real signal.
 */
export function parseTexLog(log: string): string[] {
  const warnings: string[] = []
  const patterns = [
    /^(Overfull|Underfull) \\[hv]box .*$/gm,
    /^LaTeX Warning: (Float too large|Text page \d+ contains only floats).*$/gm
  ]
  for (const pattern of patterns) {
    for (const match of log.matchAll(pattern)) {
      warnings.push(match[0].trim())
    }
  }
  return warnings
}

/**
 * Page count from a TeX log. XeLaTeX's final line reports it as
 * `Output written on book.pdf (123 pages, 456789 bytes).`
 */
export function pageCountFromLog(log: string): number | null {
  const match = /Output written on .*?\((\d+) pages?/.exec(log)
  return match ? Number(match[1]) : null
}

/**
 * Compile if an engine is available, otherwise report why not. Callers get one
 * shape for both paths, so the UI never has to special-case "no TeX here".
 */
export async function tryCompile(
  engine: TexEngine,
  input: TexCompileInput
): Promise<{ ok: true; result: TexCompileResult } | { ok: false; reason: string; log: string }> {
  if (!(await engine.available())) {
    return {
      ok: false,
      reason:
        'No TeX engine is available here, so the PDF can’t be built in this browser. ' +
        'The .tex file below is complete — compile it with XeLaTeX.',
      log: ''
    }
  }
  try {
    return { ok: true, result: await engine.compile(input) }
  } catch (err) {
    if (err instanceof TexCompileError) {
      return { ok: false, reason: err.message, log: err.log }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err), log: '' }
  }
}
