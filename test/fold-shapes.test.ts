import { describe, it, expect } from 'vitest'
import { createSavedRun, parseBookFile, serializeBookFile } from '@core/project'
import {
  entriesBetween,
  foldIntoBookText,
  layoutOf,
  mergeOutbox,
  writeInLayout,
  type OutboxEntry
} from '@core/sync'
import { defaultVoice } from '@core/annotate'
import { withEdit, type BookEdit } from '@core/edits'
import type { Ruling } from '@core/queries'

/**
 * The fold against the records exactly as the app builds them.
 *
 * The reading view builds a comment as `at, to, quote, text`, and the parser
 * that reads the shelf's file builds it as `at, text, quote, to`. The fold
 * compared the two as text, decided its patch did not mean what the merge
 * meant, and wrote the app's own copy of both lists over the tools' reasons
 * and findings. Read-only on the shelf, a queued comment did that to every
 * book. Each shape here is one the app really makes, built field for field in
 * the order its code writes them. Made-up text throughout.
 */

const KEY = 'probe.pdf1'
const madeAt = '2026-11-19T10:00:00.000Z'

/** A book file as the tools leave one: a reason and a finding on every correction. */
function toolsFile(indent: string | number = 2, edits: BookEdit[] = []): string {
  const raw = JSON.parse(
    serializeBookFile({
      run: createSavedRun({
        key: KEY,
        fileName: 'probe.pdf',
        pageCount: 1,
        transcriptions: [
          {
            pageIndex: 0,
            role: 'body',
            blocks: [{ kind: 'paragraph', text: 'The lamp was lit at dusk.' }],
            uncertain: [],
            furniture: {}
          }
        ],
        failures: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        modelId: 'none',
        identityAnswers: {},
        edits: [{ kind: 'text', blockId: 'p0b0', text: 'The lamp was lit at dusk!' }, ...edits]
      }),
      answers: {},
      voice: defaultVoice()
    })
  )
  raw.run.edits[0].why = 'the page has an exclamation mark'
  raw.run.edits[0].finding = 'a made-up finding'
  // As the tools write most books: no newline at the end.
  return JSON.stringify(raw, null, indent)
}

/** Queued as the app queues an edit: its reading of the list before and after, compared. */
const queued = (text: string, edit: BookEdit): OutboxEntry[] => {
  const before = parseBookFile(text).run.edits
  return entriesBetween(before, withEdit(before, edit), [], KEY, madeAt)
}

/** The fold kept the tools' fields, and wrote the one new item. */
function expectKept(text: string, folded: ReturnType<typeof foldIntoBookText>, added: number) {
  expect(folded.keptEverything).toBe(true)
  expect(folded.json).not.toBeNull()
  const before = JSON.parse(text).run.edits
  const after = JSON.parse(folded.json!).run.edits
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + added)
}

