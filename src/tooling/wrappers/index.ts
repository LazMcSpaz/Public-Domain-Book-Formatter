/** Binary-wrapper public surface (SPEC §2 tool chain). */
export {
  extractPages,
  pdfPageCount,
  buildExtractArgs,
  type ExtractPagesOptions
} from './pdf-extract'
export { runOcr, buildOcrArgs, type OcrmypdfArgs } from './ocrmypdf'
export { ocrToHocr, buildHocrArgs, type TesseractOptions } from './tesseract'
export { markdownToLatex, buildPandocArgs, type PandocOptions } from './pandoc'
export {
  typeset,
  buildXelatexArgs,
  parseLogWarnings,
  type XelatexOptions,
  type TypesetResult
} from './xelatex'
export { svgToPdf, buildSvg2PdfArgs } from './svg2pdf'
