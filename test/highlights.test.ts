import { describe, it, expect } from 'vitest'
import {
  applyEdits,
  blockOf,
  clearHighlight,
  correctsTheBook,
  countEdited,
  highlightCounts,
  highlightSheet,
  readingMarkdown,
  withEdit,
  type BookEdit
} from '@core/edits'
import { findAnchor, findQuote } from '@core/annotate'
import { assembleBook, type BookDocument } from '@core/assemble'
import { createSavedRun, migrateSavedRun } from '@core/project'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

const PROSE =
  'The student is asked to sit before a candle flame. The flame is not the point; ' +
  'the point is the student, and the flame is only a thing to rest the eyes upon.'

const book = (): BookDocument =>
  assembleBook([
    page(0, [
      { kind: 'heading', text: 'Of the Astral Senses', level: 1 },
      { kind: 'paragraph', text: PROSE, emphasis: [7] }
    ]),
    page(1, [{ kind: 'paragraph', text: 'A second leaf, with nothing marked on it.' }])
  ])

type Highlight = BookEdit & { kind: 'highlight' }

const mark = (over: Partial<Highlight> = {}): Highlight => ({
  kind: 'highlight',
  highlightId: 'h1',
  blockId: 'p0b1',
  quote: 'a candle flame',
  from: PROSE.indexOf('a candle flame'),
  to: PROSE.indexOf('a candle flame') + 'a candle flame'.length,
  tag: 'note',
  text: 'The exercise is never explained. Does he mean a wick, or the whole lamp?',
  madeAt: '2026-09-07T10:00:00.000Z',
  ...over
})

describe('findQuote: both ends, and which occurrence', () => {
  it('returns the span of the words, not just where they end', () => {
    const span = findQuote(PROSE, 'candle flame')
    expect(span).not.toBeNull()
    expect(PROSE.slice(span!.from, span!.to)).toBe('candle flame')
  })

  it('keeps findAnchor pointing just past the words, as a printer sets a mark', () => {
    // The refactor's guard. findAnchor is now findQuote's `.to`, and a note
    // whose mark moved to the *start* of its phrase would be a silent
    // regression across every book already annotated.
    expect(findAnchor(PROSE, 'candle flame')).toBe(findQuote(PROSE, 'candle flame')!.to)
    expect(PROSE.slice(0, findAnchor(PROSE, 'candle flame')!)).toMatch(/candle flame$/u)
  })

  it('matches across a line break, because the quote was read off a reflowed page', () => {
    const wrapped = 'sit before a candle\n   flame. The flame'
    const span = findQuote(wrapped, 'a candle flame')
    expect(span).not.toBeNull()
    expect(wrapped.slice(span!.from, span!.to)).toBe('a candle\n   flame')
  })

  it('picks the occurrence nearest the offset it was marked at', () => {
    // "the point" appears twice. Without `near` the search takes the first,
    // which is a coin toss that lands on the wrong sentence half the time.
    const first = PROSE.indexOf('the point')
    const second = PROSE.indexOf('the point', first + 1)
    expect(second).toBeGreaterThan(first)
    expect(findQuote(PROSE, 'the point')!.from).toBe(first)
    expect(findQuote(PROSE, 'the point', second)!.from).toBe(second)
    expect(findQuote(PROSE, 'the point', first)!.from).toBe(first)
  })

  it('still finds a lone occurrence far from the hint: the words are the evidence', () => {
    // `near` disambiguates and never narrows. A highlight whose block has been
    // heavily edited has a badly stale offset, and refusing to look outside a
    // window would lose it — which is the one thing here that cannot be
    // re-derived by running something again.
    expect(findQuote(PROSE, 'candle flame', 0)!.from).toBe(PROSE.indexOf('candle flame'))
  })

  it('returns null rather than a guess when the words are not there', () => {
    expect(findQuote(PROSE, 'a brazier of coals')).toBeNull()
    expect(findQuote(PROSE, '   ')).toBeNull()
  })
})

describe('a highlight never reaches the book', () => {
  it('leaves the document identical to one with no edits at all', () => {
    expect(applyEdits(book(), [mark()])).toEqual(applyEdits(book(), []))
  })

  it('is not a note: the same words as a note do reach the page', () => {
    // The teeth. If applyEdits ever grew a case for a highlight, the footnote
    // is what the assertion above would catch — proven here by watching a note
    // with the same text do exactly that.
    const asNote = applyEdits(book(), [
      {
        kind: 'note',
        noteId: 'h1',
        blockId: 'p0b1',
        at: 20,
        text: 'The exercise is never explained.'
      }
    ])
    expect(asNote.footnotes).toHaveLength(1)
    expect(applyEdits(book(), [mark()]).footnotes).toHaveLength(0)
  })

  it("keeps the editor's private words out of every string in the document", () => {
    // A guard rather than a regression test, and worth saying so: removing the
    // `continue` in applyEdits does not fail this today, because the dispatch
    // below it has no case for a highlight either. What it catches is the day
    // somebody adds one.
    const doc = applyEdits(book(), [mark()])
    expect(JSON.stringify(doc)).not.toContain('Does he mean a wick')
  })

  it('does not count as a correction', () => {
    expect(countEdited([mark()])).toBe(0)
    // The teeth: the same block, corrected, does count.
    expect(countEdited([{ kind: 'text', blockId: 'p0b1', text: 'Retyped.' }])).toBe(1)
  })
})

