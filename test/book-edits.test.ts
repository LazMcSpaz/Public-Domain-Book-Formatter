import { describe, it, expect } from 'vitest'
import {
  applyEdits,
  countEdited,
  nextFlaggedPage,
  proofSheet,
  withEdit,
  withCorrections,
  type BookEdit
} from '@core/edits'
import { assembleBook, type BookDocument } from '@core/assemble'
import { anchorIllustrations, prepareFootnotes } from '@core/layout'
import { brightness, crop, grayscale, levels, rotate } from '@core/image'
import type { ImageEditOp } from '@core/model'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

const book = (): BookDocument =>
  assembleBook([
    page(0, [
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: 'The chirnrgeon examined the specimen.' },
      { kind: 'paragraph', text: 'A second paragraph.' }
    ]),
    page(1, [{ kind: 'paragraph', text: 'A third, on the next leaf.' }])
  ])

const texts = (doc: BookDocument) => doc.blocks.map((b) => b.text)
const ids = (doc: BookDocument) => doc.blocks.map((b) => b.id)

describe('block identity — what a correction names', () => {
  it('names the transcribed block it came from, not its place in the output', () => {
    expect(ids(book())).toEqual(['p0b0', 'p0b1', 'p0b2', 'p1b0'])
  })

  it('survives a page being removed from the book', () => {
    // The id is a fact about the input, so re-assembling without page 0 leaves
    // page 1's block called what it was already called — and every edit
    // already made against it still lands.
    const pages = [
      page(0, [{ kind: 'paragraph', text: 'First.' }]),
      page(1, [{ kind: 'paragraph', text: 'Second.' }])
    ]
    expect(assembleBook(pages, { excludePages: [0] }).blocks[0]!.id).toBe('p1b0')
    expect(assembleBook(pages).blocks[1]!.id).toBe('p1b0')
  })

  it('gives a paragraph joined across a seam the id of its first half', () => {
    const joined = assembleBook([
      page(0, [{ kind: 'paragraph', text: 'The alembick being set', continuesNext: true }]),
      page(1, [{ kind: 'paragraph', text: 'upon a gentle fire.', continuesPrevious: true }])
    ])
    expect(joined.blocks).toHaveLength(1)
    expect(joined.blocks[0]!.id).toBe('p0b0')
  })

  it('is unmoved by a caption leaving the flow onto a picture', () => {
    const pages = [
      page(0, [
        { kind: 'caption', text: 'Fig. 1.' },
        { kind: 'paragraph', text: 'Body text.' }
      ])
    ]
    const without = assembleBook(pages)
    const with_ = assembleBook(pages, {
      illustrations: [{ id: 'i1', pageIndex: 0, sourceWidth: 10, sourceHeight: 10 }]
    })
    // The caption is gone from the flow, and the paragraph after it keeps the
    // name it had — an id counted off the output would have shifted to b0.
    expect(without.blocks.map((b) => b.id)).toEqual(['p0b0', 'p0b1'])
    expect(with_.blocks.map((b) => b.id)).toEqual(['p0b1'])
  })
})

describe('applyEdits — correcting a word', () => {
  it('replaces the text the pass misread', () => {
    const fixed = applyEdits(book(), [
      { kind: 'text', blockId: 'p0b1', text: 'The chirurgeon examined the specimen.' }
    ])
    expect(texts(fixed)[1]).toBe('The chirurgeon examined the specimen.')
  })

  it('leaves the original document untouched', () => {
    // The transcription is the thing that was paid for; edits are re-applied
    // over it, never written into it.
    const original = book()
    applyEdits(original, [{ kind: 'text', blockId: 'p0b1', text: 'Something else entirely.' }])
    expect(texts(original)[1]).toBe('The chirnrgeon examined the specimen.')
  })

  it('is a pure function of its inputs — applying twice gives the same book', () => {
    const edits: BookEdit[] = [{ kind: 'text', blockId: 'p0b1', text: 'Corrected.' }]
    expect(JSON.stringify(applyEdits(book(), edits))).toBe(
      JSON.stringify(applyEdits(book(), edits))
    )
  })

  it('returns the same document when there is nothing to do', () => {
    const doc = book()
    expect(applyEdits(doc, [])).toBe(doc)
  })

  it('drops a block whose text is cleared, rather than printing a blank line', () => {
    const fixed = applyEdits(book(), [{ kind: 'text', blockId: 'p0b2', text: '   ' }])
    expect(texts(fixed)).toEqual([
      'Of the Air',
      'The chirnrgeon examined the specimen.',
      'A third, on the next leaf.'
    ])
  })
})

describe('applyEdits — saying what a block is', () => {
  it('turns a paragraph into a heading, and into a chapter', () => {
    const fixed = applyEdits(book(), [
      { kind: 'retype', blockId: 'p0b2', blockKind: 'heading', level: 1 }
    ])
    expect(fixed.blocks[2]!.kind).toBe('heading')
    expect(fixed.chapters.map((c) => c.title)).toEqual(['Of the Air', 'A second paragraph.'])
  })

  it('takes a heading out of the contents when it was never one', () => {
    const fixed = applyEdits(book(), [{ kind: 'retype', blockId: 'p0b0', blockKind: 'paragraph' }])
    expect(fixed.chapters).toEqual([])
  })

  it('does not leave a heading level on something that is no longer a heading', () => {
    // A stale level would put a paragraph in the table of contents at a depth.
    const fixed = applyEdits(book(), [{ kind: 'retype', blockId: 'p0b0', blockKind: 'blockquote' }])
    expect(fixed.blocks[0]!.level).toBeUndefined()
  })

  it('keeps the chapter’s index pointing at the right block after a drop', () => {
    const fixed = applyEdits(book(), [
      { kind: 'drop', blockId: 'p0b0' },
      { kind: 'retype', blockId: 'p0b2', blockKind: 'heading', level: 1 }
    ])
    expect(fixed.chapters[0]!.blockIndex).toBe(1)
    expect(fixed.blocks[fixed.chapters[0]!.blockIndex]!.text).toBe('A second paragraph.')
  })
})

