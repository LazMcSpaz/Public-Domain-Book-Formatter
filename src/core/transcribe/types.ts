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
}
