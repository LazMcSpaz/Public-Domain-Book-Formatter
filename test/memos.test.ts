import { describe, it, expect } from 'vitest'
import {
  applyEdits,
  clearMemo,
  countEdited,
  memoSheet,
  openMemos,
  resolveMemo,
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
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: 'The spirits are said to be light.', emphasis: [6] }
    ]),
    page(1, [{ kind: 'paragraph', text: 'A second leaf.' }])
  ])

const memo = (over: Partial<BookEdit & { kind: 'memo' }> = {}): BookEdit => ({
  kind: 'memo',
  memoId: 'm1',
  blockId: 'p0b1',
  at: 12,
  text: 'This page breaks badly in the export — have a look.',
  ...over
})

describe('a memo never reaches the book', () => {
  it('leaves the document identical to one with no edits at all', () => {
    // The channel's one hard promise: a note to the assistant cannot print.
    // Not filtered on the way out — applyEdits has no path from a memo to the
    // document, so the two results are deeply equal, footnotes included.
    expect(applyEdits(book(), [memo()])).toEqual(applyEdits(book(), []))
  })

  it('is not a note: the same record as a note does change the book', () => {
    // The teeth of the test above. If applyEdits ever started treating a memo
    // the way it treats a note, the footnote it adds is what the first
    // assertion would catch — proven here by watching the note do it.
    const asNote = applyEdits(book(), [
      { kind: 'note', noteId: 'm1', blockId: 'p0b1', at: 12, text: 'A printed footnote.' }
    ])
    expect(asNote.footnotes).toHaveLength(1)
    expect(applyEdits(book(), [memo()]).footnotes).toHaveLength(0)
  })

  it('does not count as a correction', () => {
    // "3 corrected" with nothing corrected would send someone hunting for a
    // change that was never made.
    expect(countEdited([memo()])).toBe(0)
    expect(countEdited([memo(), { kind: 'drop', blockId: 'p1b0' }])).toBe(1)
  })
})

describe('the memo lifecycle', () => {
  it('collapses re-edits of one memo and keeps two memos apart', () => {
    let edits = withEdit([], memo())
    edits = withEdit(edits, memo({ text: 'Reworded before sending.' }))
    edits = withEdit(edits, memo({ memoId: 'm2', blockId: 'p1b0', at: 0, text: 'Another.' }))
    expect(edits.filter((e) => e.kind === 'memo')).toHaveLength(2)
    expect(openMemos(edits)[0]!.text).toBe('Reworded before sending.')
  })

  it('resolution attaches an outcome and does not remove the memo', () => {
    const edits = resolveMemo([memo()], 'm1', 'Tightened the spacing rule and re-exported.')
    expect(openMemos(edits)).toHaveLength(0)
    // Still on the list: the editor clears it after reading the outcome.
    expect(edits.filter((e) => e.kind === 'memo')).toHaveLength(1)
    expect(clearMemo(edits, 'm1').filter((e) => e.kind === 'memo')).toHaveLength(0)
  })

  it('resolving a memo that does not exist changes nothing', () => {
    const edits = [memo()]
    expect(resolveMemo(edits, 'missing', 'done')).toEqual(edits)
  })
})

describe('memoSheet — what the assistant reads', () => {
  it('carries the current text of the anchor block, markup on', () => {
    const [row] = memoSheet(applyEdits(book(), [memo()]), [memo()])
    expect(row!.blockText).toBe('The spirits are said to be <i>light.</i>')
    expect(row!.sourcePages).toEqual([0])
    expect(row!.where).toBe('…The spirits')
  })

  it('orders memos by the document, sections included', () => {
    const edits: BookEdit[] = [
      memo({ memoId: 'body', blockId: 'p0b1' }),
      {
        kind: 'section',
        sectionId: 'glossary',
        placement: 'back',
        title: 'Glossary',
        text: 'Aether. The subtle medium.'
      },
      memo({ memoId: 'back', blockId: 'glossary/b0', at: 0, text: 'Is this entry marked?' }),
      {
        kind: 'section',
        sectionId: 'intro',
        placement: 'front',
        title: 'Introduction',
        text: 'A word before.'
      },
      memo({ memoId: 'front', blockId: 'intro/b0', at: 0, text: 'Read this over.' })
    ]
    const rows = memoSheet(applyEdits(book(), edits), edits)
    expect(rows.map((r) => r.memoId)).toEqual(['front', 'body', 'back'])
    expect(rows[2]!.blockText).toBe('Aether. The subtle medium.')
  })

  it('keeps a memo whose block is gone, and says so', () => {
    const edits: BookEdit[] = [{ kind: 'drop', blockId: 'p0b1' }, memo()]
    const rows = memoSheet(applyEdits(book(), edits), edits)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.blockText).toBeNull()
    expect(rows[0]!.where).toMatch(/no longer/)
  })
})

describe('a memo survives storage', () => {
  const stored = (edits: unknown[]) =>
    migrateSavedRun(
      JSON.parse(
        JSON.stringify(
          createSavedRun({
            key: 'book.pdf 1024 99',
            fileName: 'book.pdf',
            pageCount: 1,
            transcriptions: [page(0, [{ kind: 'paragraph', text: 'Text.' }])],
            failures: [],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
            modelId: 'none',
            identityAnswers: {},
            edits: edits as BookEdit[]
          })
        )
      )
    )

  it('round-trips open and resolved alike', () => {
    const run = stored([memo(), memo({ memoId: 'm2', resolved: 'Checked against the scan.' })])
    expect(run.edits).toEqual([
      memo(),
      memo({ memoId: 'm2', resolved: 'Checked against the scan.' })
    ])
  })

  it('drops a malformed memo rather than throwing away the run', () => {
    const run = stored([{ kind: 'memo', blockId: 'p0b1', at: 3, text: 'no id' }, memo()])
    expect(run.edits).toEqual([memo()])
  })
})