describe('applyEdits — splitting and joining', () => {
  it('splits a run-together paragraph in two', () => {
    const doc = assembleBook([
      page(0, [{ kind: 'paragraph', text: 'First sentence. Second sentence.' }])
    ])
    const fixed = applyEdits(doc, [{ kind: 'split', blockId: 'p0b0', at: 16 }])
    expect(texts(fixed)).toEqual(['First sentence.', 'Second sentence.'])
    expect(ids(fixed)).toEqual(['p0b0/1', 'p0b0/2'])
  })

  it('splits the *corrected* text, not the original', () => {
    // Order is the caller's, and a person fixing a run-together paragraph
    // usually fixes the wording first.
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: 'Aaa. Bbb.' }])])
    const fixed = applyEdits(doc, [
      { kind: 'text', blockId: 'p0b0', text: 'Corrected first. Corrected second.' },
      { kind: 'split', blockId: 'p0b0', at: 17 }
    ])
    expect(texts(fixed)).toEqual(['Corrected first.', 'Corrected second.'])
  })

  it('refuses a split that would leave an empty paragraph', () => {
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: 'One block.' }])])
    for (const at of [0, 10, 999, -5]) {
      expect(texts(applyEdits(doc, [{ kind: 'split', blockId: 'p0b0', at }]))).toEqual([
        'One block.'
      ])
    }
  })

  it('joins a paragraph the pass broke in two', () => {
    const fixed = applyEdits(book(), [{ kind: 'merge', blockId: 'p0b1' }])
    expect(texts(fixed)).toEqual([
      'Of the Air',
      'The chirnrgeon examined the specimen. A second paragraph.',
      'A third, on the next leaf.'
    ])
  })

  it('keeps the provenance of both halves when it joins them', () => {
    // The merged block came off two leaves, and the export screen counts pages.
    const fixed = applyEdits(book(), [{ kind: 'merge', blockId: 'p0b2' }])
    expect(fixed.blocks[2]!.sourcePages).toEqual([0, 1])
  })

  it('does nothing when there is nothing after it to join', () => {
    const fixed = applyEdits(book(), [{ kind: 'merge', blockId: 'p1b0' }])
    expect(texts(fixed)).toEqual(texts(book()))
  })
})

describe('applyEdits — moving a picture', () => {
  const illustrated = (): BookDocument =>
    assembleBook(
      [
        page(0, [
          { kind: 'paragraph', text: 'First.' },
          { kind: 'paragraph', text: 'Second.' }
        ]),
        page(1, [{ kind: 'paragraph', text: 'Third.' }])
      ],
      { illustrations: [{ id: 'i1', pageIndex: 0, sourceWidth: 100, sourceHeight: 100 }] }
    )

  const anchorOf = (doc: BookDocument): number =>
    [...anchorIllustrations(doc.blocks, doc.illustrations).entries()].find(([, list]) =>
      list.some((i) => i.id === 'i1')
    )![0]

  it('leaves it where the engine put it until someone says otherwise', () => {
    // After the last block that shared its page — all the scan can tell us.
    expect(anchorOf(illustrated())).toBe(1)
  })

  it('puts it where the user said', () => {
    const moved = applyEdits(illustrated(), [
      { kind: 'anchor', illustrationId: 'i1', afterBlockId: 'p1b0' }
    ])
    expect(anchorOf(moved)).toBe(2)
  })

  it('treats the front of the book as a real answer, not as no answer', () => {
    const moved = applyEdits(illustrated(), [
      { kind: 'anchor', illustrationId: 'i1', afterBlockId: null }
    ])
    expect(anchorOf(moved)).toBe(-1)
  })

  it('falls back to the engine when the block it was pinned to is gone', () => {
    // Rather than losing the picture, or pinning it to the front by accident.
    const moved = applyEdits(illustrated(), [
      { kind: 'anchor', illustrationId: 'i1', afterBlockId: 'p1b0' },
      { kind: 'drop', blockId: 'p1b0' }
    ])
    expect(anchorOf(moved)).toBe(1)
  })
})

describe('applyEdits — an edit list that has outlived its book', () => {
  it('skips a correction whose block is no longer there', () => {
    // The list is persisted and the book is re-derived, so this happens
    // whenever a page is removed after the correction was made. Refusing to
    // lay the book out would be a far worse answer than dropping one edit.
    const fixed = applyEdits(book(), [
      { kind: 'text', blockId: 'p9b9', text: 'Nowhere.' },
      { kind: 'text', blockId: 'p0b1', text: 'Corrected.' }
    ])
    expect(texts(fixed)[1]).toBe('Corrected.')
  })

  it('skips a correction to a block an earlier edit removed', () => {
    const fixed = applyEdits(book(), [
      { kind: 'drop', blockId: 'p0b1' },
      { kind: 'text', blockId: 'p0b1', text: 'Too late.' }
    ])
    expect(texts(fixed)).not.toContain('Too late.')
  })
})

describe('withEdit — keeping the list from growing without bound', () => {
  it('replaces an earlier correction of the same block', () => {
    // A text box emits an edit per keystroke.
    let edits: BookEdit[] = []
    for (const text of ['C', 'Co', 'Cor']) {
      edits = withEdit(edits, { kind: 'text', blockId: 'p0b1', text })
    }
    expect(edits).toEqual([{ kind: 'text', blockId: 'p0b1', text: 'Cor' }])
  })

  it('does not confuse a retype with a correction of the same block', () => {
    let edits = withEdit([], { kind: 'text', blockId: 'p0b1', text: 'Fixed.' })
    edits = withEdit(edits, { kind: 'retype', blockId: 'p0b1', blockKind: 'heading', level: 1 })
    expect(edits).toHaveLength(2)
  })

  it('keeps every split, because two splits are two corrections', () => {
    let edits = withEdit([], { kind: 'split', blockId: 'p0b1', at: 5 })
    edits = withEdit(edits, { kind: 'split', blockId: 'p0b1', at: 12 })
    expect(edits).toHaveLength(2)
  })

  it('counts the blocks touched, not the keystrokes', () => {
    const edits: BookEdit[] = [
      { kind: 'text', blockId: 'p0b1', text: 'a' },
      { kind: 'retype', blockId: 'p0b1', blockKind: 'blockquote' },
      { kind: 'text', blockId: 'p0b2', text: 'b' }
    ]
    expect(countEdited(edits)).toBe(2)
  })
})

