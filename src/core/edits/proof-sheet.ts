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
  /**
   * The user asked to come back to this page.
   *
   * Distinct from "something flagged it": this one is the editor's own to-do,
   * so it leads the flag list and survives having been reviewed.
   */
  marked: boolean
}

/**
 * A page the user themselves asked to be brought back to, and why.
 *
 * The gate before this one offers "looks fine" and "read it again"; this is the
 * third answer, the one someone gives when they can see exactly what is wrong
 * and would rather spend a minute than a re-read. It is also how a repair the
 * app could not finish gets reported instead of vanishing — the same rule that
 * governs a footnote with nowhere to go.
 */
export interface Attention {
  pageIndex: number
  message: string
}

export interface ProofSheetInput {
  document: BookDocument
  /** Deterministic cross-checks against OCR. */
  findings?: readonly VerificationFinding[]
  /** Spans the model itself reported as unreadable. */
  uncertainties?: readonly { pageIndex: number; text: string }[]
  /** Pages the user already looked at and accepted at the uncertainty gate. */
  reviewedPages?: readonly number[]
  /** Pages the user asked to be brought back to, with the reason. */
  attention?: readonly Attention[]
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

  const attention = input.attention ?? []
  const marked = new Set(attention.map((a) => a.pageIndex))

  // A page with only a picture on it still has to be reachable, or a plate
  // could never be re-anchored. A page the user marked has to be reachable for
  // the same reason: a to-do that cannot be opened is a to-do that was dropped.
  const pageIndexes = [...new Set([...byPage.keys(), ...picturesByPage.keys(), ...marked])].sort(
    (a, b) => a - b
  )

  const reviewed = new Set(input.reviewedPages ?? [])
  const flagsByPage = new Map<number, string[]>()
  const flag = (pageIndex: number, message: string): void => {
    // Already looked at and accepted: re-flagging it would send the user back
    // over ground they have covered, which is how a proofing pass stops being
    // read at all. Unless they accepted it *and asked to come back* — the two
    // are different answers, and conflating them throws away the note at
    // exactly the moment it was wanted.
    if (reviewed.has(pageIndex) && !marked.has(pageIndex)) return
    const list = flagsByPage.get(pageIndex) ?? []
    if (!list.includes(message)) list.push(message)
    flagsByPage.set(pageIndex, list)
  }

  // The user's own reason leads, because it is the only one of the three they
  // wrote themselves and the only one they are already expecting.
  for (const item of attention) flag(item.pageIndex, item.message)
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
    flags: flagsByPage.get(pageIndex) ?? [],
    marked: marked.has(pageIndex)
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
