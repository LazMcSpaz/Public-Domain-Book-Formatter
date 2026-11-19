/**
 * How far a checked leaf moved against the draft it was checking, and whether
 * that is worth stopping for.
 *
 * A reader is correcting a leaf, not transcribing it, so a leaf that moves far
 * either dropped something the page prints or wrote something it does not. That
 * is the one failure this whole design exists to prevent, and the count is the
 * cheapest way to see it.
 *
 * **A percentage on a small denominator is not a measurement**, which is why
 * there are two thresholds rather than one. Leaf 435 of *Isis Unveiled* Vol. I
 * is a chapter's last page — 48 words — and lifting its running head and folio
 * out of the body into `furniture`, which is exactly right, moved it four
 * words and scored −8.3%: louder than leaf 254's thirty-five and leaf 255's
 * fifty, both of which were real and both of which needed looking at. Leaf 310
 * did the same thing earlier at nine words and 8.1%.
 *
 * So the proportion decides what is **reported** and the absolute count decides
 * what **blocks**. Below the floor a leaf still prints its drift and still
 * appears in the list of things worth an eye — the guard reports rather than
 * refuses, which is the rule this file is held to everywhere else — but it does
 * not stop a batch on four words.
 *
 * The floor is set at a sentence. What the block is for is a dropped or
 * invented *passage*, and the shortest of those in this book is a sentence of
 * twelve or fifteen words; anything under that on a leaf short enough to score
 * five per cent is furniture moving or an OCR speck being deleted. On a leaf of
 * ordinary length the floor never binds, because twelve words of a 500-word
 * leaf is 2.4% and the proportion has not fired anyway.
 *
 * Pure: numbers in, verdict out.
 */

/** Proportion at which a leaf's movement is worth printing. */
export const DRIFT_REPORTED = 0.05

/** Words at which that movement is worth stopping the batch for. */
export const DRIFT_BLOCKS_AT = 12

/**
 * Roles whose leaf carries a picture or nothing, so no text is expected back.
 *
 * OCR reads something off a plate (lettering in the picture, a speck) or off a
 * blank (show-through from the next leaf), so the draft has words, and a reader
 * who rightly returns no blocks scores -100%. That is the leaf read correctly,
 * not a passage lost. The same pair `isBodyPage` in
 * `src/core/transcribe/verify-book.ts` treats as carrying no text.
 */
export const PICTURE_ONLY_ROLES = ['plate', 'blank']

/** A leaf that came back with no blocks under a role that expects none. */
export function emptyByRole(page) {
  return (page.blocks ?? []).length === 0 && PICTURE_ONLY_ROLES.includes(page.role)
}

/**
 * `expectedEmpty` is `emptyByRole` of the leaf that came back. Its drift is
 * still measured and reported, but it never blocks, and `expected` says why.
 */
export function driftVerdict(was, now, { expectedEmpty = false } = {}) {
  const drift = was === 0 ? 0 : (now - was) / was
  const moved = now - was
  const reported = Math.abs(drift) > DRIFT_REPORTED
  const expected = expectedEmpty && now === 0
  return {
    drift,
    moved,
    reported,
    expected,
    blocking: reported && !expected && Math.abs(moved) >= DRIFT_BLOCKS_AT
  }
}