describe('withCorrections — fixing a leaf at the gate instead of paying again', () => {
  const pristine = new Map(book().blocks.map((b) => [b.id, b.text]))

  it('turns a retyped passage into the same edit the proof step makes', () => {
    const edits = withCorrections([], { p0b1: 'The chirurgeon examined the specimen.' }, pristine)
    expect(edits).toEqual([
      { kind: 'text', blockId: 'p0b1', text: 'The chirurgeon examined the specimen.' }
    ])
    expect(texts(applyEdits(book(), edits))[1]).toBe('The chirurgeon examined the specimen.')
  })

  it('records nothing for a passage left as it was', () => {
    // Walking through the gate twice, or clicking into a box and out again,
    // must not claim every block on the leaf was corrected.
    const untouched = { p0b1: 'The chirnrgeon examined the specimen.', p0b2: 'A second paragraph.' }
    expect(withCorrections([], untouched, pristine)).toEqual([])
    expect(countEdited(withCorrections([], untouched, pristine))).toBe(0)
  })

  it('replaces its own earlier correction rather than stacking one on it', () => {
    const once = withCorrections([], { p0b1: 'First go.' }, pristine)
    const twice = withCorrections(once, { p0b1: 'Second go.' }, pristine)
    expect(twice).toEqual([{ kind: 'text', blockId: 'p0b1', text: 'Second go.' }])
  })

  it('leaves corrections to other blocks alone', () => {
    const existing: BookEdit[] = [{ kind: 'text', blockId: 'p1b0', text: 'Fixed elsewhere.' }]
    const edits = withCorrections(existing, { p0b1: 'Fixed here.' }, pristine)
    expect(edits).toHaveLength(2)
    expect(edits.find((e) => e.kind === 'text' && e.blockId === 'p1b0')).toBeDefined()
  })
})

describe('proofSheet — what to put in front of a proofreader', () => {
  const sheet = (input: Parameters<typeof proofSheet>[0]) => proofSheet(input)

  it('groups the book by the leaf it was read from', () => {
    const pages = sheet({ document: book() })
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1])
    expect(pages[0]!.blocks.map((b) => b.block.id)).toEqual(['p0b0', 'p0b1', 'p0b2'])
    expect(pages[1]!.blocks.map((b) => b.block.id)).toEqual(['p1b0'])
  })

  it('shows a joined paragraph on the leaf it began, and says where else it runs', () => {
    // The text on screen will run past what the scan beside it shows. Saying so
    // is the difference between a seam repair and an apparent transcription error.
    const doc = assembleBook([
      page(0, [{ kind: 'paragraph', text: 'The alembick being set', continuesNext: true }]),
      page(1, [{ kind: 'paragraph', text: 'upon a gentle fire.', continuesPrevious: true }])
    ])
    const pages = sheet({ document: doc })
    expect(pages[0]!.blocks[0]!.alsoFromPages).toEqual([1])
    expect(pages.find((p) => p.pageIndex === 1)).toBeUndefined()
  })

  it('reaches a page that has only a picture on it', () => {
    // Otherwise a full-page plate could never be re-anchored.
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: 'Text.' }]), page(1, [])], {
      illustrations: [{ id: 'plate', pageIndex: 1, sourceWidth: 10, sourceHeight: 10 }]
    })
    const plate = sheet({ document: doc }).find((p) => p.pageIndex === 1)!
    expect(plate.blocks).toEqual([])
    expect(plate.illustrationIds).toEqual(['plate'])
  })

  it('flags the pages the cross-checks disagreed on', () => {
    const pages = sheet({
      document: book(),
      findings: [
        {
          code: 'text-dropped',
          pageIndex: 1,
          severity: 'high',
          message: 'word count differs from OCR by 40%'
        }
      ],
      uncertainties: [{ pageIndex: 0, text: 'chirnrgeon' }]
    })
    expect(pages[0]!.flags).toEqual(['Couldn’t read “chirnrgeon”'])
    expect(pages[1]!.flags[0]).toContain('word count differs')
  })

  it('does not flag a page on a low-severity finding alone', () => {
    const pages = sheet({
      document: book(),
      findings: [{ code: 'text-dropped', pageIndex: 0, severity: 'low', message: 'a trifle' }]
    })
    expect(pages[0]!.flags).toEqual([])
  })

  it('does not send the user back over a page they already accepted', () => {
    const pages = sheet({
      document: book(),
      uncertainties: [{ pageIndex: 0, text: 'chirnrgeon' }],
      reviewedPages: [0]
    })
    expect(pages[0]!.flags).toEqual([])
  })

  it('keeps the note on a page the user accepted *and* marked to fix', () => {
    // The two answers are not the same answer. "It's fine" means stop telling
    // me; "I'll fix it myself" means remind me. Conflating them threw the note
    // away at exactly the moment it had been asked for.
    const pages = sheet({
      document: book(),
      uncertainties: [{ pageIndex: 0, text: 'chirnrgeon' }],
      reviewedPages: [0],
      attention: [{ pageIndex: 0, message: 'You marked this leaf to fix by hand.' }]
    })
    expect(pages[0]!.marked).toBe(true)
    expect(pages[0]!.flags).toEqual([
      'You marked this leaf to fix by hand.',
      'Couldn’t read “chirnrgeon”'
    ])
  })

  it('leads with the reason the user gave, not the one the app found', () => {
    const pages = sheet({
      document: book(),
      findings: [
        { code: 'text-dropped', pageIndex: 1, severity: 'high', message: 'word count differs' }
      ],
      attention: [{ pageIndex: 1, message: 'You marked this leaf to fix by hand.' }]
    })
    expect(pages[1]!.flags[0]).toBe('You marked this leaf to fix by hand.')
  })

  it('reaches a marked page even when nothing was read off it', () => {
    // A repair the app could not place is reported here or nowhere. Same rule
    // as a footnote with no home: never silently dropped.
    const pages = sheet({
      document: book(),
      attention: [{ pageIndex: 7, message: 'Couldn’t place a recovered passage.' }]
    })
    const orphan = pages.find((p) => p.pageIndex === 7)!
    expect(orphan.marked).toBe(true)
    expect(orphan.flags).toEqual(['Couldn’t place a recovered passage.'])
  })

  it('marks nothing when the user marked nothing', () => {
    expect(sheet({ document: book() }).every((p) => p.marked)).toBe(false)
  })

  it('lists every page that produced text, flagged or not', () => {
    // The whole reason this feature exists is a misreading both witnesses agree
    // on, which raises no flag at all. An unflagged page is not a promise.
    expect(sheet({ document: book() }).map((p) => p.flags.length)).toEqual([0, 0])
    expect(sheet({ document: book() })).toHaveLength(2)
  })
})

