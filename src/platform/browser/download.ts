/**
 * Handing a finished file to the user.
 *
 * There is no server, so "save" means a Blob and an anchor click. The object
 * URL is revoked on the next tick — before that the browser hasn't started
 * reading it, and never revoking would pin the whole file in memory, which for
 * a book-sized PDF is not a rounding error.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  // Copy into a fresh buffer: the caller's view may be onto a larger WASM heap,
  // and a Blob over that would carry the whole thing.
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName)
}

/**
 * A text file the app generated — the fact bank's two renderings.
 *
 * Separate from `downloadPdf` because these are not the deliverable and must
 * never look like it: the book is what the user came for, and these are what
 * the reading left behind.
 */
export function downloadText(contents: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([contents], { type: `${mimeType};charset=utf-8` }), fileName)
}
