import { describe, it, expect } from 'vitest'
import { assembleBook } from '@core/assemble'
import { applyEdits, gatheredNotesToFootnotes, type BookEdit } from '@core/edits'
import { prepareFootnotes } from '@core/layout/footnotes'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe/schema'

const page = (pageIndex: number, blocks: TranscribedBlock[]): PageTranscription => ({
  pageIndex,
  role: 'body',
  blocks,
  uncertain: [],
  furniture: {}
})
const para = (text: string, extra: Partial<TranscribedBlock> = {}): TranscribedBlock => ({
  kind: 'paragraph',
  text,
  ...extra
})
const head = (text: string): TranscribedBlock => ({ kind: 'heading', text, level: 2 })

/**
 * Two chapters, each with its notes gathered after it, the way _The
 * Structure of Magic_ sets them: superscript marks in the text, numbered
 * paragraphs under a head.
 */
function book(
  over: { ch1?: TranscribedBlock[]; ch2?: TranscribedBlock[]; notes1?: TranscribedBlock[] } = {}
): PageTranscription[] {
  return [
    page(
      0,
      over.ch1 ?? [
        head('CHAPTER ONE'),
        para('Smell and taste are little used as ways of gaining information.¹'),
        para('Most of us value one representational system above the others.²')
      ]
    ),
    page(
      1,
      over.notes1 ?? [
        head('FOOTNOTES FOR CHAPTER 1'),
        para('1. We talk here about major input channels.'),
        para('A second paragraph of the same note.'),
        para('2. By most highly valued system we mean the one used most.', { strong: [0] })
      ]
    ),
    page(
      2,
      over.ch2 ?? [
        head('CHAPTER TWO'),
        para('The rule moves the Noun Phrase¹ to the front of the sentence.'),
        para('This is the deletion the client makes without noticing.¹')
      ]
    ),
    page(3, [
      head('FOOTNOTES FOR CHAPTER 2'),
      para('1. Deletion is treated fully in the appendix.')
    ])
  ]
}

/** Which block's text each note is claimed from, by the engine's own walk. */
function claims(pages: PageTranscription[], edits: BookEdit[]): Map<string, string> {
  const doc = applyEdits(assembleBook(pages), edits)
  const out = new Map<string, string>()
  prepareFootnotes(doc.blocks, doc.footnotes, doc.bareMarks ?? []).blocks.forEach((pb, i) => {
    for (const r of pb.references) {
      const note = doc.footnotes.find((n) => n.id === r.noteId)!
      out.set(note.text.slice(0, 20), doc.blocks[i]!.text)
    }
  })
  return out
}