describe('nextFlaggedPage — working through what was flagged', () => {
  const pages = (flagged: number[]) =>
    [0, 1, 2, 3].map((pageIndex) => ({
      pageIndex,
      blocks: [],
      illustrationIds: [],
      flags: flagged.includes(pageIndex) ? ['something'] : [],
      marked: false
    }))

  it('finds the next one after where you are', () => {
    expect(nextFlaggedPage(pages([1, 3]), 0)).toBe(1)
    expect(nextFlaggedPage(pages([1, 3]), 1)).toBe(3)
  })

  it('wraps, so nothing is left behind by working out of order', () => {
    expect(nextFlaggedPage(pages([1, 3]), 3)).toBe(1)
  })

  it('says so when nothing is flagged', () => {
    expect(nextFlaggedPage(pages([]), 0)).toBeNull()
  })
})

describe('applyEdits — notes the editor wrote', () => {
  const noted = (over: Partial<{ at: number; text: string }> = {}) =>
    applyEdits(book(), [
      {
        kind: 'note',
        noteId: 'ed1',
        blockId: 'p0b1',
        at: over.at ?? 36,
        text: over.text ?? 'Paracelsus, whom the author follows throughout.'
      }
    ])

  it('adds a note to the book without touching the text it hangs off', () => {
    const doc = noted()
    expect(doc.footnotes).toHaveLength(1)
    expect(doc.footnotes[0]!.text).toBe('Paracelsus, whom the author follows throughout.')
    // No marker character is spliced into the text: it would show up in the
    // proof sheet's edit box, where one backspace would orphan the note.
    expect(texts(doc)[1]).toBe('The chirnrgeon examined the specimen.')
  })

  it('carries no printed marker, because nobody printed it', () => {
    const note = noted().footnotes[0]!
    expect(note.originalMarker).toBe('')
    expect(note.orphaned).toBe(false)
    expect(note.anchor).toEqual({ blockId: 'p0b1', at: 36 })
  })

  it('is placed by the same machinery as a note off the page', () => {
    // The whole reason this shape was chosen: `prepareFootnotes` locates it,
    // numbers it in reading order and hands it on, with no idea who wrote it.
    const prepared = prepareFootnotes(noted().blocks, noted().footnotes)
    expect(prepared.orphans).toEqual([])
    expect([...prepared.notes.values()][0]).toMatchObject({ id: 'ed1', mark: '1' })
  })

  it('attaches to the word before the point it was written at', () => {
    const doc = noted({ at: 17 }) // "The chirnrgeon ex|amined"
    const prepared = prepareFootnotes(doc.blocks, doc.footnotes)
    expect(prepared.blocks[1]!.references[0]!.wordIndex).toBe(2)
  })

  it('numbers straight through with the book’s own notes, in reading order', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'First para with a mark.1 And more after it.' },
        { kind: 'footnote', text: 'The printer’s note.', marker: '1' }
      ])
    ])
    // Written *before* the printed marker, so the editor's note is read first
    // and takes "1" — the original's numbering is not preserved, by design.
    const withNote = applyEdits(doc, [
      { kind: 'note', noteId: 'ed1', blockId: 'p0b0', at: 5, text: 'An editorial gloss.' }
    ])
    const prepared = prepareFootnotes(withNote.blocks, withNote.footnotes)
    expect([...prepared.notes.values()].map((n) => [n.mark, n.text])).toEqual([
      ['1', 'An editorial gloss.'],
      ['2', 'The printer’s note.']
    ])
  })

  it('leaves the block’s text alone even where a printed marker is stripped', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'A mark here.1 Then more.' },
        { kind: 'footnote', text: 'Printed.', marker: '1' }
      ])
    ])
    const withNote = applyEdits(doc, [
      { kind: 'note', noteId: 'ed1', blockId: 'p0b0', at: 24, text: 'Mine.' }
    ])
    const prepared = prepareFootnotes(withNote.blocks, withNote.footnotes)
    expect(prepared.blocks[0]!.text).toBe('A mark here. Then more.')
    expect(prepared.blocks[0]!.references).toHaveLength(2)
  })

  it('replaces an earlier draft of the same note rather than adding a second', () => {
    const doc = applyEdits(book(), [
      { kind: 'note', noteId: 'ed1', blockId: 'p0b1', at: 5, text: 'First draft.' },
      { kind: 'note', noteId: 'ed1', blockId: 'p0b1', at: 5, text: 'Second draft.' }
    ])
    expect(doc.footnotes).toHaveLength(1)
    expect(doc.footnotes[0]!.text).toBe('Second draft.')
  })

  it('keeps two notes on one paragraph as two notes', () => {
    // Keying them by the block would make writing the second erase the first.
    let edits = withEdit([], {
      kind: 'note',
      noteId: 'ed1',
      blockId: 'p0b1',
      at: 5,
      text: 'One.'
    })
    edits = withEdit(edits, {
      kind: 'note',
      noteId: 'ed2',
      blockId: 'p0b1',
      at: 20,
      text: 'Two.'
    })
    expect(applyEdits(book(), edits).footnotes).toHaveLength(2)
  })

  it('drops an empty note instead of setting a blank one at the foot of a page', () => {
    expect(noted({ text: '   ' }).footnotes).toEqual([])
  })

  it('leaves out a note whose block is gone, rather than orphaning it', () => {
    // Unlike a scanned note, nothing is lost: the editor still has what they
    // wrote, and a note reported as unplaceable would only be noise.
    const doc = applyEdits(book(), [
      { kind: 'note', noteId: 'ed1', blockId: 'p0b1', at: 5, text: 'A gloss.' },
      { kind: 'drop', blockId: 'p0b1' }
    ])
    expect(doc.footnotes).toEqual([])
  })

  it('does not disturb the book’s own notes', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'Text with a mark.1' },
        { kind: 'footnote', text: 'The printer’s.', marker: '1' }
      ])
    ])
    expect(applyEdits(doc, []).footnotes).toHaveLength(1)
    const withNote = applyEdits(doc, [
      { kind: 'note', noteId: 'ed1', blockId: 'p0b0', at: 4, text: 'Mine.' }
    ])
    expect(withNote.footnotes.map((f) => f.text)).toEqual(['The printer’s.', 'Mine.'])
  })

  it('counts a note as one thing changed, whatever it hangs off', () => {
    expect(
      countEdited([
        { kind: 'note', noteId: 'ed1', blockId: 'p0b1', at: 5, text: 'a' },
        { kind: 'note', noteId: 'ed2', blockId: 'p0b1', at: 9, text: 'b' }
      ])
    ).toBe(2)
  })
})

