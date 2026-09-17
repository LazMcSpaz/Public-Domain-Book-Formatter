import { describe, it, expect } from 'vitest'
import {
  anchorsById,
  applyEdits,
  countEdited,
  noteAnchors,
  withEdit,
  type BookEdit
} from '@core/edits'
import { assembleBook, type BookDocument } from '@core/assemble'
import { createSavedRun, migrateSavedRun } from '@core/project'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

const book = (): BookDocument =>
  assembleBook([
    page(0, [
      { kind: 'paragraph', text: 'The alembick* is set upon a gentle fire.' },
      { kind: 'footnote', text: '* See Croll, Basilica Chymica, lib. ii.', marker: '*' },
      { kind: 'footnote', text: '2. A note nothing references.', marker: '2' }
    ])
  ])

describe('note-text — correcting the book’s own footnotes', () => {
  it('assembly proves the setup: two notes, one of them orphaned', () => {
    const doc = book()
    expect(doc.footnotes.map((n) => n.id)).toEqual(['fn1', 'fn2'])
    expect(doc.footnotes.map((n) => n.orphaned)).toEqual([false, true])
    // And no block edit can reach them — the reason this kind exists.
    expect(doc.blocks.some((b) => b.kind === 'footnote')).toBe(false)
  })

  it('names a note by its leaf, its marker, and which of them it is', () => {
    const doc = book()
    const at = anchorsById(doc.footnotes)
    expect(at.get('fn1')).toEqual({ pageIndex: 0, marker: '*', nth: 0 })
    expect(at.get('fn2')).toEqual({ pageIndex: 0, marker: '2', nth: 0 })
    // And back the other way, which is how `applyEdits` finds the note.
    expect(noteAnchors(doc.footnotes).get('0\u0000*\u00000')?.id).toBe('fn1')
  })

  /**
   * The anchor a `note-text` edit carries is what the *paper* shows, not the
   * note's position in the assembled list. The list moves — a leaf re-landed
   * to fix a marker, front matter added at the head of a volume — and an edit
   * written against the old numbering silently comes to name a different note.
   *
   * The fixture has to have the shape of the fault: the change must insert a
   * note *before* the one being corrected, or every id keeps its meaning and
   * the test passes with the old anchor reinstated.
   */
  it('still names the same note after a leaf is added in front of it', () => {
    const later = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'A leaf of front matter, with a note of its own.†' },
        { kind: 'footnote', text: '† Added later, at the head of the volume.', marker: '†' }
      ]),
      page(1, [
        { kind: 'paragraph', text: 'The alembick* is set upon a gentle fire.' },
        { kind: 'footnote', text: '* See Croll, Basilica Chymica, lib. ii.', marker: '*' }
      ])
    ])
    // The note that was `fn1` is `fn2` now — the renumbering that broke it.
    expect(later.footnotes.find((n) => n.text.startsWith('See Croll'))!.id).toBe('fn2')
    const fixed = applyEdits(later, [
      { kind: 'note-text', at: { pageIndex: 1, marker: '*', nth: 0 }, text: 'Corrected.' }
    ])
    expect(fixed.footnotes.find((n) => n.pageIndex === 1)!.text).toBe('Corrected.')
    // And the note that moved into its old place is untouched.
    expect(fixed.footnotes.find((n) => n.pageIndex === 0)!.text).toBe(
      'Added later, at the head of the volume.'
    )
  })

  /**
   * `nth` exists for the leaf that carries the same marker twice, which the
   * 1877 compositor did on leaf 106 of *Isis Unveiled*. Without a fixture that
   * has two of one marker on one leaf, dropping the occurrence count changes
   * nothing and the test passes against the fault.
   */
  it('tells the second of a repeated marker from the first', () => {
    const twice = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'One claim‡ and then another claim‡ after it.' },
        { kind: 'footnote', text: '‡ The first authority.', marker: '‡' },
        { kind: 'footnote', text: '‡ The second authority.', marker: '‡' }
      ])
    ])
    const at = anchorsById(twice.footnotes)
    expect([...at.values()]).toEqual([
      { pageIndex: 0, marker: '‡', nth: 0 },
      { pageIndex: 0, marker: '‡', nth: 1 }
    ])
    const doc = applyEdits(twice, [
      { kind: 'note-text', at: { pageIndex: 0, marker: '‡', nth: 1 }, text: 'Only the second.' }
    ])
    expect(doc.footnotes.map((n) => n.text)).toEqual(['The first authority.', 'Only the second.'])
  })

  it('tells one marker from another on the same leaf', () => {
    const doc = applyEdits(book(), [
      { kind: 'note-text', at: { pageIndex: 0, marker: '2', nth: 0 }, text: 'Only this one.' }
    ])
    expect(doc.footnotes.find((n) => n.originalMarker === '2')!.text).toBe('Only this one.')
    expect(doc.footnotes.find((n) => n.originalMarker === '*')!.text).toBe(
      'See Croll, Basilica Chymica, lib. ii.'
    )
  })

  it('replaces the note’s text, reading emphasis by the house convention', () => {
    const doc = applyEdits(book(), [
      {
        kind: 'note-text',
        at: { pageIndex: 0, marker: '*', nth: 0 },
        text: 'See Croll, <i>Basilica Chymica</i>, lib. ii.'
      }
    ])
    const note = doc.footnotes.find((n) => n.id === 'fn1')!
    expect(note.text).toBe('See Croll, Basilica Chymica, lib. ii.')
    expect(note.emphasis).toEqual([2, 3])
    // Everything else about the note survives the correction.
    expect(note.originalMarker).toBe('*')
    expect(note.orphaned).toBe(false)
  })

  it('removes a note whose text is cleared, like a block emptied', () => {
    const doc = applyEdits(book(), [
      { kind: 'note-text', at: { pageIndex: 0, marker: '2', nth: 0 }, text: '' }
    ])
    expect(doc.footnotes.map((n) => n.id)).toEqual(['fn1'])
  })

  it('collapses re-edits of one note and counts it as one correction', () => {
    const at = { pageIndex: 0, marker: '*', nth: 0 }
    let edits: BookEdit[] = withEdit([], { kind: 'note-text', at, text: 'First try.' })
    edits = withEdit(edits, { kind: 'note-text', at, text: 'Second try.' })
    expect(edits).toHaveLength(1)
    expect(countEdited(edits)).toBe(1)
    const doc = applyEdits(book(), edits)
    expect(doc.footnotes.find((n) => n.id === 'fn1')!.text).toBe('Second try.')
  })

  /**
   * An anchor that names nothing is *reported*. This edit fails backwards —
   * losing one leaves the paper's own text standing, which looks exactly like
   * nothing being wrong — so silence here is the failure mode, not the error.
   */
  it('reports an anchor that names no note, rather than dropping it quietly', () => {
    const at = { pageIndex: 9, marker: '§', nth: 0 }
    const doc = applyEdits(book(), [{ kind: 'note-text', at, text: 'x' }])
    expect(doc.noteTextsMissed).toEqual([at])
    // The book itself is untouched by a correction that reached nothing.
    expect(doc.footnotes.map((n) => n.text)).toEqual(book().footnotes.map((n) => n.text))
  })

  it('says nothing when every anchor lands', () => {
    const doc = applyEdits(book(), [
      { kind: 'note-text', at: { pageIndex: 0, marker: '*', nth: 0 }, text: 'Landed.' }
    ])
    expect(doc.noteTextsMissed).toBeUndefined()
  })

  it('survives storage, and a malformed record is dropped', () => {
    const stored = migrateSavedRun(
      JSON.parse(
        JSON.stringify(
          createSavedRun({
            key: 'book.pdf 1 1',
            fileName: 'book.pdf',
            pageCount: 1,
            transcriptions: [page(0, [{ kind: 'paragraph', text: 'Text.' }])],
            failures: [],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
            modelId: 'none',
            identityAnswers: {},
            edits: [
              { kind: 'note-text', at: { pageIndex: 0, marker: '*', nth: 0 }, text: 'Kept.' },
              // The old shape, naming the note by its assembled id. Dropped
              // rather than converted: the id is a position in a list that has
              // since moved, which is why the anchor changed, so resolving it
              // now would attach the text to whichever note sits there today.
              { kind: 'note-text', noteId: 'fn1', text: 'the old anchor' } as unknown as BookEdit,
              { kind: 'note-text', text: 'no anchor at all' } as unknown as BookEdit
            ]
          })
        )
      )
    )
    expect(stored.edits).toEqual([
      { kind: 'note-text', at: { pageIndex: 0, marker: '*', nth: 0 }, text: 'Kept.' }
    ])
  })
})

describe('assembly keeps the emphasis the reading recovered in a footnote', () => {
  it('shifts the word indices past the stripped marker', () => {
    // "1." is word 0 and is stripped; the italics sat on words 3–4 and must
    // land on words 2–3 of the stripped text — not be dropped, which printed
    // every footnote's book titles in roman, and not stay put, which would
    // italicise the wrong words.
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'The vessel1 is described.' },
        {
          kind: 'footnote',
          marker: '1',
          text: '1. See Croll, Basilica Chymica, lib. ii.',
          emphasis: [3, 4]
        }
      ])
    ])
    const note = doc.footnotes[0]!
    expect(note.text).toBe('See Croll, Basilica Chymica, lib. ii.')
    expect(note.emphasis).toEqual([2, 3])
  })

  it('drops an index that pointed at the marker itself', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'footnote', marker: '*', text: '* Wholly italic note.', emphasis: [0, 1, 2, 3] }
      ])
    ])
    expect(doc.footnotes[0]!.emphasis).toEqual([0, 1, 2])
  })
})
