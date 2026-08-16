/**
 * Deterministic verification of a transcribed page.
 *
 * The design rule here is the important one: **no model ever decides whether
 * its own work was good enough.** A model's confidence is not a reliable error
 * detector — the dangerous failures are the confident ones, and asking for a
 * second opinion from the same model reproduces them (same prior, same pixels,
 * correlated blind spots).
 *
 * So escalation is driven by evidence that cannot lie, all of it free because
 * OCR already ran:
 *
 *   - **Dropped text** — the worst class, because it is silent and catastrophic.
 *     Caught by comparing the transcription's word count against OCR's for the
 *     same page.
 *   - **Hallucination** — text with no corresponding OCR anchor, i.e. the model
 *     "smoothed" a damaged passage by inventing words.
 *   - **Disagreement at confident spots** — a word OCR read with high confidence
 *     that the transcription does not contain at all.
 *   - **Structure anomalies** — a footnote with no reference, chapter numbers
 *     out of order.
 *
 * Pure: no model calls, no I/O.
 */
import type { OcrWordLike } from './types'
import type { PageTranscription } from './schema'
import { transcriptionText } from './schema'

export type VerificationCode =
  // Per-page, from the OCR cross-check.
  | 'text-dropped'
  | 'text-added'
  | 'confident-word-missing'
  | 'orphan-footnote'
  | 'empty-page'
  // Cross-page — see `verify-book.ts`. These need more than one page to see,
  // which is why they live apart and why nothing caught them before.
  | 'seam-broken'
  | 'duplicate-page'
  | 'furniture-missing'

export type Severity = 'high' | 'medium' | 'low'

export interface VerificationFinding {
  code: VerificationCode
  severity: Severity
  pageIndex: number
  /** Plain-language explanation shown in the review gate. */
  message: string
  /** Words this finding points at, for the review evidence. */
  words?: string[]
}

export interface VerifyOptions {
  /**
   * Fractional shortfall in words before a page is flagged as dropping text.
   * Default 0.15 — a transcription 15% shorter than OCR saw is suspicious.
   * Reflow and de-hyphenation legitimately change counts a little, so a small
   * band is expected.
   */
  dropThreshold?: number
  /** Fractional excess before a page is flagged as adding text. Default 0.25. */
  addThreshold?: number
  /** OCR confidence above which a word is treated as reliably read. Default 88. */
  confidentAt?: number
  /** How many confident-but-missing words to tolerate. Default 3. */
  missingTolerance?: number
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter((w) => w.length > 0)
}

/**
 * Check one transcribed page against what OCR independently saw.
 * Returns findings ordered most severe first.
 */
export function verifyPage(
  page: PageTranscription,
  ocrWords: readonly OcrWordLike[],
  options: VerifyOptions = {}
): VerificationFinding[] {
  const dropThreshold = options.dropThreshold ?? 0.15
  const addThreshold = options.addThreshold ?? 0.25
  const confidentAt = options.confidentAt ?? 88
  const missingTolerance = options.missingTolerance ?? 3

  const findings: VerificationFinding[] = []
  const transcribed = words(transcriptionText(page))
  const ocrTokens = ocrWords
    .map((w) => w.text)
    .flatMap((t) => words(t))
    .filter((w) => w.length > 0)

  // Pages that are legitimately empty or pure furniture have nothing to check.
  const meaningfulOcr = ocrTokens.length
  const isDiscardable = page.role === 'blank' || page.role === 'plate'

  if (!isDiscardable && meaningfulOcr >= 20 && transcribed.length === 0) {
    findings.push({
      code: 'empty-page',
      severity: 'high',
      pageIndex: page.pageIndex,
      message: `Nothing was transcribed, but OCR read ${meaningfulOcr} words on this page.`
    })
    return findings
  }

  if (!isDiscardable && meaningfulOcr >= 20) {
    const ratio = transcribed.length / meaningfulOcr

    if (ratio < 1 - dropThreshold) {
      const pct = Math.round((1 - ratio) * 100)
      findings.push({
        code: 'text-dropped',
        severity: pct > 35 ? 'high' : 'medium',
        pageIndex: page.pageIndex,
        message:
          `The transcription is ${pct}% shorter than what OCR read ` +
          `(${transcribed.length} words vs ${meaningfulOcr}). Text may have been dropped.`
      })
    } else if (ratio > 1 + addThreshold) {
      const pct = Math.round((ratio - 1) * 100)
      findings.push({
        code: 'text-added',
        severity: 'medium',
        pageIndex: page.pageIndex,
        message:
          `The transcription is ${pct}% longer than what OCR read ` +
          `(${transcribed.length} words vs ${meaningfulOcr}). Text may have been invented.`
      })
    }
  }

  // Words OCR was confident about that never appear in the transcription.
  const transcribedSet = new Set(transcribed)
  const missing = ocrWords
    .filter((w) => w.confidence >= confidentAt)
    .map((w) => words(w.text)[0])
    .filter((w): w is string => Boolean(w) && w.length > 3)
    .filter((w) => !transcribedSet.has(w))

  const uniqueMissing = [...new Set(missing)]
  if (uniqueMissing.length > missingTolerance) {
    findings.push({
      code: 'confident-word-missing',
      severity: uniqueMissing.length > missingTolerance * 3 ? 'high' : 'low',
      pageIndex: page.pageIndex,
      message:
        `${uniqueMissing.length} words OCR read clearly are absent from the ` + `transcription.`,
      words: uniqueMissing.slice(0, 12)
    })
  }

  // A footnote block with no marker can't be re-linked to its reference.
  const orphanNotes = page.blocks.filter((b) => b.kind === 'footnote' && !b.marker)
  if (orphanNotes.length > 0) {
    findings.push({
      code: 'orphan-footnote',
      severity: 'low',
      pageIndex: page.pageIndex,
      message: `${orphanNotes.length} footnote(s) have no reference marker to link back to.`
    })
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * Which pages warrant a second, more expensive look.
 *
 * Deliberately NOT "pages the model said it was unsure about" — that would let
 * a confidently wrong page slip through untouched. A page is re-examined when
 * deterministic evidence says something is off, or when the model reported
 * genuine uncertainty (that signal is additive, never the sole gate).
 */
export function pagesNeedingReview(
  findings: readonly VerificationFinding[],
  transcriptions: readonly PageTranscription[]
): number[] {
  const flagged = new Set<number>()
  for (const f of findings) {
    if (f.severity === 'high' || f.severity === 'medium') flagged.add(f.pageIndex)
  }
  for (const page of transcriptions) {
    if (page.uncertain.length > 0) flagged.add(page.pageIndex)
  }
  return [...flagged].sort((a, b) => a - b)
}

/** Book-level summary for the review gate header. */
export function summarize(
  findings: readonly VerificationFinding[],
  pageCount: number
): { high: number; medium: number; low: number; cleanPages: number } {
  const counts = { high: 0, medium: 0, low: 0 }
  const touched = new Set<number>()
  for (const f of findings) {
    counts[f.severity]++
    touched.add(f.pageIndex)
  }
  return { ...counts, cleanPages: Math.max(0, pageCount - touched.size) }
}
