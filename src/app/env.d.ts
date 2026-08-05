/// <reference types="vite/client" />

declare module '*?url' {
  const url: string
  export default url
}

/**
 * tesseract.js ships no types for its prebuilt ESM bundle, which is the entry
 * the browser must use (its `main` is CommonJS). The shape we rely on is
 * asserted at the import site in `@platform/browser/ocr`.
 */
declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  const Tesseract: unknown
  export default Tesseract
}