describe('notes gathered at the back of a chapter', () => {
  it('become footnotes marked with their number, and the head goes', () => {
    const out = gatheredNotesToFootnotes(book(), [])
    const leaf1 = out.transcriptions[1]!.blocks
    expect(leaf1.map((b) => b.kind)).toEqual(['footnote', 'footnote', 'footnote'])
    expect(leaf1.map((b) => b.marker)).toEqual(['¹', undefined, '²'])
    expect(leaf1[0]!.text).toBe('We talk here about major input channels.')
    expect(out.report.join('\n')).toContain('FOOTNOTES FOR CHAPTER 1')
  })

  it('join an unnumbered paragraph to the note above it', () => {
    const out = gatheredNotesToFootnotes(book(), [])
    const notes = assembleBook(out.transcriptions).footnotes
    expect(notes).toHaveLength(3)
    expect(notes[0]!.text).toContain('A second paragraph of the same note.')
  })

  it('take the number off when it sits inside a tag, and the empty tag with it', () => {
    const out = gatheredNotesToFootnotes(book(), [])
    const note2 = out.transcriptions[1]!.blocks[2]!
    expect(note2.marker).toBe('²')
    expect(note2.text).toBe('By most highly valued system we mean the one used most.')
    expect(note2.strong ?? []).toEqual([])
  })

  it('leave a block already set as a footnote as it is', () => {
    const done: TranscribedBlock = { kind: 'footnote', text: 'Set already.', marker: '²' }
    const out = gatheredNotesToFootnotes(
      book({ notes1: [head('FOOTNOTES FOR CHAPTER 1'), para('1. One.'), done] }),
      []
    )
    expect(out.transcriptions[1]!.blocks[1]).toEqual(done)
  })

  it('pair every note with its own mark, with notation in the same digits declared bare', () => {
    const out = gatheredNotesToFootnotes(book(), [])
    expect(out.edits).toContainEqual({
      kind: 'bare-mark',
      blockId: expect.any(String),
      marker: '¹',
      nth: 1,
      bare: true
    })
    const c = claims(out.transcriptions, out.edits)
    expect(c.get('Deletion is treated ')).toContain('without noticing')
    expect(c.get('We talk here about m')).toContain('gaining information')
    expect(out.missingMark).toBeNull()
  })

  it('declare bare a mark that took a later chapter’s note, by where it was claimed', () => {
    // A second ¹ in chapter one with no shape of notation: the paper's second
    // reference to note 1. Left in the walk, it takes chapter two's note.
    const out = gatheredNotesToFootnotes(
      book({
        ch1: [
          head('CHAPTER ONE'),
          para('Smell and taste are little used as ways of gaining information.¹'),
          para('Most of us value one representational system above the others.²'),
          para('As the first note said, taste is rarely attended to.¹')
        ]
      }),
      []
    )
    const c = claims(out.transcriptions, out.edits)
    expect(c.get('Deletion is treated ')).toContain('without noticing')
    expect(out.report.some((l) => l.startsWith('bare:'))).toBe(true)
  })

  it('name a note whose chapter prints no mark for it, and stop', () => {
    const out = gatheredNotesToFootnotes(
      book({ ch2: [head('CHAPTER TWO'), para('This is the deletion the client makes.')] }),
      []
    )
    expect(out.missingMark).toMatchObject({ marker: '¹', leaf: 3 })
  })

  it('name it too when a later chapter’s mark takes it, which is how the fault usually looks', () => {
    // The Structure of Magic Vol. II: Part III sets no mark for its note 1,
    // and Part IV's first ¹ took it.
    const pages = [
      ...book({ ch2: [head('CHAPTER TWO'), para('This is the deletion the client makes.')] }),
      page(4, [head('CHAPTER THREE'), para('Families keep their rules without saying them.¹')]),
      page(5, [head('FOOTNOTES FOR CHAPTER 3'), para('1. See the work of Virginia Satir.')])
    ]
    const out = gatheredNotesToFootnotes(pages, [])
    expect(out.missingMark).toMatchObject({ marker: '¹', leaf: 3 })
    expect(out.report.join('\n')).toContain('has no mark in its stretch')
  })

  it('keep a note the editor will place, as printed and under its head', () => {
    const pages = book({
      ch2: [head('CHAPTER TWO'), para('This is the deletion the client makes.')]
    })
    const out = gatheredNotesToFootnotes(pages, [], { keep: [{ headLeaf: 3, note: 1 }] })
    expect(out.transcriptions[3]!.blocks).toEqual(pages[3]!.blocks)
    expect(out.missingMark).toBeNull()
  })
})

describe('edits made to a note paragraph before it was a note', () => {
  const idOf = (pages: PageTranscription[], start: string) =>
    assembleBook(pages).blocks.find((b) => b.text.startsWith(start))!.id

  it('carry a change of tags into the new note and drop the edit', () => {
    const pages = book()
    const id = idOf(pages, '1. We talk')
    const tagged: BookEdit = {
      kind: 'text',
      blockId: id,
      text: '1. We talk here about major <i>input channels.</i>'
    }
    const out = gatheredNotesToFootnotes(pages, [tagged])
    expect(out.edits).not.toContainEqual(tagged)
    const note = assembleBook(out.transcriptions).footnotes[0]!
    expect(note.emphasis).toEqual([5, 6])
  })

  it('keep a change of words as a correction to the note, so the record stays', () => {
    const pages = book()
    const id = idOf(pages, '1. We talk')
    const fixed: BookEdit = {
      kind: 'text',
      blockId: id,
      text: '1. We talk here about the major input channels.'
    }
    const out = gatheredNotesToFootnotes(pages, [fixed])
    expect(out.edits).not.toContainEqual(fixed)
    const doc = applyEdits(assembleBook(out.transcriptions), out.edits)
    expect(assembleBook(out.transcriptions).footnotes[0]!.text).toContain('about major input')
    expect(doc.footnotes[0]!.text).toContain('about the major input')
    expect(out.edits).toContainEqual(expect.objectContaining({ kind: 'note-text' }))
  })

  it('drop an edit made to the head it removes', () => {
    const pages = book()
    const id = idOf(pages, 'FOOTNOTES FOR CHAPTER 1')
    const retitled: BookEdit = { kind: 'text', blockId: id, text: 'FOOTNOTES FOR CHAPTER I' }
    const out = gatheredNotesToFootnotes(pages, [retitled])
    expect(out.edits).not.toContainEqual(retitled)
  })
})
