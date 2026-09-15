import { describe, it, expect } from 'vitest'
import { checkFootnotePairing, checkNoteContinuations } from '@core/coherence'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

const page = (pageIndex: number, blocks: TranscribedBlock[]): PageTranscription => ({
  pageIndex,
  role: 'body',
  blocks,
  uncertain: [],
  furniture: {}
})

const body = (text: string): TranscribedBlock => ({ kind: 'paragraph', text })
const note = (marker: string | undefined, text: string): TranscribedBlock => ({
  kind: 'footnote',
  text,
  ...(marker === undefined ? {} : { marker })
})

/**
 * The check exists because the engine pairs marks to notes *positionally*, so
 * one surplus mark does not misprint one note — it takes the next one, whose
 * note takes the one after, to the end of the book. Eight unbalanced leaves in
 * six hundred put Cooke's "New Chemistry" under a reference to Josephus.
 */
describe('checkFootnotePairing — the marks and the notes have to balance', () => {
  it('says nothing about a leaf that balances', () => {
    const clean = page(70, [
      body('a philosopher held it,* and so did the other.†'),
      note('*', '* See Gibbon.'),
      note('†', '† Genesis, i., 30.')
    ])
    expect(checkFootnotePairing([clean])).toEqual([])
  })

  it('names a mark the page prints no note for', () => {
    const found = checkFootnotePairing([page(111, [body('a stray mark * with nothing under it')])])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ pageIndex: 111, marker: '*', inBody: 1, notes: 0 })
    expect(found[0]!.context).toContain('stray mark')
  })

  it('names a note the page prints no mark for', () => {
    const found = checkFootnotePairing([page(309, [body('no mark here'), note('†', '† orphan.')])])
    expect(found[0]).toMatchObject({ pageIndex: 309, marker: '†', inBody: 0, notes: 1 })
  })

  /**
   * The number that matters. A list of leaves says where the book is untidy;
   * the running total says from where a reader is being shown the wrong note.
   */
  it('reports the drift running, so the first wrong page can be found', () => {
    const found = checkFootnotePairing([
      page(111, [body('one stray *')]),
      page(118, [body('two of them * and *'), note('*', '* only one note.')]),
      page(164, [body('and a section § twice §'), note('§', '§ one note.')])
    ])
    expect(found.map((f) => [f.pageIndex, f.marker, f.driftAfter])).toEqual([
      [111, '*', -1],
      [118, '*', -2],
      [164, '§', -1]
    ])
  })

  it('does not count a continuation as a second note', () => {
    // A long footnote runs onto the next leaf and its second half prints no
    // marker. Counting it would flag every long note in the book.
    const found = checkFootnotePairing([
      page(216, [
        body('a mark here *'),
        note('*', '* a note that runs on'),
        note(undefined, 'and finishes here, with no marker of its own.')
      ])
    ])
    expect(found).toEqual([])
  })

  it('reads a marker the reading left at the head of the note instead of in the field', () => {
    const found = checkFootnotePairing([
      page(70, [body('a mark here ‡'), note(undefined, '‡ See Drummond.')])
    ])
    expect(found).toEqual([])
  })

  it('counts a doubled marker as itself, not as two singles', () => {
    const found = checkFootnotePairing([
      page(80, [body('a doubled mark** stands here'), note('**', '** See the other.')])
    ])
    expect(found).toEqual([])
  })

  it('takes the leaves in printed order, whatever order they arrive in', () => {
    const found = checkFootnotePairing([
      page(118, [body('two * and *'), note('*', '* one.')]),
      page(111, [body('one stray *')])
    ])
    expect(found.map((f) => [f.pageIndex, f.driftAfter])).toEqual([
      [111, -1],
      [118, -2]
    ])
  })
})

describe('checkNoteContinuations — a runover recorded as a fresh note', () => {
  const page = (pageIndex: number, blocks: TranscribedBlock[]): PageTranscription => ({
    pageIndex,
    role: 'body',
    blocks,
    uncertain: [],
    furniture: {}
  })

  it('names a footnote whose marker sits on text that opens mid-sentence', () => {
    // Leaf 330 of Isis Vol. I: the tail of leaf 329's † note, given a † of its
    // own by the reading. On the paper it has no marker at all.
    const found = checkNoteContinuations([
      page(329, [
        { kind: 'paragraph', text: 'The whole resting upon the Hindu Illusion.†' },
        { kind: 'footnote', marker: '†', text: 'In no country were the true esoteric doctrines' }
      ]),
      page(330, [
        { kind: 'paragraph', text: 'The kabalistic heresies receive an unexpected support.' },
        {
          kind: 'footnote',
          marker: '†',
          text: 'expanding his idea, or dispelling the gloom.” Thus speaks the first code'
        }
      ])
    ])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ pageIndex: 330, marker: '†' })
    expect(found[0]!.opening.startsWith('expanding his idea, or dispelling')).toBe(true)
  })

  it('is quiet on a fresh note, on a runover that has no marker, and on a note opening with its own mark', () => {
    expect(
      checkNoteContinuations([
        page(1, [
          { kind: 'footnote', marker: '*', text: 'Plato : “Theages.”' },
          { kind: 'footnote', marker: '†', text: '† “Ripley Revived,” 1678.' },
          { kind: 'footnote', text: 'and so the note goes on, with no marker of its own.' },
          { kind: 'footnote', marker: '‡', text: '‡ Ibid., p. 2.' }
        ])
      ])
    ).toEqual([])
  })

  it('does not take a lower-case citation opening on a proper noun for a runover', () => {
    // `de Mirville` opens lower case and is a fresh note. The check is a floor,
    // not a verdict: it reports and the leaf decides, so this is a known
    // false positive worth having rather than a case to tune away.
    //
    // The text opens with the note's *own* repeated mark, as the printed page
    // sets it. That is deliberate: the mark has to be taken off before the
    // first letter is judged, and a version of this check that did not strip
    // it saw `‡` — neither lower case nor punctuation — and stayed quiet on
    // every note in the book.
    const found = checkNoteContinuations([
      page(1, [{ kind: 'footnote', marker: '‡', text: '‡ de Mirville : “Des Esprits,” p. 33.' }])
    ])
    expect(found).toHaveLength(1)
  })
})
