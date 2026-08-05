import { describe, it, expect } from 'vitest'
import { emitBody, emitAsides, attachFootnotes, tocFromDocument } from '@core/typeset'
import { assembleBook } from '@core/assemble'
import type { BookDocument } from '@core/assemble'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'
import type { PageRole } from '@core/pages'

function page(
  pageIndex: number,
  blocks: TranscribedBlock[],
  role: PageRole = 'body'
): PageTranscription {
  return { pageIndex, role, blocks, uncertain: [], furniture: {} }
}

/** Build a document through the real assembly path, so tests exercise both. */
function doc(blocks: TranscribedBlock[], role: PageRole = 'body'): BookDocument {
  return assembleBook([page(0, blocks, role)])
}

describe('emitBody — block kinds', () => {
  it('emits paragraphs as plain text separated by blank lines', () => {
    const out = emitBody(
      doc([
        { kind: 'paragraph', text: 'First paragraph.' },
        { kind: 'paragraph', text: 'Second paragraph.' }
      ])
    )
    expect(out).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('maps heading levels onto book sectioning commands', () => {
    const out = emitBody(
      doc([
        { kind: 'heading', text: 'Chapter IV', level: 1 },
        { kind: 'heading', text: 'Of Simples', level: 2 },
        { kind: 'heading', text: 'A Note', level: 3 }
      ])
    )
    expect(out).toContain('\\chapter{Chapter IV}')
    expect(out).toContain('\\section{Of Simples}')
    expect(out).toContain('\\subsection{A Note}')
  })

  it('clamps an absurd heading level rather than emitting garbage', () => {
    const out = emitBody(doc([{ kind: 'heading', text: 'Deep', level: 6 }]))
    expect(out).toContain('\\paragraph{Deep}')
  })

  it('sets block quotes in a quote environment', () => {
    const out = emitBody(doc([{ kind: 'blockquote', text: 'As the ancients helde.' }]))
    expect(out).toContain('\\begin{quote}')
    expect(out).toContain('\\end{quote}')
  })

  it('preserves the poet’s line breaks in verse', () => {
    const out = emitBody(doc([{ kind: 'verse', text: 'The spirit ascendeth\nand is gathered' }]))
    expect(out).toContain('\\begin{verse}')
    expect(out).toContain('\\\\') // explicit line break between verse lines
    expect(out).toContain('\\end{verse}')
  })

  it('groups consecutive list items into one list', () => {
    const out = emitBody(
      doc([
        { kind: 'list-item', text: 'Sulphur' },
        { kind: 'list-item', text: 'Mercury' },
        { kind: 'paragraph', text: 'And so forth.' }
      ])
    )
    expect(out.match(/\\begin\{itemize\}/g)).toHaveLength(1)
    expect(out).toContain('\\item Sulphur')
    expect(out).toContain('\\item Mercury')
    expect(out.indexOf('\\end{itemize}')).toBeLessThan(out.indexOf('And so forth.'))
  })

  it('starts a new list after intervening prose', () => {
    const out = emitBody(
      doc([
        { kind: 'list-item', text: 'One' },
        { kind: 'paragraph', text: 'Interruption.' },
        { kind: 'list-item', text: 'Two' }
      ])
    )
    expect(out.match(/\\begin\{itemize\}/g)).toHaveLength(2)
  })
})

describe('emitBody — escaping', () => {
  it('escapes LaTeX special characters in body text', () => {
    const out = emitBody(doc([{ kind: 'paragraph', text: 'Cost 50% & rising #1 {sic}' }]))
    expect(out).toContain('50\\%')
    expect(out).toContain('\\&')
    expect(out).toContain('\\#')
    expect(out).not.toMatch(/(?<!\\)\{sic\}/)
  })

  it('escapes heading text too', () => {
    const out = emitBody(doc([{ kind: 'heading', text: 'Of 100% Purity', level: 1 }]))
    expect(out).toContain('\\chapter{Of 100\\% Purity}')
  })
})

describe('attachFootnotes', () => {
  const note = (id: string, marker: string, text: string) => ({
    id,
    originalMarker: marker,
    text,
    pageIndex: 0,
    orphaned: false
  })

  it('replaces the in-text marker with a real footnote command', () => {
    const { text, used } = attachFootnotes('against all putrefaction.1', [
      note('fn1', '1', 'See Croll.')
    ])
    expect(text).toContain('\\footnote{See Croll.}')
    expect(used.has('fn1')).toBe(true)
  })

  it('does not match a digit marker inside a longer number', () => {
    const { text, used } = attachFootnotes('printed in 1662.', [note('fn1', '1', 'A note.')])
    expect(text).toBe('printed in 1662.')
    expect(used.size).toBe(0)
  })

  it('replaces only the first occurrence of a marker', () => {
    const { text } = attachFootnotes('a * and another *', [note('fn1', '*', 'Note.')])
    expect(text.match(/\\footnote/g)).toHaveLength(1)
  })

  it('handles symbol markers that are regex metacharacters', () => {
    const { text } = attachFootnotes('a note here†', [note('fn1', '†', 'Dagger note.')])
    expect(text).toContain('\\footnote{Dagger note.}')
  })
})

describe('emitBody — footnotes', () => {
  it('attaches a footnote at its reference mark', () => {
    const out = emitBody(
      assembleBook([
        page(0, [
          { kind: 'paragraph', text: 'It helde it soveraigne.1' },
          { kind: 'footnote', text: 'See the Basilica Chymica.', marker: '1' }
        ])
      ])
    )
    expect(out).toContain('soveraigne.\\footnote{See the Basilica Chymica.}')
  })

  it('escapes the note text but keeps the command intact', () => {
    const out = emitBody(
      assembleBook([
        page(0, [
          { kind: 'paragraph', text: 'Body.1' },
          { kind: 'footnote', text: 'Costs 5% more', marker: '1' }
        ])
      ])
    )
    expect(out).toContain('\\footnote{Costs 5\\% more}')
  })

  it('omits an orphaned note from the flow by default', () => {
    const out = emitBody(
      assembleBook([
        page(0, [
          { kind: 'paragraph', text: 'No marker in this text.' },
          { kind: 'footnote', text: 'A stranded note.', marker: '9' }
        ])
      ])
    )
    expect(out).not.toContain('\\footnote{A stranded note.}')
  })

  it('appends notes it could not place rather than losing the author’s words', () => {
    const out = emitBody(
      assembleBook([
        page(0, [
          { kind: 'paragraph', text: 'No marker here.' },
          { kind: 'footnote', text: 'A stranded note.', marker: '9' }
        ])
      ]),
      { omitOrphanFootnotes: false }
    )
    expect(out).toContain('Notes:')
    expect(out).toContain('A stranded note.')
  })
})

describe('emitAsides', () => {
  it('sets dedications apart, centred and italic', () => {
    const assembled = assembleBook([
      page(0, [{ kind: 'paragraph', text: 'To my patron.' }], 'dedication'),
      page(1, [{ kind: 'paragraph', text: 'Body.' }])
    ])
    const out = emitAsides(assembled)
    expect(out).toContain('\\begin{center}')
    expect(out).toContain('\\itshape To my patron.')
  })

  it('is empty when there are no asides', () => {
    expect(emitAsides(doc([{ kind: 'paragraph', text: 'Body.' }]))).toBe('')
  })
})

describe('tocFromDocument', () => {
  it('lists chapters with their levels for the regenerated contents', () => {
    const assembled = assembleBook([
      page(0, [
        { kind: 'heading', text: 'Chapter IV', level: 1 },
        { kind: 'paragraph', text: 'Body.' },
        { kind: 'heading', text: 'Of Simples', level: 2 }
      ])
    ])
    expect(tocFromDocument(assembled)).toEqual([
      { title: 'Chapter IV', level: 1 },
      { title: 'Of Simples', level: 2 }
    ])
  })
})

describe('emitBody — whole-document smoke test', () => {
  it('emits a coherent fragment for a realistic page set', () => {
    const assembled = assembleBook([
      page(0, [{ kind: 'paragraph', text: 'THE ALCHEMIST' }], 'title-page'),
      page(1, [
        { kind: 'heading', text: 'Chapter IV', level: 1 },
        { kind: 'paragraph', text: 'The alembick being set upon', continuesNext: true }
      ]),
      page(2, [
        { kind: 'paragraph', text: 'a gentle fire.1', continuesPrevious: true },
        { kind: 'footnote', text: 'See Croll, lib. ii.', marker: '1' }
      ])
    ])
    const out = emitBody(assembled)

    // Front matter excluded, seam joined, footnote attached, chapter emitted.
    expect(out).not.toContain('THE ALCHEMIST')
    expect(out).toContain('\\chapter{Chapter IV}')
    expect(out).toContain('The alembick being set upon a gentle fire.')
    expect(out).toContain('\\footnote{See Croll, lib. ii.}')
  })
})

describe('emitBody — drop caps', () => {
  const chapterDoc = (text: string): BookDocument =>
    assembleBook([
      page(0, [
        { kind: 'heading', text: 'Chapter I', level: 1 },
        { kind: 'paragraph', text },
        { kind: 'paragraph', text: 'A later paragraph.' }
      ])
    ])

  it('is off unless asked for', () => {
    expect(emitBody(chapterDoc('The alembick.'))).not.toContain('\\lettrine')
  })

  it('lifts the initial and sets the rest of the first word beside it', () => {
    const out = emitBody(chapterDoc('The alembick.'), { dropCap: true })
    expect(out).toContain('\\lettrine{T}{he} alembick.')
  })

  it('applies only to the paragraph that opens the chapter', () => {
    const out = emitBody(chapterDoc('The alembick.'), { dropCap: true })
    expect(out.match(/\\lettrine/g)).toHaveLength(1)
    expect(out).toContain('A later paragraph.')
  })

  it('handles a one-letter opening word', () => {
    expect(emitBody(chapterDoc('A vessel of glass.'), { dropCap: true })).toContain(
      '\\lettrine{A}{} vessel'
    )
  })

  it('leaves a paragraph alone when it has no clean initial to lift', () => {
    for (const opener of ['“The alembick.', '1662 was the year.']) {
      const out = emitBody(chapterDoc(opener), { dropCap: true })
      expect(out).not.toContain('\\lettrine')
    }
  })

  it('does not decorate a paragraph that merely follows a subsection', () => {
    const out = emitBody(
      assembleBook([
        page(0, [
          { kind: 'heading', text: 'Of Simples', level: 2 },
          { kind: 'paragraph', text: 'The lesser sort.' }
        ])
      ]),
      { dropCap: true }
    )
    expect(out).not.toContain('\\lettrine')
  })
})