describe('applyEdits — pictures the editor supplied', () => {
  const withPicture = (over: Partial<{ afterBlockId: string | null; caption: string }> = {}) =>
    applyEdits(book(), [
      {
        kind: 'image',
        imageId: 'img1',
        afterBlockId: over.afterBlockId === undefined ? 'p0b1' : over.afterBlockId,
        sourceWidth: 1600,
        sourceHeight: 1200,
        ...(over.caption === undefined ? {} : { caption: over.caption })
      }
    ])

  const anchorOf = (doc: BookDocument, id: string): number =>
    [...anchorIllustrations(doc.blocks, doc.illustrations).entries()].find(([, list]) =>
      list.some((i) => i.id === id)
    )![0]

  it('adds a picture the scan never had', () => {
    const doc = withPicture()
    expect(doc.illustrations).toHaveLength(1)
    expect(doc.illustrations[0]).toMatchObject({
      id: 'img1',
      origin: 'supplied',
      sourceWidth: 1600,
      sourceHeight: 1200
    })
  })

  it('puts it after the block the editor chose', () => {
    expect(anchorOf(withPicture(), 'img1')).toBe(1)
  })

  it('accepts the front of the book as a place, for a frontispiece', () => {
    expect(anchorOf(withPicture({ afterBlockId: null }), 'img1')).toBe(-1)
  })

  it('carries a caption when one was given, and none when not', () => {
    expect(withPicture({ caption: 'The author, 1662.' }).illustrations[0]!.caption).toBe(
      'The author, 1662.'
    )
    expect(withPicture({ caption: '   ' }).illustrations[0]!.caption).toBeNull()
    expect(withPicture().illustrations[0]!.caption).toBeNull()
  })

  it('leaves the book’s own pictures alone', () => {
    const doc = assembleBook([page(0, [{ kind: 'paragraph', text: 'Text.' }])], {
      illustrations: [{ id: 'cut1', pageIndex: 0, sourceWidth: 100, sourceHeight: 100 }]
    })
    const both = applyEdits(doc, [
      { kind: 'image', imageId: 'img1', afterBlockId: 'p0b0', sourceWidth: 10, sourceHeight: 10 }
    ])
    expect(both.illustrations.map((i) => i.id)).toEqual(['cut1', 'img1'])
    expect(both.illustrations[0]!.origin).toBeUndefined()
  })

  it('goes when the block it was placed after goes', () => {
    const doc = applyEdits(book(), [
      { kind: 'image', imageId: 'img1', afterBlockId: 'p0b1', sourceWidth: 10, sourceHeight: 10 },
      { kind: 'drop', blockId: 'p0b1' }
    ])
    expect(doc.illustrations).toEqual([])
  })

  it('is measured for resolution like any other picture', () => {
    // The DPI check divides these pixels by the printed inches, and does not
    // care that nobody scanned them.
    const doc = withPicture()
    expect(doc.illustrations[0]!.sourceWidth).toBe(1600)
  })
})

describe('applyEdits — an anchor outliving the block it names', () => {
  const illustrated = () =>
    assembleBook([page(0, [{ kind: 'paragraph', text: 'First half. Second half.' }])], {
      illustrations: [{ id: 'cut1', pageIndex: 0, sourceWidth: 10, sourceHeight: 10 }]
    })

  const anchorOf = (doc: BookDocument, id: string): number =>
    [...anchorIllustrations(doc.blocks, doc.illustrations).entries()].find(([, list]) =>
      list.some((i) => i.id === id)
    )![0]

  it('follows a split to the second half — after the block is after all of it', () => {
    // Without this, splitting a paragraph would quietly unpin every picture
    // that followed it, which is ordinary editing breaking placement.
    const doc = applyEdits(illustrated(), [
      { kind: 'anchor', illustrationId: 'cut1', afterBlockId: 'p0b0' },
      { kind: 'split', blockId: 'p0b0', at: 12 }
    ])
    expect(ids(doc)).toEqual(['p0b0/1', 'p0b0/2'])
    expect(anchorOf(doc, 'cut1')).toBe(1)
  })

  it('follows a merge to the block that absorbed it', () => {
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'One.' },
        { kind: 'paragraph', text: 'Two.' }
      ])
    ])
    const moved = applyEdits(doc, [
      { kind: 'image', imageId: 'img1', afterBlockId: 'p0b1', sourceWidth: 10, sourceHeight: 10 },
      { kind: 'merge', blockId: 'p0b0' }
    ])
    expect(texts(moved)).toEqual(['One. Two.'])
    expect(anchorOf(moved, 'img1')).toBe(0)
  })

  it('sends a supplied picture to the end when its anchor is truly gone', () => {
    // It stays in the book, somewhere predictable — rather than being lost, or
    // landing at the front where it would read as a frontispiece.
    const doc = assembleBook([
      page(0, [
        { kind: 'paragraph', text: 'One.' },
        { kind: 'paragraph', text: 'Two.' }
      ])
    ])
    const orphaned = applyEdits(doc, [
      { kind: 'image', imageId: 'img1', afterBlockId: 'p0b0', sourceWidth: 10, sourceHeight: 10 }
    ])
    // Re-anchor onto a block that does not exist at all, as a stale saved edit
    // would after the page it named was removed.
    const stale = {
      ...orphaned,
      illustrations: orphaned.illustrations.map((i) => ({ ...i, anchorAfterBlockId: 'gone' }))
    }
    expect(anchorOf(stale, 'img1')).toBe(stale.blocks.length - 1)
  })
})

