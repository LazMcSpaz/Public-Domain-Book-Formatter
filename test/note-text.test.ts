import { describe, it, expect } from 'vitest'
import { applyEdits, countEdited, withEdit, type BookEdit } from '@core/edits'
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

  it('replaces the note’s text, reading emphasis by the house convention', () => {
    const doc = applyEdits(book(), [
      { kind: 'note-text', noteId: 'fn1', text: 'See Croll, <i>Basilica Chymica</i>, lib. ii.' }
    ])
    const note = doc.footnotes.find((n) => n.id === 'fn1')!
    expect(note.text).toBe('See Croll, Basilica Chymica, lib. ii.')
    expect(note.emphasis).toEqual([2, 3])
    // Everything else about the note survives the correction.
    expect(note.originalMarker).toBe('*')
    expect(note.orphaned).toBe(false)
  })

  it('removes a note whose text is cleared, like a block emptied', () => {
    const doc = applyEdits(book(), [{ kind: 'note-text', noteId: 'fn2', text: '' }])
    expect(doc.footnotes.map((n) => n.id)).toEqual(['fn1'])
  })

  it('collapses re-edits of one note and counts it as one correction', () => {
    let edits: BookEdit[] = withEdit([], { kind: 'note-text', noteId: 'fn1', text: 'First try.' })
    edits = withEdit(edits, { kind: 'note-text', noteId: 'fn1', text: 'Second try.' })
    expect(edits).toHaveLength(1)
    expect(countEdited(edits)).toBe(1)
    const doc = applyEdits(book(), edits)
    expect(doc.footnotes.find((n) => n.id === 'fn1')!.text).toBe('Second try.')
  })

  it('skips a note that no longer exists rather than throwing', () => {
    expect(() =>
      applyEdits(book(), [{ kind: 'note-text', noteId: 'fn9', text: 'x' }])
    ).not.toThrow()
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
              { kind: 'note-text', noteId: 'fn1', text: 'Kept.' },
              { kind: 'note-text', text: 'no id — dropped' } as unknown as BookEdit
            ]
          })
        )
      )
    )
    expect(stored.edits).toEqual([{ kind: 'note-text', noteId: 'fn1', text: 'Kept.' }])
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
