/**
 * The cover arm: the outside of the book.
 *
 * The interior and the cover are one product and two problems. An interior is
 * *recovered* — everything in it was on the paper and the app's whole job is to
 * get it back without inventing. A cover is *made*: nothing on it existed
 * before, the trim of it is arithmetic KDP publishes, and the only thing the
 * original supplies is material to work from.
 *
 * So this shares the app's machinery — the question contract, the ornament
 * library, the image op stack, the font table, the DPI rule, "the preview is
 * the PDF" — and none of its recovery pipeline.
 */
export * from './geometry'
export * from './patterns'
export * from './document'
export * from './compose'
export * from './validate'
export * from './profile'
export * from './art'
export * from './interview'
