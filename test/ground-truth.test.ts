import { describe, it, expect } from 'vitest'
import { leafTruth } from '@core/witness/ground-truth'
import type { BookBlock, BookDocument } from '@core/assemble'
import type { PageTranscription } from '@core/transcribe'

function leaf(
  pageIndex: number,
  texts: string[],
  extra: Partial<PageTranscription> = {}
): PageTranscription {
  return {
    pageIndex,
    role: 'body',
    blocks: texts.map((text) => ({ kind: 'paragraph', text })),
    uncertain: [],
    furniture: {},
    ...extra
  } as PageTranscription
}

function block(id: string, text: string, sourcePages: number[]): BookBlock {
  return { id, kind: 'paragraph', text, sourcePages }
}

function doc(blocks: BookBlock[], over: Partial<BookDocument> = {}): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: [],
    ...over
  }
}

const words = (t: ReturnType<typeof leafTruth>, page: number) =>
  t.find((l) => l.pageIndex === page)!.words.join(' ')

describe('a block on one leaf', () => {
  it('puts every word on that leaf', () => {
    const leaves = [leaf(0, ['The astral body is real.'])]
    const p = doc([block('p0b0', 'The astral body is real.', [0])])
    const t = leafTruth(leaves, p, p)
    expect(words(t, 0)).toBe('The astral body is real.')
    expect(t[0]!.unplaced).toBe(0)
  })
})

describe('a block joined across a seam', () => {
  // Leaf 0 ends mid-word on a line-break hyphen; leaf 1 finishes the word.
  const leaves = [
    leaf(0, ['Something first.', 'The student will find it ad-']),
    leaf(1, ['vanced beyond his hopes.', 'Another paragraph.'])
  ]
  const joined = 'The student will find it advanced beyond his hopes.'
  const pristine = doc([
    block('p0b0', 'Something first.', [0]),
    block('p0b1', joined, [0, 1]),
    block('p1b1', 'Another paragraph.', [1])
  ])

  it('gives each word to the leaf it was read from', () => {
    const t = leafTruth(leaves, pristine, pristine)
    expect(words(t, 0)).toBe('Something first. The student will find it advanced')
    expect(words(t, 1)).toBe('beyond his hopes. Another paragraph.')
  })

  /**
   * The healed word matches neither leaf — `advanced` is not `ad` and not
   * `vanced` — so it must fall to the word before it, where it began. Given to
   * the word after, it would count as leaf 1's, and a reader of leaf 0 would
   * be scored as having missed a word that was never on its paper whole.
   */
  it('gives a word the seam healed to the leaf it began on', () => {
    const t = leafTruth(leaves, pristine, pristine)
    expect(words(t, 0)).toContain('advanced')
    expect(words(t, 1)).not.toContain('advanced')
  })

  /**
   * A word both leaves print near the seam. Aligning the whole block against
   * leaf 1 without first masking the words leaf 0 already claimed lets the LCS
   * take leaf 0's `the way` for leaf 1's, leaving leaf 1's own copy unmatched
   * and falling to the word before it — which is leaf 0. The mask is what
   * makes the second copy the one that matches.
   */
  it('does not let a word one leaf claimed be matched again for the next', () => {
    const lv = [leaf(0, ['He will find the way ad-']), leaf(1, ['vanced the way home.'])]
    const pr = doc([block('p0b0', 'He will find the way advanced the way home.', [0, 1])])
    const t = leafTruth(lv, pr, pr)
    expect(words(t, 0)).toBe('He will find the way advanced')
    expect(words(t, 1)).toBe('the way home.')
  })

  /**
   * Three leaves, and a word every leaf prints. Only an order-preserving
   * alignment across all three can give the middle leaf its own copy: aligned
   * leaf by leaf, the middle alignment has nothing to stop it taking the
   * third leaf's copy instead.
   */
  it('keeps three leaves in order, each taking its own copy of a shared word', () => {
    const lv = [
      leaf(0, ['Begin the way here and']),
      leaf(1, ['carry the way through to']),
      leaf(2, ['finish the way there.'])
    ]
    const pr = doc([
      block(
        'p0b0',
        'Begin the way here and carry the way through to finish the way there.',
        [0, 1, 2]
      )
    ])
    const t = leafTruth(lv, pr, pr)
    expect(words(t, 0)).toBe('Begin the way here and')
    expect(words(t, 1)).toBe('carry the way through to')
    expect(words(t, 2)).toBe('finish the way there.')
  })

  it('names both leaves’ blocks', () => {
    const t = leafTruth(leaves, pristine, pristine)
    expect(t[0]!.blocks).toEqual(['p0b0', 'p0b1'])
    expect(t[1]!.blocks).toEqual(['p0b1', 'p1b1'])
  })
})

