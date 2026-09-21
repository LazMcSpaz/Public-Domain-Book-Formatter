/**
 * Cleaning a page before Tesseract reads it — the choice of ops, as a pure
 * function of the page's own tones.
 *
 * Recon renders a leaf at 300 DPI and hands the canvas straight to the OCR
 * engine. Every mature scan pipeline does its cheapest quality work at
 * exactly that point, and the ops for it were already here (`./engine`),
 * wired only to illustrations. This module chooses them; the platform
 * applies them (`platform/browser/cleanup.ts`); and which preset is the
 * default is decided by measurement, not by this file — see
 * `docs/LEDGER-page-cleanup.md`, and `DEFAULT_CLEANUP` below, which carries
 * the ledger's answer and nothing else.
 *
 * Two rules, both from `docs/PLAN-page-cleanup.md` and both testable:
 *
 * - **The cleaned image is for the OCR engine and nothing else.** Crops,
 *   thumbnails, illustration detection and every piece of evidence a person
 *   sees come from the original render. A cleaned page is an opinion about
 *   the paper; the paper is the evidence.
 * - **No geometry.** No preset may change a page's size, so every word box
 *   stays in original-page pixels. `sizeAfterOps` over each preset is the
 *   test, and the platform refuses a cleaned canvas whose size differs.
 *
 * Tones are read off a luminance histogram of the leaf, so cream, grey and
 * foxed paper all land on the same white: `levels` is anchored to the leaf's
 * own paper and ink rather than to fixed numbers, which is what makes one
 * preset fit a shelf of scans made by different hands. A leaf whose
 * histogram has no spread — a blank, or a photograph — gets no levels at all
 * rather than a stretch that would manufacture contrast out of noise.
 */
import type { ImageEditOp } from '@core/model'
import { despeckle, grayscale, levels, threshold } from './engine/ops'

export const CLEANUP_PRESETS = ['off', 'gentle', 'gentle+despeckle', 'binarise'] as const
export type CleanupPreset = (typeof CLEANUP_PRESETS)[number]

/**
 * What recon does unless told otherwise.
 *
 * `off` until the ledger says a preset beats it — and only the ledger may
 * change this, with the numbers beside the choice. A preset that wins in
 * aggregate and loses on one book is a preset that loses.
 */
export const DEFAULT_CLEANUP: CleanupPreset = 'off'

export function parseCleanupPreset(raw: unknown): CleanupPreset | null {
  return CLEANUP_PRESETS.find((p) => p === raw) ?? null
}

/** The leaf's own paper and ink, as luminance 0–255. */
export interface PageTones {
  paper: number
  ink: number
}

/** Percentile of the histogram that stands for ink: inside the strokes, past their soft edges. */
export const INK_PERCENTILE = 0.02
/** Percentile that stands for paper: most of a text page is paper, so well up the histogram. */
export const PAPER_PERCENTILE = 0.85
/**
 * The least spread between the two before levels are worth applying.
 *
 * A blank leaf has ink and paper a few values apart, and stretching that to
 * 0–255 turns scanner noise into speckle. A photograph or a plate is the
 * same case for the opposite reason: its histogram is continuous and there
 * is no paper to anchor to.
 */
export const MIN_TONE_SPREAD = 40

/**
 * Read the paper and ink tones off a 256-bin luminance histogram.
 *
 * Percentiles rather than peaks, because a histogram of scanned type has one
 * peak (the paper) and a long tail (the ink) with no second peak to find.
 * Returns null when the leaf has no spread worth anchoring to.
 */
export function pageTones(histogram: ArrayLike<number>): PageTones | null {
  const bins = Math.min(256, histogram.length)
  let total = 0
  for (let i = 0; i < bins; i++) total += histogram[i] ?? 0
  if (total <= 0) return null
  const at = (share: number): number => {
    const target = share * total
    let seen = 0
    for (let i = 0; i < bins; i++) {
      seen += histogram[i] ?? 0
      if (seen >= target) return i
    }
    return bins - 1
  }
  const ink = at(INK_PERCENTILE)
  const paper = at(PAPER_PERCENTILE)
  if (paper - ink < MIN_TONE_SPREAD) return null
  return { paper, ink }
}

/**
 * The ops a preset applies to a leaf with these tones.
 *
 * `off` is today's behaviour, byte for byte: an empty list, so nothing is
 * even cloned. The others start from grayscale — Tesseract reads luminance —
 * and anchor levels to the leaf where it has tones to anchor to. Binarising
 * is here to be measured and is not expected to win: Tesseract binarises
 * internally, and pre-thresholding usually costs it.
 */
export function cleanupOps(preset: CleanupPreset, tones: PageTones | null): ImageEditOp[] {
  if (preset === 'off') return []
  const ops: ImageEditOp[] = [grayscale()]
  if (tones) ops.push(levels({ black: tones.ink, white: tones.paper, gamma: 1 }))
  if (preset === 'gentle+despeckle') ops.push(despeckle(1))
  if (preset === 'binarise') {
    // After levels the paper is at 255 and the ink at 0, so the midpoint is
    // the honest cut; without tones the leaf's own midpoint is all there is.
    ops.push(threshold(tones ? 128 : 128))
  }
  return ops
}
