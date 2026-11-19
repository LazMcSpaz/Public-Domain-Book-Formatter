import { describe, it, expect } from 'vitest'
import { createSavedRun, parseBookFile, serializeBookFile, type SavedRun } from '@core/project'
import { foldIntoBookText, holds, withQueued, type OutboxEntry } from '@core/sync'
import { defaultVoice } from '@core/annotate'
import type { BookEdit } from '@core/edits'
import type { Ruling } from '@core/queries'

/**
 * A flush folds the queue into the book file the shelf holds and writes it back.
 *
 * It used to write back the app's own reading of that file, and the app reads
 * only the fields it knows. Measured on the shelf: a ruling sent to one book
 * would have taken the reasons (`why`) and the findings off 404 corrections the
 * tools had written. These tests build a book file the way the tools leave
 * one, with fields the app does not read, and hold the fold to keeping them.
 * Made-up text throughout.
 */

const run = (edits?: BookEdit[]): SavedRun =>
  createSavedRun({
    key: 'probe.pdf1',
    fileName: 'probe.pdf',
    pageCount: 2,
    transcriptions: [
      {
        pageIndex: 0,
        role: 'body',
        blocks: [
          { kind: 'paragraph', text: 'The lamp was lit at dusk.' },
          { kind: 'paragraph', text: 'A second paragraph of made-up words.' }
        ],
        uncertain: [],
        furniture: {}
      }
    ],
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    modelId: 'none',
    identityAnswers: {},
    edits: edits ?? [
      { kind: 'text', blockId: 'p0b0', text: 'The lamp was lit at dusk!' },
      { kind: 'drop', blockId: 'p0b1' } as BookEdit
    ]
  })

const highlight = (id: string, quote = 'lamp'): BookEdit => ({
  kind: 'highlight',
  highlightId: id,
  blockId: 'p0b0',
  quote,
  from: 4,
  to: 8,
  tag: 'note',
  madeAt: '2026-11-18T10:00:00.000Z'
})

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  pageIndex: 0,
  quote: 'lit at dusk',
  kind: 'printers-error',
  decision: 'as-printed',
  decidedOn: '2026-11-18',
  ...over
})

const queuedRuling = (r: Ruling): OutboxEntry =>
  ({
    id: `ruling:${r.pageIndex}:${r.quote}`,
    bookKey: 'probe.pdf1',
    madeAt: '2026-11-18T10:00:00.000Z',
    ruling: r
  }) as OutboxEntry