describe('an evening of reading is not one highlight', () => {
  it('keeps every highlight in a paragraph rather than collapsing them by block', () => {
    // Keyed by the highlight, never by the block. Keying by the block is the
    // plausible mistake — every other correction here is keyed that way — and
    // it would make each mark erase the last, so a reading of one dense
    // paragraph would end the evening holding one record.
    const list = withEdit(withEdit([], mark()), mark({ highlightId: 'h2', quote: 'the student' }))
    expect(list).toHaveLength(2)
  })

  it('still collapses a highlight edited twice', () => {
    const first = withEdit([], mark())
    const again = withEdit(first, mark({ text: 'Second thoughts.' }))
    expect(again).toHaveLength(1)
    expect((again[0] as { text?: string }).text).toBe('Second thoughts.')
  })

  it('counts by tag, for a report that makes a counted claim', () => {
    const counts = highlightCounts([
      mark(),
      mark({ highlightId: 'h2', tag: 'intro' }),
      mark({ highlightId: 'h3', tag: 'intro' })
    ])
    expect(counts).toEqual({ note: 1, intro: 2, glossary: 0 })
  })

  it('is cleared one at a time and leaves the rest alone', () => {
    const list = [mark(), mark({ highlightId: 'h2' })]
    expect(
      clearHighlight(list, 'h1').map((e) => (e as { highlightId: string }).highlightId)
    ).toEqual(['h2'])
  })
})

describe('correctsTheBook: the rule the proof sheet reverts by', () => {
  it('separates messages about the book from changes to it', () => {
    expect(correctsTheBook(mark())).toBe(false)
    expect(correctsTheBook({ kind: 'memo', memoId: 'm', blockId: 'p0b1', at: 0, text: 'x' })).toBe(
      false
    )
    expect(correctsTheBook({ kind: 'text', blockId: 'p0b1', text: 'x' })).toBe(true)
  })

  it("survives an undo of the block's corrections, the way the proof sheet does it", () => {
    // The defect this rule was extracted for: the proof sheet's Undo filtered
    // on `blockOf`, and a highlight carries a blockId, so reverting a corrected
    // paragraph deleted every mark the editor had made in it — silently, and
    // with no way to get the reading back.
    const edits: BookEdit[] = [mark(), { kind: 'text', blockId: 'p0b1', text: 'Retyped.' }]
    const kept = edits.filter((e) => !correctsTheBook(e) || blockOf(e) !== 'p0b1')
    expect(kept).toEqual([mark()])
  })
})

describe('the harvest locates every highlight against the book as it stands', () => {
  it('reports one still where it was left as found, with its passage around it', () => {
    const doc = applyEdits(book(), [mark()])
    const [row] = highlightSheet(doc, [mark()])
    expect(row!.anchor).toBe('found')
    expect(row!.at).toEqual({ from: mark().from, to: mark().to })
    expect(row!.passage).toContain('«a candle flame»')
    expect(row!.passage).toContain('The student is asked')
    expect(row!.sourcePages).toEqual([0])
  })

  it('follows the words when a later correction moved them, and says the offset was stale', () => {
    // The ordinary case after a proofing pass, and not a fault. The stored
    // offset is a hint; the quote is the anchor.
    const edits: BookEdit[] = [mark(), { kind: 'text', blockId: 'p0b1', text: `Preface. ${PROSE}` }]
    const [row] = highlightSheet(applyEdits(book(), edits), edits)
    expect(row!.anchor).toBe('moved')
    expect(row!.at!.from).toBe(mark().from + 'Preface. '.length)
    expect(row!.passage).toContain('«a candle flame»')
  })

  it('keeps a highlight whose words are gone, rather than dropping it', () => {
    // The strongest rule here. A reading cannot be re-derived by running
    // anything again, so a lost anchor is reported with the editor's own words
    // intact — never removed because the passage under it was retyped.
    const edits: BookEdit[] = [
      mark(),
      { kind: 'text', blockId: 'p0b1', text: 'Something else entirely.' }
    ]
    const [row] = highlightSheet(applyEdits(book(), edits), edits)
    expect(row!.anchor).toBe('lost')
    expect(row!.at).toBeNull()
    expect(row!.quote).toBe('a candle flame')
    expect(row!.text).toContain('Does he mean a wick')
    expect(row!.passage).toBe('«a candle flame»')
  })

  it('reads in the order the marks sit on the page, not the order they were made', () => {
    // Two in one paragraph, made back to front. The sheet is a reading of the
    // book, so it follows the book.
    const later = mark({
      highlightId: 'h2',
      quote: 'rest the eyes upon',
      from: PROSE.indexOf('rest the eyes upon'),
      to: PROSE.length - 1
    })
    const earlier = mark({ highlightId: 'h1', quote: 'The student', from: 0, to: 11 })
    const doc = applyEdits(book(), [later, earlier])
    expect(highlightSheet(doc, [later, earlier]).map((r) => r.highlightId)).toEqual(['h1', 'h2'])
  })

  it('is empty for a book nobody has read yet', () => {
    expect(highlightSheet(applyEdits(book(), []), [])).toEqual([])
  })
})

