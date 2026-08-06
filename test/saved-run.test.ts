import { describe, it, expect } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  createSavedRun,
  describeAge,
  fileKey,
  migrateSavedRun,
  summarize
} from '@core/project'
import type { PageTranscription } from '@core/transcribe'

function transcription(pageIndex: number): PageTranscription {
  return {
    pageIndex,
    role: 'body',
    blocks: [{ kind: 'paragraph', text: `Page ${pageIndex}.` }],
    uncertain: [],
    furniture: {}
  }
}

function run(over: Partial<Parameters<typeof createSavedRun>[0]> = {}) {
  return createSavedRun({
    key: 'book.pdf 1024 99',
    fileName: 'book.pdf',
    pageCount: 2,
    transcriptions: [transcription(0), transcription(1)],
    failures: [],
    usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0 },
    modelId: 'claude-opus-5',
    identityAnswers: { orthography: 'preserve' },
    ...over
  })
}

describe('fileKey — identifying the file a run belongs to', () => {
  it('is stable for the same file', () => {
    const file = { name: 'treatise.pdf', size: 12345, lastModified: 1700000000000 }
    expect(fileKey(file)).toBe(fileKey({ ...file }))
  })

  it('separates files that differ in name, size or timestamp', () => {
    const base = { name: 'a.pdf', size: 10, lastModified: 1 }
    expect(fileKey(base)).not.toBe(fileKey({ ...base, name: 'b.pdf' }))
    expect(fileKey(base)).not.toBe(fileKey({ ...base, size: 11 }))
    expect(fileKey(base)).not.toBe(fileKey({ ...base, lastModified: 2 }))
  })
})

describe('migrateSavedRun', () => {
  it('round-trips a run through JSON, which is how it is stored', () => {
    const original = run()
    const restored = migrateSavedRun(JSON.parse(JSON.stringify(original)))
    expect(restored).toEqual(original)
  })

  it('refuses a record with no pages rather than returning an empty book', () => {
    // The transcription is the one thing the user paid for. Handing back an
    // empty one would look like the book had been read and produce a book with
    // holes in it; refusing sends them to a re-run, which is at least correct.
    expect(() => migrateSavedRun({ ...run(), transcriptions: [] })).toThrow(/no pages/i)
  })

  it('refuses anything that is not a record', () => {
    expect(() => migrateSavedRun(null)).toThrow()
    expect(() => migrateSavedRun('a string')).toThrow()
    expect(() => migrateSavedRun([1, 2, 3])).toThrow()
  })

  it('refuses a version from the future, and says to update', () => {
    expect(() => migrateSavedRun({ ...run(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      /newer than this app/i
    )
  })

  it('refuses the desktop application’s manifest, and explains why', () => {
    // Versions 1–4 were `project.json`: page images and a Markdown
    // intermediate, with no transcription in them to restore.
    expect(() =>
      migrateSavedRun({ schemaVersion: 4, source: { pdfPath: '/tmp/x.pdf' }, pages: [] })
    ).toThrow(/desktop application/i)
  })

  it('backfills the fields that are only descriptive', () => {
    const restored = migrateSavedRun({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      transcriptions: [transcription(0)]
    })
    expect(restored.pageCount).toBe(1)
    expect(restored.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
    expect(restored.failures).toEqual([])
    expect(restored.identityAnswers).toEqual({})
  })
})

describe('summarize', () => {
  it('carries what the resume question needs to ask honestly', () => {
    const s = summarize(run({ failures: [{ pageIndex: 3, message: 'timed out' }] }))
    expect(s).toMatchObject({
      fileName: 'book.pdf',
      pageCount: 2,
      failedPages: 1,
      modelId: 'claude-opus-5'
    })
  })
})

describe('describeAge', () => {
  const at = (iso: string) => new Date(iso)

  it('reads plainly at every scale', () => {
    const now = at('2026-08-06T12:00:00Z')
    expect(describeAge('2026-08-06T11:59:40Z', now)).toBe('just now')
    expect(describeAge('2026-08-06T11:00:00Z', now)).toBe('1 hour ago')
    expect(describeAge('2026-08-05T12:00:00Z', now)).toBe('1 day ago')
    expect(describeAge('2026-06-06T12:00:00Z', now)).toBe('2 months ago')
  })

  it('does not invent an age it cannot work out', () => {
    expect(describeAge('not a date')).toBe('at some point')
  })
})
