/**
 * Shared shapes for the transcribe stage.
 *
 * `OcrWordLike` is the minimum the verification layer needs from OCR, declared
 * structurally so `core` never has to import the browser OCR adapter.
 */
export interface OcrWordLike {
  text: string
  /** 0–100, a real engine probability (SPEC §4). */
  confidence: number
  /**
   * The word's stable id, where the caller has one.
   *
   * Optional because the checks never needed it and `core` must not require
   * the browser's `OcrWord` shape. But a discrepancy the user is asked about
   * has to be *shown*, and the id is what turns "a word is missing" into a
   * crop of the pixels it was read from — the difference between naming a
   * suspect and pointing at one.
   */
  id?: string
}