describe('a reading survives being saved and reopened', () => {
  const run = (edits: BookEdit[]) =>
    migrateSavedRun(
      JSON.parse(
        JSON.stringify(
          createSavedRun({
            key: 'k',
            fileName: 'a book.pdf',
            pageCount: 2,
            leafCount: 2,
            transcriptions: [page(0, [{ kind: 'paragraph', text: PROSE }])],
            failures: [],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
            modelId: 'none',
            identityAnswers: {},
            edits
          })
        )
      )
    )

  it('round-trips a highlight through the store unchanged', () => {
    expect(run([mark()]).edits).toEqual([mark()])
  })

  it('keeps a bare highlight bare rather than giving it an empty note', () => {
    const bare = mark({ text: undefined })
    const back = run([bare]).edits[0] as Record<string, unknown>
    expect('text' in back).toBe(false)
  })

  it('refuses a tag it does not recognise instead of dropping the reading', () => {
    // The one record in this parser worth throwing over. Everything else it
    // skips can be re-typed in seconds; an evening's reading cannot, and a
    // book that comes back looking whole with the marks quietly missing is the
    // silence the whole store is built to avoid.
    const raw = JSON.parse(
      JSON.stringify(
        createSavedRun({
          key: 'k',
          fileName: 'a book.pdf',
          pageCount: 1,
          leafCount: 1,
          transcriptions: [page(0, [{ kind: 'paragraph', text: PROSE }])],
          failures: [],
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
          modelId: 'none',
          identityAnswers: {},
          edits: [mark()]
        })
      )
    )
    raw.edits[0].tag = 'ponder'
    expect(() => migrateSavedRun(raw)).toThrow(/does not recognise/u)
  })

  it('carries the range a memo left on a selection, and leaves a caret memo a point', () => {
    const onSelection: BookEdit = {
      kind: 'memo',
      memoId: 'm1',
      blockId: 'p0b0',
      at: 13,
      to: 27,
      quote: 'a candle flame',
      text: 'Check this against the scan.'
    }
    const atCaret: BookEdit = { kind: 'memo', memoId: 'm2', blockId: 'p0b0', at: 4, text: 'Here.' }
    const back = run([onSelection, atCaret]).edits
    expect(back[0]).toEqual(onSelection)
    // Absent rather than defaulted: a `to` equal to `at` would claim an empty
    // selection was made where the editor only put a caret.
    expect(back[1]).toEqual(atCaret)
    expect('to' in (back[1] as object)).toBe(false)
  })
})

describe('the reading as a page somebody can read', () => {
  const BOOK = { title: 'Of the Astral Senses', fileName: 'astral.pdf' }

  it("groups by tag, because each tag is one pass's brief", () => {
    const edits = [
      mark(),
      mark({ highlightId: 'h2', tag: 'glossary', quote: 'the student', from: 4, to: 15 })
    ]
    const md = readingMarkdown(BOOK, highlightSheet(applyEdits(book(), edits), edits))
    expect(md).toContain('## Wants a footnote (1)')
    expect(md).toContain('## Terms to define (1)')
    expect(md).not.toContain('For the introduction')
  })

  it('makes a counted claim the shelf check can read back', () => {
    // `book-files.mjs --check` matches /(\d+)\s+passages marked/ against this
    // line. The two are a pair, and a wording change here silently switches
    // that check off — which is how a file comes to describe a book it no
    // longer matches.
    const edits = [mark(), mark({ highlightId: 'h2' })]
    const md = readingMarkdown(BOOK, highlightSheet(applyEdits(book(), edits), edits))
    expect(md).toMatch(/2\s+passages marked/u)
  })

  it('says on the page when the words are no longer in the book', () => {
    const edits: BookEdit[] = [mark(), { kind: 'text', blockId: 'p0b1', text: 'Gone.' }]
    const md = readingMarkdown(BOOK, highlightSheet(applyEdits(book(), edits), edits))
    expect(md).toContain('no longer in the book')
    // And the editor's own words survive on the page, which is the point.
    expect(md).toContain('a candle flame')
    expect(md).toContain('Does he mean a wick')
  })

  it('says so plainly for a book nobody has read', () => {
    const md = readingMarkdown(BOOK, [])
    expect(md).toContain('Nobody has read this book yet')
    expect(md).not.toMatch(/passages marked/u)
  })
})
