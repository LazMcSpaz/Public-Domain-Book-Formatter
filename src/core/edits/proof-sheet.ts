/**
 * What to put in front of someone proofreading a scan.
 *
 * Proofing a book is not a question the app can ask, so this is not a
 * `Question[]` — it is a workbench, the same concession SPEC §6 makes for
 * images when it calls the editing mode "the real instrument". But the two
 * decisions that shape it are still logic, and still belong in the pure core:
 * *what is on each leaf*, and *which leaves are worth looking at first*.
 *
 * The unit is the **source page**, not the finished page and not the whole
 * book. Three reasons, and they agree:
 *
 *   - it is how proofing is actually done — the scan on one side, what was read
 *     off it on the other, one leaf at a time;
 *   - the finished pages do not correspond to anything the user can check
 *     against, because this edition repaginates;
 *   - a three-hundred-page book is thousands of blocks, and a screen that tried
 *     to show them all would be unusable long before it was slow.
 *
 * Pure: grouping and sorting. No DOM.
 */
import type { BookBlock, BookDocument } from '@core/assemble'
import type { VerificationFinding } from '@core/transcribe'

/** One block as it appears on the proof sheet. */
export interface ProofBlock {
  block: BookBlock
  /**
   * Other pages this block's text also came from. Non-empty when a paragraph
   * was joined across a seam, which is worth showing: the text on screen will
   * run past what the scan beside it shows, and that is correct rather than a
   * mistake to be edited out.
   */
  alsoFromPages: number[]
}

/** One source page, and everything the pass read off it. */
export interface ProofPage {
  pageIndex: number
  blocks: ProofBlock[]
  /** Illustrations cut from this page, so they can be re-anchored from here. */
  illustrationIds: string[]
  /**
   * Why this page is worth a look, in plain language. Empty means nothing
   * flagged it — which is not a promise that it is right, only that no
   * cross-check disagreed.
   */
  flags: string[]
}

export interface ProofSheetInput {
  document: BookDocument
  /** Deterministic cross-checks against OCR. */
  findings?: readonly VerificationFinding[]
  /** Spans the model itself reported as unreadable. */
  uncertainties?: readonly { pageIndex: number; text: string }[]
  /** Pages the user already looked at and accepted at the uncertainty gate. */
  reviewedPages?: readonly number[]
}

/**
 * Group the book by the leaf it was read from, flagging what to check first.
 *
 * Every page that produced text appears, whether or not anything flagged it.
 * That is the point of having this at all: the flagged pages are where the app
 * *suspects* a problem, and the whole reason this feature exists is that a
 * misreading both witnesses agree on raises no flag at all.
 */
export function proofSheet(input: ProofSheetInput): ProofPage[] {
  const { document: doc } = input

  const byPage = new Map<number, ProofBlock[]>()
  for (const block of doc.blocks) {
    const [first, ...rest] = block.sourcePages
    if (first === undefined) continue
    const list = byPage.get(first) ?? []
    list.push({ block, alsoFromPages: rest })
    byPage.set(first, list)
  }

  const picturesByPage = new Map<number, string[]>()
  for (const illustration of doc.illustrations) {
    const list = picturesByPage.get(illustration.pageIndex) ?? []
    list.push(illustration.id)
    picturesByPage.set(illustration.pageIndex, list)
  }

  // A page with only a picture on it still has to be reachable, or a plate
  // could never be re-anchored.
  const pageIndexes = [...new Set([...byPage.keys(), ...picturesByPage.keys()])].sort(
    (a, b) => a - b
  )

  const reviewed = new Set(input.reviewedPages ?? [])
  const flagsByPage = new Map<number, string[]>()
  const flag = (pageIndex: number, message: string): void => {
    // Already looked at and accepted: re-flagging it would send the user back
    // over ground they have covered, which is how a proofing pass stops being
    // read at all.
    if (reviewed.has(pageIndex)) return
    const list = flagsByPage.get(pageIndex) ?? []
    if (!list.includes(message)) list.push(message)
    flagsByPage.set(pageIndex, list)
  }

  for (const finding of input.findings ?? []) {
    if (finding.severity === 'low') continue
    flag(finding.pageIndex, finding.message)
  }
  for (const uncertain of input.uncertainties ?? []) {
    flag(uncertain.pageIndex, `Couldn’t read “${uncertain.text}”`)
  }

  return pageIndexes.map((pageIndex) => ({
    pageIndex,
    blocks: byPage.get(pageIndex) ?? [],
    illustrationIds: picturesByPage.get(pageIndex) ?? [],
    flags: flagsByPage.get(pageIndex) ?? []
  }))
}

/**
 * The next page after `from` that something flagged, wrapping to the start.
 *
 * Wrapping rather than stopping at the end, because someone who has worked
 * through the flagged pages out of order should not have to guess which ones
 * they missed. Returns null when nothing is flagged anywhere.
 */
export function nextFlaggedPage(pages: readonly ProofPage[], from: number): number | null {
  const flagged = pages.filter((p) => p.flags.length > 0)
  if (flagged.length === 0) return null
  return (flagged.find((p) => p.pageIndex > from) ?? flagged[0]!).pageIndex
}