describe('applyEdits — a division the editor wrote', () => {
  const introduced = (
    over: Partial<{ placement: 'front' | 'back'; title: string; text: string }> = {}
  ) =>
    applyEdits(book(), [
      {
        kind: 'section',
        sectionId: 'intro',
        placement: over.placement ?? 'front',
        title: over.title ?? 'Introduction',
        text:
          over.text ??
          'The author of this treatise is unknown.\n\nWhat follows is a reprint of the 1662 text.'
      }
    ])

  it('adds a section the scan never contained', () => {
    const doc = introduced()
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]!.title).toBe('Introduction')
    expect(doc.sections[0]!.placement).toBe('front')
  })

  it('splits prose into paragraphs on blank lines', () => {
    // The convention prose already uses, so nobody has to learn a markup
    // language — and a single unbroken run would set as a wall of text.
    expect(introduced().sections[0]!.blocks.map((b) => b.text)).toEqual([
      'The author of this treatise is unknown.',
      'What follows is a reprint of the 1662 text.'
    ])
  })

  it('folds the newlines inside a paragraph, which are wrapping not structure', () => {
    const doc = introduced({ text: 'One sentence\nwrapped by the box.\n\nA second.' })
    expect(doc.sections[0]!.blocks.map((b) => b.text)).toEqual([
      'One sentence wrapped by the box.',
      'A second.'
    ])
  })

  it('leaves the book’s own text completely alone', () => {
    expect(texts(introduced())).toEqual(texts(book()))
  })

  it('drops a section with a title and no prose', () => {
    // Its title alone would print as a division of the book with nothing in it.
    expect(introduced({ text: '   \n\n  ' }).sections).toEqual([])
  })

  it('names an untitled section rather than printing a blank heading', () => {
    expect(introduced({ title: '  ' }).sections[0]!.title).toBe('Introduction')
  })

  it('replaces an earlier draft rather than adding a second section', () => {
    const doc = applyEdits(book(), [
      { kind: 'section', sectionId: 'intro', placement: 'front', title: 'Intro', text: 'First.' },
      { kind: 'section', sectionId: 'intro', placement: 'front', title: 'Intro', text: 'Second.' }
    ])
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]!.blocks[0]!.text).toBe('Second.')
  })

  it('keeps a picture pinned to a paragraph of a written section', () => {
    // An introduction that discusses a cover and then shows it. Supplied
    // pictures were filtered against the *body* block ids alone, so an anchor
    // into a section matched nothing and the picture was dropped before the
    // engine ever saw it — silently, since nothing had been laid out yet to
    // report it as missing.
    const doc = applyEdits(book(), [
      {
        kind: 'section',
        sectionId: 'intro',
        placement: 'front',
        title: 'Before You Begin',
        text: 'First paragraph.\n\nThe paragraph about the cover.'
      },
      {
        kind: 'image',
        imageId: 'cover',
        afterBlockId: 'intro/b1',
        sourceWidth: 1653,
        sourceHeight: 2337,
        caption: 'The cover of the 1916 edition.'
      }
    ])
    const supplied = doc.illustrations.find((i) => i.id === 'cover')
    expect(supplied).toBeDefined()
    expect(supplied!.anchorAfterBlockId).toBe('intro/b1')
  })

  it('still drops a picture pinned to a block that is gone', () => {
    const doc = applyEdits(book(), [
      {
        kind: 'image',
        imageId: 'orphan',
        afterBlockId: 'nowhere/b9',
        sourceWidth: 10,
        sourceHeight: 10
      }
    ])
    expect(doc.illustrations.find((i) => i.id === 'orphan')).toBeUndefined()
  })

  it('keeps a front and a back section apart', () => {
    const doc = applyEdits(book(), [
      { kind: 'section', sectionId: 'a', placement: 'front', title: 'Introduction', text: 'One.' },
      { kind: 'section', sectionId: 'b', placement: 'back', title: 'Afterword', text: 'Two.' }
    ])
    expect(doc.sections.map((x) => [x.id, x.placement])).toEqual([
      ['a', 'front'],
      ['b', 'back']
    ])
  })
})

