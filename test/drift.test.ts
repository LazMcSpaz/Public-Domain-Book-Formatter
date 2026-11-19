import { describe, it, expect } from 'vitest'
import { ALL_PAGE_ROLES } from '@core/pages'
// @ts-expect-error — a plain Node module with no types, deliberately: the rule
// lives beside the script that uses it so a change to one is a change to both.
import * as drift from '../scripts/lib/drift.mjs'

const { driftVerdict, emptyByRole, DRIFT_BLOCKS_AT, PICTURE_ONLY_ROLES } = drift

/**
 * How far a checked leaf moved against the draft it was checking.
 *
 * The reader is correcting, not transcribing, so a leaf that moves far either
 * dropped something the page prints or wrote something it does not — the one
 * failure the whole reading design exists to prevent.
 */
describe('word drift against the draft', () => {
  it('says nothing about a leaf that barely moved', () => {
    const v = driftVerdict(500, 496)
    expect(v.reported).toBe(false)
    expect(v.blocking).toBe(false)
  })

  /**
   * The three that were real, all caught before landing. Leaf 247 of *Isis
   * Unveiled* Vol. I had the HathiTrust sidebar threaded through its prose;
   * 254 and 255 the same, more faintly.
   */
  it('blocks the leaves that actually needed looking at', () => {
    for (const [was, now] of [
      [615, 521],
      [517, 482],
      [525, 475]
    ]) {
      const v = driftVerdict(was!, now!)
      expect(v.blocking, `${was} -> ${now}`).toBe(true)
    }
  })

  /**
   * **A percentage on a small denominator is not a measurement**, which is the
   * whole reason there are two thresholds. Leaf 435 is a chapter's last page —
   * 48 words — and lifting its running head and folio out of the body into
   * `furniture`, which is exactly right, moved it four words and scored −8.3%:
   * louder than leaf 254's thirty-five, which was real. Leaf 310 did the same
   * at nine words and 8.1%.
   *
   * Both are still *reported*, because silence is the worse failure and the
   * guard's job is to hand a person a list. Neither stops a batch.
   */
  it('reports a short leaf without refusing the batch for it', () => {
    for (const [was, now] of [
      [48, 44],
      [111, 102]
    ]) {
      const v = driftVerdict(was!, now!)
      expect(v.reported, `${was} -> ${now}`).toBe(true)
      expect(v.blocking, `${was} -> ${now}`).toBe(false)
    }
  })

  /**
   * The floor is a sentence, because a dropped or invented *passage* is what
   * the block is for. On a leaf of ordinary length it never binds: twelve words
   * of a 500-word leaf is 2.4%, and the proportion has not fired anyway.
   */
  it('binds only where the proportion has already fired', () => {
    expect(driftVerdict(500, 500 - DRIFT_BLOCKS_AT).reported).toBe(false)
    expect(driftVerdict(100, 100 - DRIFT_BLOCKS_AT).blocking).toBe(true)
    expect(driftVerdict(100, 100 - (DRIFT_BLOCKS_AT - 1)).blocking).toBe(false)
  })

  it('measures a leaf that grew as well as one that shrank', () => {
    expect(driftVerdict(400, 460).blocking).toBe(true)
    expect(driftVerdict(0, 40).reported).toBe(false)
  })

  /**
   * OCR reads lettering off a plate and show-through off a blank, so the draft
   * has words where the leaf prints none. A reader who rightly returns no
   * blocks scores -100%, and that is the leaf read correctly, not a passage
   * lost: it is reported, never a reason to refuse the batch.
   */
  it('expects a plate or blank leaf to come back with no blocks', () => {
    for (const role of ['plate', 'blank']) {
      const page = { role, blocks: [] }
      expect(emptyByRole(page), role).toBe(true)
      const v = driftVerdict(40, 0, { expectedEmpty: emptyByRole(page) })
      expect(v.reported, role).toBe(true)
      expect(v.expected, role).toBe(true)
      expect(v.blocking, role).toBe(false)
    }
  })

  it('still blocks a text leaf that lost every word', () => {
    const page = { role: 'body', blocks: [] }
    expect(emptyByRole(page)).toBe(false)
    expect(driftVerdict(40, 0, { expectedEmpty: emptyByRole(page) }).blocking).toBe(true)
    // A plate that came back with a caption is measured like any leaf.
    const captioned = { role: 'plate', blocks: [{ kind: 'caption', text: 'Fig. 1' }] }
    expect(emptyByRole(captioned)).toBe(false)
    expect(driftVerdict(40, 2, { expectedEmpty: emptyByRole(captioned) }).blocking).toBe(true)
  })

  it('names only roles the parser accepts', () => {
    for (const role of PICTURE_ONLY_ROLES) expect(ALL_PAGE_ROLES).toContain(role)
  })
})
