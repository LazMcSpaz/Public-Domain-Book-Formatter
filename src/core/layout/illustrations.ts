/**
 * Where in the reading order an illustration goes.
 *
 * A footnote knows where it belongs because its marker is printed in the text.
 * An illustration has no such thread: the scan says only *which page* it was
 * printed on. That is genuinely all the information the original left behind,
 * so the rule here is the honest reading of it — a picture goes after the last
 * text that shared its page, which in the reflowed edition puts it as near to
 * its original neighbours as the new pagination allows.
 *
 * The rule is deliberately not cleverer than its evidence. Trying to infer a
 * position *within* the page — from where the region sat, or from a "see the
 * figure below" in the prose — would be guessing, and a picture confidently
 * dropped into the wrong paragraph is harder to spot than one sitting a
 * paragraph late.
 *
 * Pure: array arithmetic, no measurement and no layout.
 */
import type { BookBlock, Illustration } from '@core/assemble'

/**
 * Group illustrations by the block index they follow.
 *
 * A key of `-1` means "before the first block": a plate that came before any
 * body text on the pages that survived. Every illustration handed in comes back
 * out under exactly one key, because a picture that quietly failed to be
 * anchored would be a picture that never prints.
 */
export function anchorIllustrations(
  blocks: readonly BookBlock[],
  illustrations: readonly Illustration[]
): Map<number, Illustration[]> {
  // The last source page each block touches, scanned once. A block joined
  // across a seam carries several, and the *last* is the one that matters: the
  // block is only finished after that page, so a picture from it comes later.
  const lastPage = blocks.map((b) => Math.max(...b.sourcePages, -1))

  const anchored = new Map<number, Illustration[]>()
  for (const illustration of illustrations) {
    let after = -1
    for (let i = 0; i < blocks.length; i++) {
      if (lastPage[i]! <= illustration.pageIndex) after = i
      else break
    }
    const list = anchored.get(after) ?? []
    list.push(illustration)
    anchored.set(after, list)
  }
  return anchored
}