describe('applyEdits — retouching a picture', () => {
  const illustrated = () =>
    assembleBook([page(0, [{ kind: 'paragraph', text: 'Text.' }])], {
      illustrations: [{ id: 'cut1', pageIndex: 0, sourceWidth: 1200, sourceHeight: 900 }]
    })

  const retouched = (ops: ImageEditOp[]) =>
    applyEdits(illustrated(), [{ kind: 'retouch', illustrationId: 'cut1', ops }])

  it('carries the op stack beside the picture rather than applying it', () => {
    // Nothing here touches pixels — the platform re-applies the stack over the
    // original every time, which is what makes any of it undoable.
    const ops = [levels({ black: 30, white: 220, gamma: 1 })]
    expect(retouched(ops).illustrations[0]!.edits).toEqual(ops)
  })

  it('moves the source size, because a crop moves the resolution', () => {
    // This is the whole reason the core knows about retouching at all: the DPI
    // check divides source pixels by printed inches, and a crop that halves a
    // picture halves what it has to print with.
    const doc = retouched([crop({ x: 100, y: 50, width: 600, height: 400 })])
    expect(doc.illustrations[0]).toMatchObject({ sourceWidth: 600, sourceHeight: 400 })
  })

  it('swaps the axes on a quarter turn', () => {
    const doc = retouched([rotate(90)])
    expect(doc.illustrations[0]).toMatchObject({ sourceWidth: 900, sourceHeight: 1200 })
  })

  it('leaves the size alone for the tone tools', () => {
    const doc = retouched([grayscale(), levels({ black: 10, white: 240, gamma: 1 })])
    expect(doc.illustrations[0]).toMatchObject({ sourceWidth: 1200, sourceHeight: 900 })
  })

  it('refuses a stack that would leave nothing of the picture', () => {
    // A crop dragged to zero would otherwise remove the picture from the book
    // without ever saying it had.
    const doc = retouched([crop({ x: 0, y: 0, width: 0, height: 0 })])
    expect(doc.illustrations[0]!.edits).toBeUndefined()
    expect(doc.illustrations[0]).toMatchObject({ sourceWidth: 1200, sourceHeight: 900 })
  })

  it('replaces the stack as a slider moves rather than piling them up', () => {
    const doc = applyEdits(illustrated(), [
      { kind: 'retouch', illustrationId: 'cut1', ops: [brightness(10)] },
      { kind: 'retouch', illustrationId: 'cut1', ops: [brightness(25)] }
    ])
    expect(doc.illustrations[0]!.edits).toEqual([brightness(25)])
  })

  it('retouches a picture the editor supplied, not only one cut from a scan', () => {
    const doc = applyEdits(book(), [
      { kind: 'image', imageId: 'img1', afterBlockId: 'p0b1', sourceWidth: 800, sourceHeight: 600 },
      {
        kind: 'retouch',
        illustrationId: 'img1',
        ops: [crop({ x: 0, y: 0, width: 400, height: 300 })]
      }
    ])
    expect(doc.illustrations[0]).toMatchObject({ sourceWidth: 400, sourceHeight: 300 })
  })

  it('leaves a picture nobody retouched completely alone', () => {
    expect(applyEdits(illustrated(), []).illustrations[0]!.edits).toBeUndefined()
  })
})

/**
 * `applyEdits` re-derives the chapter list, because retyping a heading changes
 * what the contents says. It used to re-derive it with its own copy of the
 * rule, and that copy dropped every recovered synopsis: an analytical contents
 * was read off the original, matched to the body, and then silently discarded
 * on the way to the page — on every correction, including none.
 */
describe('the editor’s own prose carries italics', () => {
  const bare = (): BookDocument => ({
    blocks: [{ id: 'p0b0', kind: 'paragraph', text: 'Body.', sourcePages: [0] }],
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  })

  it('reads <i> in a section the same way a correction does', () => {
    const out = applyEdits(bare(), [
      {
        kind: 'section',
        sectionId: 'glossary',
        placement: 'back',
        title: 'Glossary',
        text: 'Blavatsky wrote <i>Isis Unveiled</i> in 1877.'
      }
    ])
    const block = out.sections[0]!.blocks[0]!
    // The tag is gone from the text and has become word indices, exactly as it
    // does for a retyped page. Printed as a tag, it was three visible angle
    // brackets in the middle of a sentence.
    expect(block.text).toBe('Blavatsky wrote Isis Unveiled in 1877.')
    expect(block.emphasis).toEqual([2, 3])
  })

  it('leaves prose with no tags in it exactly as written', () => {
    const out = applyEdits(bare(), [
      {
        kind: 'section',
        sectionId: 'introduction',
        placement: 'front',
        title: 'Before You Begin',
        text: 'In 1895 a German physicist noticed a screen had begun to glow.'
      }
    ])
    const block = out.sections[0]!.blocks[0]!
    expect(block.text).toBe('In 1895 a German physicist noticed a screen had begun to glow.')
    expect(block.emphasis).toBeUndefined()
  })
})

describe('chapters survive an edit', () => {
  const doc = (): BookDocument => ({
    blocks: [
      { id: 'p0b0', kind: 'heading', text: 'LESSON I.', sourcePages: [0] },
      { id: 'p0b1', kind: 'heading', text: 'THE ASTRAL SENSES.', sourcePages: [0] },
      { id: 'p0b2', kind: 'paragraph', text: 'The student of occultism.', sourcePages: [0] }
    ],
    footnotes: [],
    chapters: [
      {
        id: 'p0b0',
        title: 'THE ASTRAL SENSES.',
        label: 'LESSON I.',
        level: 1,
        blockIndex: 0,
        sourcePage: 0,
        synopsis: 'What the senses report, and what they leave out.',
        contentsTitle: 'The Astral Senses of Man'
      }
    ],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  })

  it('keeps the synopsis read off the original contents', () => {
    const out = applyEdits(doc(), [])
    expect(out.chapters).toHaveLength(1)
    expect(out.chapters[0]!.synopsis).toBe('What the senses report, and what they leave out.')
  })

  /**
   * And everything else read off that page with it.
   *
   * `chaptersOf` carried `synopsis` by name, which was the whole of what the
   * contents gave a chapter when it was written. `contentsTitle` is the second
   * thing it gives, and a list that carries one field by name loses the next
   * one added beside it, silently, on every correction. That is the fault this
   * whole block of tests exists for, one field later.
   */
  it('keeps the name the original contents used, too', () => {
    const out = applyEdits(doc(), [])
    expect(out.chapters[0]!.contentsTitle).toBe('The Astral Senses of Man')

    const retyped = applyEdits(doc(), [
      { kind: 'text', blockId: 'p0b1', text: 'THE ASTRAL SENSES' }
    ])
    expect(retyped.chapters[0]!.contentsTitle).toBe('The Astral Senses of Man')
  })

  it('still groups the run after a heading is retyped', () => {
    const out = applyEdits(doc(), [{ kind: 'text', blockId: 'p0b1', text: 'THE ASTRAL SENSES' }])
    expect(out.chapters).toHaveLength(1)
    expect(out.chapters[0]!.title).toBe('THE ASTRAL SENSES')
    expect(out.chapters[0]!.label).toBe('LESSON I.')
  })
})

