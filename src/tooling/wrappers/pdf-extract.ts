/**
 * pdftoppm wrapper — render PDF pages to images (SPEC §3 "Extract pages").
 *
 * pdftoppm writes `<prefix>-<n>.png` for each page. We default to 300 DPI (KDP
 * print target, SPEC §6 DPI awareness). Command construction is the testable
 * part; argv is verified by a mock runner.
 */
import * as path from 'node:path'
import { runCommand, type CommandRunner } from '../process'

export interface ExtractPagesOptions {
  /** Render resolution in DPI. Default 300 (KDP print target). */
  dpi?: number
  /** Output image format. Default 'png'. */
  format?: 'png' | 'jpeg' | 'tiff'
  /** Filename prefix (without extension) for generated images. Default 'page'. */
  prefix?: string
  /** First page to render (1-based, inclusive). */
  firstPage?: number
  /** Last page to render (1-based, inclusive). */
  lastPage?: number
}

const FORMAT_FLAG: Record<NonNullable<ExtractPagesOptions['format']>, string> = {
  png: '-png',
  jpeg: '-jpeg',
  tiff: '-tiff'
}

const FORMAT_EXT: Record<NonNullable<ExtractPagesOptions['format']>, string> = {
  png: 'png',
  jpeg: 'jpg',
  tiff: 'tif'
}

/** Build the argv for a pdftoppm extraction (exported for testability). */
export function buildExtractArgs(
  pdfPath: string,
  outPrefix: string,
  opts: ExtractPagesOptions = {}
): string[] {
  const dpi = opts.dpi ?? 300
  const format = opts.format ?? 'png'
  const args = [FORMAT_FLAG[format], '-r', String(dpi)]
  if (typeof opts.firstPage === 'number') args.push('-f', String(opts.firstPage))
  if (typeof opts.lastPage === 'number') args.push('-l', String(opts.lastPage))
  args.push(pdfPath, outPrefix)
  return args
}

/**
 * Render PDF pages into `outDir` via pdftoppm. Returns the predicted list of
 * generated image paths.
 *
 * pdftoppm zero-pads the page number to the width of the highest page number;
 * when the page count is unknown we can't predict the exact filenames, so a
 * `pageCount` (from `pdfPageCount`) should be supplied via opts.lastPage or the
 * caller derives names from the actual directory listing. Here we return paths
 * for pages [firstPage..lastPage] when both are known, else an empty list (the
 * caller can list `outDir`).
 */
export async function extractPages(
  pdfPath: string,
  outDir: string,
  opts: ExtractPagesOptions = {},
  run: CommandRunner = runCommand
): Promise<string[]> {
  const prefix = opts.prefix ?? 'page'
  const outPrefix = path.join(outDir, prefix)
  const args = buildExtractArgs(pdfPath, outPrefix, opts)
  await run('pdftoppm', args)

  const format = opts.format ?? 'png'
  const ext = FORMAT_EXT[format]
  const first = opts.firstPage ?? 1
  const last = opts.lastPage
  if (typeof last !== 'number') return []

  // pdftoppm pads page numbers to the width of `last`.
  const width = String(last).length
  const paths: string[] = []
  for (let p = first; p <= last; p++) {
    const num = String(p).padStart(width, '0')
    paths.push(path.join(outDir, `${prefix}-${num}.${ext}`))
  }
  return paths
}

/**
 * Best-effort page count via `pdfinfo` (poppler). Optional — guarded so a
 * missing binary or unparsable output yields `null` rather than throwing.
 */
export async function pdfPageCount(
  pdfPath: string,
  run: CommandRunner = runCommand
): Promise<number | null> {
  try {
    const result = await run('pdfinfo', [pdfPath])
    if (result.code !== 0) return null
    const m = /^Pages:\s+(\d+)/m.exec(result.stdout)
    return m && m[1] ? Number(m[1]) : null
  } catch {
    return null
  }
}
