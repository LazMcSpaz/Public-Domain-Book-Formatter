/**
 * OCRmyPDF wrapper — produce a searchable PDF (SPEC §2/§3).
 *
 * OCRmyPDF wraps Tesseract and handles deskew/preprocessing, emitting a
 * searchable PDF plus an optional plain-text sidecar. Note: the per-word hOCR
 * with bounding boxes that powers the coordinate map (SPEC §2 backbone) is
 * obtained by invoking Tesseract directly per page-image (see ./tesseract.ts) —
 * OCRmyPDF here is for the searchable-PDF + sidecar path.
 */
import { runCommand, type CommandRunner } from '../process'

export interface OcrmypdfArgs {
  inputPdf: string
  outputPdf: string
  /** Write recognized text to this path as a UTF-8 sidecar. */
  sidecarTextPath?: string
  /** Tesseract language(s), e.g. 'eng' or 'eng+fra'. Default 'eng'. */
  language?: string
  /** OCRmyPDF --output-type. Default 'pdf'. */
  outputType?: 'pdf' | 'pdfa'
  /** Re-OCR pages that already contain text. */
  force?: boolean
}

/** Build the OCRmyPDF argv (exported for testability). */
export function buildOcrArgs(opts: OcrmypdfArgs): string[] {
  const language = opts.language ?? 'eng'
  const outputType = opts.outputType ?? 'pdf'
  const args = ['-l', language, '--output-type', outputType]
  if (opts.sidecarTextPath) args.push('--sidecar', opts.sidecarTextPath)
  if (opts.force) args.push('--force-ocr')
  args.push(opts.inputPdf, opts.outputPdf)
  return args
}

/** Run OCRmyPDF, producing a searchable PDF (and optional text sidecar). */
export async function runOcr(
  opts: OcrmypdfArgs,
  run: CommandRunner = runCommand
): Promise<{ outputPdf: string; sidecarTextPath: string | null }> {
  const args = buildOcrArgs(opts)
  await run('ocrmypdf', args)
  return {
    outputPdf: opts.outputPdf,
    sidecarTextPath: opts.sidecarTextPath ?? null
  }
}