/**
 * The channel that had no middle.
 *
 * `section` puts the editor's prose before the body or after it, and there was
 * no way to put any inside. Binding two 1915 manuals into one volume needs
 * exactly that: a divider saying "Book Two" between the last leaf of one and
 * the first of the other. Without this the only place to put those words was a
 * transcription, where they would have been a claim about what the paper says.
 */
describe('applyEdits — a block the editor wrote, inside the body', () => {
  const divider = (afterBlockId: string | null): BookEdit => ({
    kind: 'insert',
    insertId: 'book-two',
    afterBlockId,
    blockKind: 'heading',
    text: 'BOOK TWO',
    level: 1
  })

  it('places it after the block it names', () => {
    const doc = applyEdits(book(), [divider('p0b2')])
    expect(doc.blocks.map((b) => b.text)).toEqual([
      'Of the Air',
      'The chirnrgeon examined the specimen.',
      'A second paragraph.',
      'BOOK TWO',
      'A third, on the next leaf.'
    ])
  })

  it('places it at the very front when it names nothing', () => {
    expect(applyEdits(book(), [divider(null)]).blocks[0]!.text).toBe('BOOK TWO')
  })

  it('points at no leaf, because no leaf is behind it', () => {
    const doc = applyEdits(book(), [divider('p0b2')])
    expect(doc.blocks.find((b) => b.text === 'BOOK TWO')!.sourcePages).toEqual([])
  })

  it('becomes a chapter, so the contents lists the division', () => {
    const doc = applyEdits(book(), [divider('p0b2')])
    expect(doc.chapters.map((c) => c.title)).toContain('BOOK TWO')
  })

  it('breaks a run of headings, so the divider is not folded into the chapter after it', () => {
    // The seam this exists for: one book ends on a heading and the next opens
    // on one, and `deriveChapters` joins consecutive headings into a single
    // chapter. A divider between them has to separate, not join.
    const ended = assembleBook([
      page(0, [{ kind: 'heading', text: 'THE END.' }]),
      page(1, [
        { kind: 'heading', text: 'CHAPTER I.' },
        { kind: 'heading', text: 'THE SEVEN PLANES.' },
        { kind: 'paragraph', text: 'EVERY student of occultism.' }
      ])
    ])
    // The number-line rule already keeps `THE END.` out of the chapter after
    // it, since it is a complete heading rather than a number awaiting a title.
    expect(ended.chapters.map((c) => c.title)).toEqual(['THE END.', 'THE SEVEN PLANES.'])
    const doc = applyEdits(ended, [
      {
        kind: 'insert',
        insertId: 'book-two',
        afterBlockId: 'p0b0',
        blockKind: 'heading',
        text: 'BOOK TWO',
        level: 1
      }
    ])
    expect(doc.chapters.map((c) => c.title)).toEqual(['THE END.', 'BOOK TWO', 'THE SEVEN PLANES.'])
  })

  it('sets a label over a divider it is given one, and still separates', () => {
    // The two cases a rule cannot tell apart, side by side. "BOOK TWO" alone
    // must separate the book that ended from the chapter that opens; "BOOK TWO"
    // *over* "THE ASTRAL WORLD" is one opening. Both are a heading the editor
    // wrote followed by a heading, so the editor says which, and the run rule —
    // which reads the words, because it has nothing else — is left for the
    // openings that came off the leaf.
    const ended = assembleBook([
      page(0, [{ kind: 'heading', text: 'THE END.' }]),
      page(1, [
        { kind: 'heading', text: 'CHAPTER I.' },
        { kind: 'heading', text: 'THE SEVEN PLANES.' },
        { kind: 'paragraph', text: 'EVERY student of occultism.' }
      ])
    ])
    const doc = applyEdits(ended, [
      {
        kind: 'insert',
        insertId: 'book-two',
        afterBlockId: 'p0b0',
        blockKind: 'heading',
        text: 'THE ASTRAL WORLD',
        label: 'BOOK TWO',
        level: 1
      }
    ])
    expect(doc.chapters.map((c) => c.title)).toEqual([
      'THE END.',
      'THE ASTRAL WORLD',
      'THE SEVEN PLANES.'
    ])
    const divider = doc.chapters.find((c) => c.title === 'THE ASTRAL WORLD')!
    expect(divider.label).toBe('BOOK TWO')
    // And the chapter after it keeps its own number rather than being absorbed.
    expect(doc.chapters.find((c) => c.title === 'THE SEVEN PLANES.')!.label).toBe('CHAPTER I.')
  })

  it('is left out when its anchor is gone, rather than landing somewhere else', () => {
    const doc = applyEdits(book(), [{ kind: 'drop', blockId: 'p0b2' }, divider('p0b2')])
    expect(doc.blocks.map((b) => b.text)).not.toContain('BOOK TWO')
  })

  it('is left out when it is empty', () => {
    const doc = applyEdits(book(), [
      {
        kind: 'insert',
        insertId: 'book-two',
        afterBlockId: 'p0b2',
        blockKind: 'heading',
        text: '   '
      }
    ])
    expect(doc.blocks.map((b) => b.text)).not.toContain('   ')
  })

  it('reads its inline markup, as a written section does', () => {
    const doc = applyEdits(book(), [
      {
        kind: 'insert',
        insertId: 'book-two',
        afterBlockId: 'p0b2',
        blockKind: 'paragraph',
        text: 'Book Two: <i>The Astral World</i>'
      }
    ])
    const block = doc.blocks.find((b) => b.text.startsWith('Book Two'))!
    expect(block.text).toBe('Book Two: The Astral World')
    expect(block.emphasis).toBeDefined()
  })

  it('collapses by insertId, so re-wording one does not add a second', () => {
    const list = withEdit(withEdit([], divider('p0b2')), {
      kind: 'insert',
      insertId: 'book-two',
      afterBlockId: 'p0b2',
      blockKind: 'heading',
      text: 'BOOK TWO — THE ASTRAL WORLD',
      level: 1
    })
    expect(list).toHaveLength(1)
    expect(countEdited(list)).toBe(1)
  })
})
