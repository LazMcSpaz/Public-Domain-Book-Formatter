import { describe, it, expect } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  createSavedRun,
  describeAge,
  fileKey,
  keyMatchesFile,
  migrateSavedRun,
  parseFileKey,
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

describe('migrateSavedRun — the corrections that came with v6', () => {
  it('keeps an edit list through the round trip it is stored by', () => {
    const original = run({
      edits: [
        { kind: 'text', blockId: 'p0b1', text: 'The chirurgeon.' },
        { kind: 'retype', blockId: 'p0b0', blockKind: 'heading', level: 1 },
        { kind: 'anchor', illustrationId: 'i1', afterBlockId: null }
      ]
    })
    expect(migrateSavedRun(JSON.parse(JSON.stringify(original))).edits).toEqual(original.edits)
  })

  it('upgrades a v5 run rather than refusing it', () => {
    // A run saved before the proof step existed is not damaged by the change —
    // it is a complete transcription that simply has no corrections on it. This
    // is the whole reason there is a migration and not a version check.
    const v5 = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    v5['schemaVersion'] = 5
    delete v5['edits']

    const restored = migrateSavedRun(v5)
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(restored.edits).toEqual([])
    expect(restored.transcriptions).toHaveLength(2)
  })

  it('still refuses the desktop application’s versions, which hold no transcription', () => {
    const v4 = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    v4['schemaVersion'] = 4
    expect(() => migrateSavedRun(v4)).toThrow(/desktop application/)
  })

  it('drops a malformed correction instead of the whole run', () => {
    // Untrusted input: anything in IndexedDB can have been written by an older
    // build or corrupted. Losing one correction costs one correction; refusing
    // the run would cost the thing the user paid for.
    const raw = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    raw['edits'] = [
      { kind: 'text', blockId: 'p0b1', text: 'Good.' },
      { kind: 'text', blockId: 'p0b2' },
      { kind: 'nonsense', blockId: 'p0b3' },
      { kind: 'retype', blockId: 'p0b4', blockKind: 'not-a-kind' },
      { kind: 'split', blockId: 'p0b5', at: 'halfway' },
      null,
      'a string'
    ]
    expect(migrateSavedRun(raw).edits).toEqual([{ kind: 'text', blockId: 'p0b1', text: 'Good.' }])
  })

  it('accepts an anchor to the front of the book, which is a real answer', () => {
    const raw = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    raw['edits'] = [
      { kind: 'anchor', illustrationId: 'i1', afterBlockId: null },
      { kind: 'anchor', illustrationId: 'i2', afterBlockId: 'p0b0' },
      { kind: 'anchor', illustrationId: 'i3', afterBlockId: 42 }
    ]
    expect(migrateSavedRun(raw).edits).toHaveLength(2)
  })

  it('reads back a run that never had corrections as having none', () => {
    expect(migrateSavedRun(JSON.parse(JSON.stringify(run()))).edits).toEqual([])
  })

  it('keeps the pixels of a picture the editor supplied', () => {
    // The one part of an illustration that cannot be re-derived: a crop is cut
    // out of the scan again for free, but a portrait off someone's disk is
    // gone with the tab.
    const original = run({ images: new Map([['img1', new Uint8Array([1, 2, 3, 4])]]) })
    const restored = migrateSavedRun(original)
    expect(restored.images).toEqual([{ id: 'img1', bytes: new Uint8Array([1, 2, 3, 4]) }])
  })

  it('reads bytes back through a structured clone, which is how they are stored', () => {
    const raw = { ...run(), images: [{ id: 'img1', bytes: new Uint8Array([9, 8]) }] }
    expect(migrateSavedRun(structuredClone(raw)).images[0]!.bytes).toEqual(new Uint8Array([9, 8]))
  })

  it('drops a picture entry with no pixels rather than the whole run', () => {
    const raw = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    raw['images'] = [{ id: 'ok', bytes: [1, 2] }, { id: 'nobytes' }, { bytes: [3] }, null]
    expect(migrateSavedRun(raw).images).toEqual([{ id: 'ok', bytes: new Uint8Array([1, 2]) }])
  })

  it('upgrades a v6 run, which simply has no supplied pictures yet', () => {
    const v6 = JSON.parse(JSON.stringify(run())) as Record<string, unknown>
    v6['schemaVersion'] = 6
    delete v6['images']
    const restored = migrateSavedRun(v6)
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(restored.images).toEqual([])
  })

  it('keeps an image edit through the round trip', () => {
    const original = run({
      edits: [
        {
          kind: 'image',
          imageId: 'img1',
          afterBlockId: 'p0b1',
          sourceWidth: 1600,
          sourceHeight: 1200,
          caption: 'The author.'
        }
      ]
    })
    expect(migrateSavedRun(JSON.parse(JSON.stringify(original))).edits).toEqual(original.edits)
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

describe('finding a run when the file has moved but the book has not', () => {
  /**
   * The key is name, size and modification time. Only the third moves for
   * reasons that have nothing to do with the book — re-downloading the PDF,
   * restoring it from a backup, syncing it between devices. Before the loose
   * match, any of those stranded a paid transcription in the database forever
   * and asked the user to buy it again.
   */
  const FILE = { name: 'treatise.pdf', size: 12_345, lastModified: 1_700_000_000_000 }

  it('reads a key back into the file it was built from', () => {
    expect(parseFileKey(fileKey(FILE))).toEqual(FILE)
  })

  it('refuses anything that is not a key', () => {
    expect(parseFileKey('treatise.pdf')).toBeNull()
    expect(parseFileKey('a\u0000notanumber\u00001')).toBeNull()
  })

  it('matches the same book with a new timestamp', () => {
    const redownloaded = { ...FILE, lastModified: FILE.lastModified + 86_400_000 }
    expect(keyMatchesFile(fileKey(FILE), redownloaded)).toBe(true)
  })

  it('will not hand back a different book that happens to share a name', () => {
    // Two scans of the same title share a filename constantly. Returning the
    // wrong book's transcription is worse than asking for payment again, so the
    // size has to agree too.
    const otherScan = { ...FILE, size: FILE.size + 1 }
    expect(keyMatchesFile(fileKey(FILE), otherScan)).toBe(false)
  })

  it('will not match a different name at the same size', () => {
    expect(keyMatchesFile(fileKey(FILE), { ...FILE, name: 'other.pdf' })).toBe(false)
  })
})
