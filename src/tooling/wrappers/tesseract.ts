/**
 * Tesseract wrapper — produce hOCR per page image (SPEC §2 backbone).
 *
 * Tesseract writes `<outBase>.hocr` when invoked with the `hocr` config. The
 * resulting hOCR (per-word bbox + confidence) is parsed by the core
 * `@core/hocr` `parseHocr` into `SourcePage[]` — we do NOT re-parse it here.
 */
import { runCommand, type CommandRunner } from '../process'

export interface TesseractOptions {
  /** Recognition language(s), e.g. 'eng' or 'eng+lat'. Default 'eng'. */
  language?: string
  /** Page-segmentation mode (Tesseract --psm). */
  psm?: number
}

/**
 * Build the tesseract argv for hOCR output (exported for testability).
 * Form: `tesseract <image> <outBase> [-l <lang>] [--psm N] hocr`.
 * The `hocr` config name MUST be the final positional argument.
 */
export function buildHocrArgs(
  imagePath: string,
  outBase: string,
  opts: TesseractOptions = {}
): string[] {
  const args = [imagePath, outBase]
  if (opts.language) args.push('-l', opts.language)
  if (typeof opts.psm === 'number') args.push('--psm', String(opts.psm))
  args.push('hocr')
  return args
}

/**
 * Run Tesseract to emit `<outBase>.hocr` for one page image. Returns the path
 * to the generated `.hocr` file.
 */
export async function ocrToHocr(
  imagePath: string,
  outBase: string,
  opts: TesseractOptions = {},
  run: CommandRunner = runCommand
): Promise<string> {
  const language = opts.language ?? 'eng'
  const args = buildHocrArgs(imagePath, outBase, { ...opts, language })
  await run('tesseract', args)
  return `${outBase}.hocr`
}