describe('an edited block', () => {
  const leaves = [leaf(0, ['He belleves in ghosts.', 'End of leaf.']), leaf(1, ['Next leaf here.'])]
  const pristine = doc([
    block('p0b0', 'He belleves in ghosts. End of leaf. Next leaf here.', [0, 1])
  ])

  it('gives a corrected word the leaf of the word it replaced', () => {
    const edited = doc([
      block('p0b0', 'He believes in ghosts. End of leaf. Next leaf here.', [0, 1])
    ])
    const t = leafTruth(leaves, pristine, edited)
    expect(words(t, 0)).toBe('He believes in ghosts. End of leaf.')
    expect(words(t, 1)).toBe('Next leaf here.')
  })

  it('gives an inserted word its neighbour’s leaf', () => {
    const edited = doc([
      block('p0b0', 'He believes firmly in ghosts. End of leaf. Next leaf here.', [0, 1])
    ])
    const t = leafTruth(leaves, pristine, edited)
    expect(words(t, 0)).toContain('firmly')
    expect(words(t, 1)).toBe('Next leaf here.')
  })

  /** `split` names the halves `id/1`, `id/2`; both must find the parent. */
  it('resolves a split block through its parent', () => {
    const edited = doc([
      block('p0b0/1', 'He believes in ghosts.', [0, 1]),
      block('p0b0/2', 'End of leaf. Next leaf here.', [0, 1])
    ])
    const t = leafTruth(leaves, pristine, edited)
    expect(words(t, 0)).toBe('He believes in ghosts. End of leaf.')
    expect(words(t, 1)).toBe('Next leaf here.')
  })

  /**
   * A merge brings in words from a block this never aligned against. They
   * are reported as unplaced on the first leaf, not handed to a neighbour —
   * the neighbour is exactly the wrong answer on a merge across leaves.
   */
  it('reports a merge’s foreign words rather than guessing their leaf', () => {
    const pr = doc([
      block('p0b0', 'One on leaf zero.', [0]),
      block('p1b0', 'Two on leaf one.', [1])
    ])
    const merged = doc([block('p0b0', 'One on leaf zero. Two on leaf one.', [0, 1])])
    const t = leafTruth([leaf(0, ['One on leaf zero.']), leaf(1, ['Two on leaf one.'])], pr, merged)
    expect(words(t, 0)).toBe('One on leaf zero.')
    expect(t[0]!.unplaced).toBe(4)
    expect(words(t, 1)).toBe('')
  })
})

describe('what else sits on a leaf', () => {
  it('keeps furniture and notes apart from the body', () => {
    const leaves = [
      leaf(3, ['Body text here.'], {
        furniture: { runningHead: 'THE ASTRAL WORLD', folio: '12' }
      } as never)
    ]
    const p = doc([block('p3b0', 'Body text here.', [3])], {
      footnotes: [
        {
          id: 'fn1',
          originalMarker: '*',
          text: 'A note on the leaf.',
          pageIndex: 3,
          orphaned: false
        }
      ]
    })
    const [t] = leafTruth(leaves, p, p)
    expect(t!.words).toEqual(['Body', 'text', 'here.'])
    expect(t!.furniture).toEqual(['THE', 'ASTRAL', 'WORLD', '12'])
    expect(t!.notes).toEqual(['A', 'note', 'on', 'the', 'leaf.'])
  })

  it('leaves out written matter, which stands on no leaf', () => {
    const p = doc([block('p0b0', 'On the leaf.', [0]), block('sec-intro', 'Written later.', [])])
    const t = leafTruth([leaf(0, ['On the leaf.'])], p, p)
    expect(t).toHaveLength(1)
    expect(words(t, 0)).toBe('On the leaf.')
  })

  it('lists a read leaf that put nothing in the body', () => {
    const t = leafTruth(
      [leaf(0, ['Title page']), leaf(1, ['Body.'])],
      doc([block('p1b0', 'Body.', [1])]),
      doc([block('p1b0', 'Body.', [1])])
    )
    expect(t.map((l) => l.pageIndex)).toEqual([0, 1])
    expect(t[0]!.words).toEqual([])
  })
})

describe('unsettled', () => {
  const leaves = [
    leaf(5, ['Some text.'], {
      queries: [{ quote: 'Some text', kind: 'unclear', why: 'w' }]
    } as never),
    leaf(6, ['Other text.'])
  ]
  const p = doc([block('p5b0', 'Some text.', [5]), block('p6b0', 'Other text.', [6])])

  it('marks a leaf whose query has no ruling', () => {
    const t = leafTruth(leaves, p, p, [])
    expect(t.find((l) => l.pageIndex === 5)!.unsettled).toBe(true)
    expect(t.find((l) => l.pageIndex === 6)!.unsettled).toBe(false)
  })

  it('clears it once a ruling names that query', () => {
    const t = leafTruth(leaves, p, p, [{ pageIndex: 5, quote: 'Some text' }])
    expect(t.find((l) => l.pageIndex === 5)!.unsettled).toBe(false)
  })

  /** A ruling on the same words on another leaf is a different question. */
  it('is not cleared by a ruling on another leaf', () => {
    const t = leafTruth(leaves, p, p, [{ pageIndex: 6, quote: 'Some text' }])
    expect(t.find((l) => l.pageIndex === 5)!.unsettled).toBe(true)
  })
})