const queuedEdit = (edit: BookEdit, over: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({
    id: `${edit.kind}:x`,
    bookKey: 'probe.pdf1',
    madeAt: '2026-11-18T10:00:00.000Z',
    edit,
    saw: null,
    ...over
  }) as OutboxEntry

/**
 * A book file as the tools leave one: the app's own file, with a reason and a
 * finding on each correction, a run field and a top-level field the app does
 * not know, no voice, and an edit of a kind the app cannot read.
 */
function toolsFile(edits?: BookEdit[]): string {
  const text = serializeBookFile({
    run: run(edits),
    answers: { export: { title: 'Probe' } },
    voice: defaultVoice()
  })
  const raw = JSON.parse(text)
  raw.voice = null
  raw.toolsNote = { by: 'a session', at: '2026-11-01' }
  raw.run.scanPageCount = 0
  raw.run.edits = raw.run.edits.map((e: Record<string, unknown>, i: number) => ({
    ...e,
    why: `reason ${i}`,
    finding: `finding ${i}`
  }))
  raw.run.edits.splice(1, 0, { kind: 'future-kind', blockId: 'p0b0', weight: 3 })
  return JSON.stringify(raw, null, 2) + '\n'
}

describe('a ruling folded into the shelf’s book file', () => {
  it('keeps every field the app does not read, and adds the ruling', () => {
    const text = toolsFile()
    const folded = foldIntoBookText(text, [queuedRuling(ruling())], '2026-11-19T00:00:00.000Z')
    expect(folded.json).not.toBeNull()
    expect(folded.keptEverything).toBe(true)
    const out = JSON.parse(folded.json!)

    expect(out.run.edits).toEqual(JSON.parse(text).run.edits)
    expect(out.run.edits[0]).toMatchObject({ why: 'reason 0', finding: 'finding 0' })
    expect(out.run.scanPageCount).toBe(0)
    expect(out.toolsNote).toEqual({ by: 'a session', at: '2026-11-01' })
    expect(out.voice).toBeNull()
    expect(out.savedAt).toBe('2026-11-19T00:00:00.000Z')
    // The ruling is there as the app reads it.
    expect(parseBookFile(folded.json!).run.rulings).toEqual([ruling()])
    // Laid out as the file was, so a diff on the shelf shows the change only.
    expect(folded.json!.endsWith('\n')).toBe(true)
  })

  it('changes only the lines the change is on', () => {
    const text = toolsFile()
    const folded = foldIntoBookText(text, [queuedRuling(ruling())], JSON.parse(text).savedAt)
    const before = text.split('\n')
    const after = folded.json!.split('\n')
    const gone = before.filter((line) => !after.includes(line))
    // Only the run's schema line can differ (the file was the app's current
    // shape already, so not even that), and the empty rulings list opens up.
    expect(gone.every((line) => /"rulings": \[\]|"schemaVersion"|"runSchema"/.test(line))).toBe(
      true
    )
  })

  it('puts a queued mark after the shelf’s edits and keeps the one it cannot read in place', () => {
    const folded = foldIntoBookText(toolsFile(), [queuedEdit(highlight('h1'))], 'now')
    const edits = JSON.parse(folded.json!).run.edits
    expect(edits.map((e: { kind: string }) => e.kind)).toEqual([
      'text',
      'future-kind',
      'drop',
      'highlight'
    ])
    expect(edits[3]).toEqual(highlight('h1'))
  })

  it('takes a mark off when the editor took it off, and keeps the rest as stored', () => {
    const text = toolsFile([
      { kind: 'text', blockId: 'p0b0', text: 'The lamp was lit at dusk!' },
      highlight('h1')
    ])
    const removal = queuedEdit(highlight('h1'), { remove: true, saw: highlight('h1') })
    const edits = JSON.parse(foldIntoBookText(text, [removal], 'now').json!).run.edits
    expect(edits.map((e: { kind: string }) => e.kind)).toEqual(['text', 'future-kind'])
    expect(edits[0].why).toBe('reason 0')
  })

  it('writes the queue’s correction where it replaces the shelf’s, reason and all gone with it', () => {
    const text = toolsFile()
    const shelfCopy = parseBookFile(text).run.edits[0]!
    const fix: BookEdit = { kind: 'text', blockId: 'p0b0', text: 'The lamp was lit at dawn.' }
    const edits = JSON.parse(
      foldIntoBookText(text, [queuedEdit(fix, { saw: shelfCopy })], 'now').json!
    ).run.edits
    expect(edits.at(-1)).toEqual(fix)
    expect(edits.filter((e: { kind: string }) => e.kind === 'text')).toHaveLength(1)
  })

  it('writes nothing when every change is already on the shelf', () => {
    const text = toolsFile()
    const once = foldIntoBookText(text, [queuedRuling(ruling())], 'now')
    const again = foldIntoBookText(once.json!, [queuedRuling(ruling())], 'later')
    expect(again.json).toBeNull()
    expect(again.merged.applied).toHaveLength(1)
  })
})

describe('the shelf’s copy of an item', () => {
  it('holds everything the app read off it, at every depth, and may hold more', () => {
    expect(holds({ a: 1, b: { c: [1, 2], d: 'x' } }, { a: 1, b: { c: [1, 2] } })).toBe(true)
    expect(holds({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(holds({ a: [1, 2, 3] }, { a: [1, 2] })).toBe(false)
    expect(holds({ a: 1 }, { a: 1, skipped: undefined })).toBe(true)
  })
})

describe('a book opened with this device’s waiting changes', () => {
  it('shows a waiting mark and a waiting ruling, as a flush would fold them', () => {
    const file = parseBookFile(toolsFile())
    const opened = withQueued(file, [queuedEdit(highlight('h1')), queuedRuling(ruling())])
    expect(opened.waiting).toBe(2)
    expect(opened.file.run.edits.at(-1)).toEqual(highlight('h1'))
    expect(opened.file.run.rulings).toEqual([ruling()])
  })

  it('leaves out a correction the shelf has moved under, for the flush to report', () => {
    const file = parseBookFile(toolsFile())
    const stale: BookEdit = { kind: 'text', blockId: 'p0b0', text: 'An older base.' }
    const opened = withQueued(file, [
      queuedEdit({ kind: 'text', blockId: 'p0b0', text: 'Mine.' }, { saw: stale })
    ])
    expect(opened.conflicts).toBe(1)
    expect(opened.file.run.edits).toEqual(file.run.edits)
  })

  it('is the book unchanged when nothing is waiting', () => {
    const file = parseBookFile(toolsFile())
    expect(withQueued(file, []).file).toBe(file)
  })
})