describe('a queued change folded in, built exactly as the app builds it', () => {
  it('keeps every field for a comment from the reading view (`at, to, quote, text`)', () => {
    const text = toolsFile()
    // BookReader's `comment`, field for field.
    const memo = {
      kind: 'memo',
      memoId: 'memo-1',
      blockId: 'p0b0',
      at: 4,
      to: 8,
      quote: 'lamp',
      text: ''
    } as BookEdit
    expectKept(text, foldIntoBookText(text, queued(text, memo), madeAt), 1)
  })

  it('keeps every field for a picture added on the proof sheet (`kind, ...added, afterBlockId`)', () => {
    const text = toolsFile()
    const added = { imageId: 'img-1', sourceWidth: 640, sourceHeight: 480 }
    const image = { kind: 'image', ...added, afterBlockId: 'p0b0' } as BookEdit
    expectKept(text, foldIntoBookText(text, queued(text, image), madeAt), 1)
  })

  it('keeps every field for an item carrying an empty label, which the parser drops', () => {
    const text = toolsFile()
    const insert = {
      kind: 'insert',
      insertId: 'ins-1',
      afterBlockId: 'p0b0',
      blockKind: 'paragraph',
      text: 'An inserted line.',
      label: ''
    } as BookEdit
    expectKept(text, foldIntoBookText(text, queued(text, insert), madeAt), 1)
  })

  it('writes nothing for a comment already on the shelf, sent again with its keys reordered', () => {
    // As the parser writes it into the file...
    const onShelf = {
      kind: 'memo',
      memoId: 'memo-1',
      blockId: 'p0b0',
      at: 4,
      text: 'a note',
      quote: 'lamp',
      to: 8
    } as BookEdit
    const text = toolsFile(2, [onShelf])
    // ...and as the reading view built it, queued again after an answer was lost.
    const resent: OutboxEntry = {
      id: 'memo:memo-1',
      bookKey: KEY,
      madeAt,
      edit: {
        kind: 'memo',
        memoId: 'memo-1',
        blockId: 'p0b0',
        at: 4,
        to: 8,
        quote: 'lamp',
        text: 'a note'
      } as BookEdit,
      saw: null
    }
    const folded = foldIntoBookText(text, [resent], madeAt)
    expect(folded.merged.applied).toHaveLength(1)
    expect(folded.json).toBeNull()
    // And the merge left it where it was, rather than moving it to the end.
    const shelf = { edits: [onShelf, { kind: 'drop', blockId: 'p0b1' } as BookEdit], rulings: [] }
    expect(mergeOutbox(shelf, [resent]).edits).toEqual(shelf.edits)
  })

  it('writes nothing, and says so, when it cannot keep everything', () => {
    // A mark with no words is one the parser drops: the patched file would not
    // read as the merge meant, so nothing is written rather than something lost.
    const text = toolsFile()
    const broken = {
      kind: 'highlight',
      highlightId: 'h1',
      blockId: 'p0b0',
      quote: '',
      from: 0,
      to: 0,
      tag: 'note',
      madeAt
    } as BookEdit
    const folded = foldIntoBookText(text, queued(text, broken), madeAt)
    expect(folded.keptEverything).toBe(false)
    expect(folded.json).toBeNull()
  })
})

describe('the file written back is laid out as it was', () => {
  const ruling: Ruling = {
    pageIndex: 0,
    quote: 'lit at dusk',
    kind: 'printers-error',
    decision: 'as-printed',
    decidedOn: '2026-11-19'
  }
  const queue: OutboxEntry[] = [{ id: 'ruling:0:lit at dusk', bookKey: KEY, madeAt, ruling }]

  it('reads its indent, line ending and last newline off the text, and writes them back', () => {
    for (const indent of [1, 2, 4, '\t']) {
      const text = toolsFile(indent)
      expect(writeInLayout(JSON.parse(text), layoutOf(text))).toBe(text)
      expect(writeInLayout(JSON.parse(text + '\n'), layoutOf(text + '\n'))).toBe(text + '\n')
    }
    const windows = toolsFile(2).replace(/\n/g, '\r\n') + '\r\n'
    expect(layoutOf(windows)).toEqual({ indent: '  ', eol: '\r\n', finalEol: true })
    expect(writeInLayout(JSON.parse(windows), layoutOf(windows))).toBe(windows)
    const oneLine = toolsFile(0)
    expect(writeInLayout(JSON.parse(oneLine), layoutOf(oneLine))).toBe(oneLine)
  })

  it('changes only the lines the change is on, in a one-space file with no last newline', () => {
    const text = toolsFile(1)
    const folded = foldIntoBookText(text, queue, madeAt)
    const out = folded.json!
    expect(out.endsWith('}')).toBe(true)
    // Byte for byte the same once the two changed values are put back.
    const back = JSON.parse(out)
    const was = JSON.parse(text)
    back.run.rulings = was.run.rulings
    back.savedAt = was.savedAt
    expect(JSON.stringify(back, null, 1)).toBe(text)
    // And the lines that went are the empty rulings list and the date only.
    const after = new Set(out.split('\n'))
    const gone = text.split('\n').filter((line) => !after.has(line))
    expect(gone.map((line) => line.trim().split(':')[0])).toEqual(['"savedAt"', '"rulings"'])
  })
})
