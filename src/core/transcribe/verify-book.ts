/**
 * Cross-checks that need more than one page to see.
 *
 * `verifyPage` compares a page against the OCR of *that page* and catches a
 * great deal — dropped text, invented text, a confident word gone missing. What
 * it structurally cannot see is anything that only looks wrong beside its
 * neighbours, and that is where the classic scan failures live:
 *
 * - a paragraph that stops mid-sentence at the foot of one page and does not
 *   continue at the head of the next, because a leaf was missed, mis-ordered,
 *   or read twice;
 * - a page whose running head or folio was swallowed into the body, which is
 *   invisible on that page and obvious against the forty pages around it;
 * - a chapter opening detected everywhere except once.
 *
 * These are all *deterministic* comparisons over what came back, not the
 * model's opinion of its own work — the honest-flag rule in SPEC §4. A finding
 * here is evidence that two pages disagree, which is worth a human's glance
 * exactly as an OCR disagreement is.
 *
 * Pure: transcriptions in, findings out.
 */
import type { PageTranscription } from './schema'
import { transcriptionText } from './schema'
import type { Severity, VerificationFinding } from './verify'

/** Endings that make a paragraph look finished. */
const SENTENCE_END = /[.!?…:;”’")\]]\s*$/u

/** A page with nothing on it cannot break a seam. */
function isBodyPage(page: PageTranscription): boolean {
  return page.role !== 'blank' && page.role !== 'plate' && page.blocks.length > 0
}

/**
 * Kinds that are not running text, and so say nothing about a seam.
 *
 * A note sits at the foot of the page under the text it belongs to, a caption
 * under its picture, and a table is columns rather than sentences — none of the
 * three ends a paragraph, so judging the seam by one would flag every page that
 * happens to close with a footnote.
 */
const NOT_FLOW = new Set(['footnote', 'caption', 'table'])

/** The last block that carries running text. */
function lastFlowBlock(page: PageTranscription): string | null {
  for (let i = page.blocks.length - 1; i >= 0; i--) {
    const block = page.blocks[i]!
    if (NOT_FLOW.has(block.kind)) continue
    return block.text.trim()
  }
  return null
}

function firstFlowBlock(page: PageTranscription): { text: string; kind: string } | null {
  for (const block of page.blocks) {
    if (NOT_FLOW.has(block.kind)) continue
    return { text: block.text.trim(), kind: block.kind }
  }
  return null
}

export interface VerifyBookOptions {
  /**
   * How many pages must carry a running head before its absence is a finding.
   *
   * A book with no running heads at all must not produce one finding per page;
   * the check is for the *odd one out*, so it only speaks when the habit is
   * well established.
   */
  furnitureQuorum?: number
}

/**
 * Compare the pages against each other.
 *
 * Ordered by page, and every finding names what it compared so the reviewer can
 * judge it rather than take it on trust.
 */
export function verifyBook(
  transcriptions: readonly PageTranscription[],
  options: VerifyBookOptions = {}
): VerificationFinding[] {
  const quorum = options.furnitureQuorum ?? 0.6
  const findings: VerificationFinding[] = []
  const pages = [...transcriptions].sort((a, b) => a.pageIndex - b.pageIndex)

  // --- seams ---------------------------------------------------------------
  const body = pages.filter(isBodyPage)
  for (let i = 0; i < body.length - 1; i++) {
    const here = body[i]!
    const next = body[i + 1]!
    const tail = lastFlowBlock(here)
    const head = firstFlowBlock(next)
    if (!tail || !head) continue

    // A page ending mid-sentence should run into a page starting mid-sentence.
    // A heading on the far side is the legitimate exception — a chapter can
    // begin after a page that ran out of room mid-clause only if the book put
    // the break there, which a heading is the evidence for.
    const unfinished = tail.length > 0 && !SENTENCE_END.test(tail)
    const startsFresh = head.kind === 'heading' || /^[“"'(\p{Lu}]/u.test(head.text)
    if (unfinished && startsFresh && head.kind !== 'heading') {
      findings.push({
        code: 'seam-broken',
        severity: 'medium',
        pageIndex: next.pageIndex,
        message:
          `Page ${here.pageIndex + 1} stops mid-sentence but page ${next.pageIndex + 1} ` +
          'starts a new one. A leaf may be missing, out of order, or read twice.',
        words: [tail.slice(-40), head.text.slice(0, 40)]
      })
    }
  }

  // --- a page read twice ---------------------------------------------------
  const seen = new Map<string, number>()
  for (const page of body) {
    const text = transcriptionText(page).replace(/\s+/gu, ' ').trim()
    // Short pages repeat innocently; only a substantial page is suspicious.
    if (text.length < 200) continue
    const first = seen.get(text)
    if (first !== undefined) {
      findings.push({
        code: 'duplicate-page',
        severity: 'high',
        pageIndex: page.pageIndex,
        message:
          `Page ${page.pageIndex + 1} came back word for word identical to page ${first + 1}. ` +
          'The same leaf was probably read twice.'
      })
    } else {
      seen.set(text, page.pageIndex)
    }
  }

  // --- furniture that went missing on one page -----------------------------
  const withHead = body.filter((p) => (p.furniture.runningHead ?? '').trim().length > 0)
  if (body.length >= 5 && withHead.length >= body.length * quorum) {
    for (const page of body) {
      if ((page.furniture.runningHead ?? '').trim().length > 0) continue
      findings.push({
        code: 'furniture-missing',
        severity: 'low',
        pageIndex: page.pageIndex,
        message:
          `${withHead.length} of ${body.length} pages carry a running head; this one does not. ` +
          'It may have been read as part of the text.'
      })
    }
  }

  const withFolio = body.filter((p) => (p.furniture.folio ?? '').trim().length > 0)
  if (body.length >= 5 && withFolio.length >= body.length * quorum) {
    for (const page of body) {
      if ((page.furniture.folio ?? '').trim().length > 0) continue
      findings.push({
        code: 'furniture-missing',
        severity: 'low',
        pageIndex: page.pageIndex,
        message:
          `${withFolio.length} of ${body.length} pages carry a page number; this one does not. ` +
          'It may have been read as part of the text.'
      })
    }
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.pageIndex - b.pageIndex)
}
