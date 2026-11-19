import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as coherence from '@core/coherence'
import { combineResults, type CheckResult } from '@core/coherence'
// @ts-expect-error — plain Node modules with no types: `readiness.mjs` loads
// them before anything can load TypeScript.
import { c3, c5 } from '../scripts/lib/readiness-checked.mjs'
// @ts-expect-error — as above.
import { exportReport, r11, r2r3 } from '../scripts/lib/readiness-ready.mjs'
// @ts-expect-error — as above.
import { STALE_COPY, driverFor, runner } from '../scripts/lib/readiness-run.mjs'
// @ts-expect-error — as above.
import { sha256Of } from '../scripts/lib/readiness-files.mjs'

/**
 * The checks `readiness.mjs` runs, each fed the answer a command could give,
 * so a check that stopped, or ran on the wrong thing, is caught saying PASSED.
 * Synthetic files and fingerprints only: no book is read here.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'readiness-scripts-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

interface Res {
  code: number | null
  out: string
  err: string
  line: string
  json?: unknown
}
type Stub = (...args: unknown[]) => Res

const said = (code: number | null, out: string): Res => ({ code, out, err: '', line: 'stub' })
const answered = (code: number, json: unknown): Res => ({
  ...said(code, JSON.stringify(json)),
  json
})
const never: Stub = () => {
  throw new Error('not expected to run')
}

function ctxWith(run: { viteNode?: Stub; drive?: Stub }, over: Record<string, unknown> = {}) {
  return {
    driver: { ok: true, why: 'up, with this book open' },
    sheets: dir,
    scratch: dir,
    bookJson: join(dir, 'book.json'),
    bookSha: A,
    core: coherence,
    run: { short: (s: unknown) => String(s), node: never, viteNode: never, drive: never, ...run },
    ...over
  }
}

const whole = (id: string, parts: CheckResult | CheckResult[]): CheckResult =>
  combineResults(id, [parts].flat())

describe('C5, footnotes under their marks', () => {
  const c5With = (pairs: Res, notes: Res): CheckResult =>
    c5(ctxWith({ drive: (verb: unknown) => (verb === 'pairs' ? pairs : notes) }))

  /**
   * A driver error comes back as `{"error": …}` with exit 1. Read as counts,
   * every count was missing, so it said "the book has no footnotes": PASSED.
   */
  it('is NOT CHECKED when the driver answers with an error', () => {
    const err = answered(1, { error: 'No book is open' })
    const r = c5With(err, err)
    expect(r.outcome).toBe('NOT CHECKED')
    expect(r.summary).toMatch(/No book is open/)
  })

  it('is NOT CHECKED when a count is missing, or the verb exited non-zero', () => {
    const clean = answered(0, { notes: 0, orphaned: 0 })
    expect(c5With(answered(0, {}), clean).outcome).toBe('NOT CHECKED')
    expect(c5With(answered(0, { references: 0, notes: 0 }), clean).outcome).toBe('NOT CHECKED')
    const zeros = { references: 0, notes: 0, orphaned: 0 }
    expect(c5With(answered(1, zeros), clean).outcome).toBe('NOT CHECKED')
    expect(c5With(answered(0, zeros), answered(2, { notes: 0, orphaned: 0 })).outcome).toBe(
      'NOT CHECKED'
    )
  })

  it('passes a book the driver counted no notes in, and fails orphans', () => {
    const zeros = answered(0, { references: 0, notes: 0, orphaned: 0 })
    expect(c5With(zeros, answered(0, { notes: 0, orphaned: 0 })).outcome).toBe('PASSED')
    const some = answered(0, { references: 3, notes: 3, orphaned: 1 })
    expect(c5With(some, answered(0, { notes: 3, orphaned: 0 })).outcome).toBe('FAILED')
    // Notes that pairs did not see are still notes: not "no footnotes".
    expect(c5With(zeros, answered(0, { notes: 2, orphaned: 0 })).outcome).toBe('NEEDS A PERSON')
  })
})

describe('C3, paragraphs broken at a page turn', () => {
  const c3With = (res: Res): CheckResult => whole('C3', c3(ctxWith({ viteNode: () => res })))

  /** The command exits 0 on the text half alone; the paper half did not run. */
  it('is NOT CHECKED when the paper half did not run', () => {
    const r = c3With(said(0, 'book.json\n  0 split; 0 owed; text only: no recon reading at x'))
    expect(r.outcome).toBe('NOT CHECKED')
    expect(r.summary).toMatch(/paper half did not run \(no recon reading at x\)/)
  })

  const noScanWith = (out: string): CheckResult =>
    whole('C3', c3(ctxWith({ viteNode: () => said(0, out) }, { shape: { pixels: false } })))

  it('passes on the text half alone for a book with no scan, where the paper half does not apply', () => {
    const r = noScanWith('book.json\n  0 split; 0 owed; text only: no recon reading at x')
    expect(r.outcome).toBe('PASSED')
    expect(r.summary).toMatch(/paper half does not apply/)
  })

  /**
   * The shape said no pixels, so every refusal was waved through as "no scan".
   * A reading refused is a reading that exists: the book has a scan after all.
   */
  it('is NOT CHECKED for a book with no scan in its shape whose reading was refused', () => {
    for (const why of [
      'the recon reading at x is of another copy: it reads other.pdf, not this book’s scan',
      'the recon reading at x could not be read: Unexpected end of JSON input',
      'the recon reading at x holds no words'
    ]) {
      const r = noScanWith(`book.json\n  0 split; 0 owed; text only: ${why}`)
      expect(r.outcome, why).toBe('NOT CHECKED')
      expect(r.summary, why).toMatch(/paper half did not run/)
      expect(r.summary, why).toMatch(/a recon reading is there, so it has one/)
    }
  })

  it('passes only when the paper was read too', () => {
    expect(c3With(said(0, 'book.json\n  0 split; 0 owed; paper read from 12 leaves')).outcome).toBe(
      'PASSED'
    )
  })

  it('is NOT CHECKED when the command stopped before its report, and FAILED on findings', () => {
    expect(c3With(said(0, '')).outcome).toBe('NOT CHECKED')
    expect(c3With(said(1, 'book.json\n  3 split; 2 owed; text only: none')).outcome).toBe('FAILED')
  })

  /**
   * The real command, on a synthetic book whose only reading is of another
   * copy of the scan (another file, more leaves): its leaves do not line up
   * with the book's, so the paper half must not run against it.
   */
  const bookWith = (name: string, reading: Record<string, unknown> | null): string => {
    const at = join(dir, name)
    mkdirSync(at)
    writeFileSync(
      join(at, 'book.json'),
      JSON.stringify({
        run: {
          key: 'synthetic.pdf\u000010\u00001',
          fileName: 'synthetic.pdf',
          pageCount: 2,
          transcriptions: [],
          edits: []
        }
      })
    )
    const words = [
      { text: 'w', confidence: 90, bbox: { x0: 0, y0: 0, x1: 9, y1: 9 }, pageIndex: 0 }
    ]
    if (reading) {
      writeFileSync(join(at, 'recon.json.gz'), gzipSync(JSON.stringify({ ...reading, words })))
    }
    return join(at, 'book.json')
  }
  const real = (bookJson: string, shape?: Record<string, unknown>): CheckResult =>
    whole(
      'C3',
      c3(ctxWith({}, { bookJson, shape, run: runner({ tools: REPO, shelf: dir, scratch: dir }) }))
    )

  /** The same, matched on what the real command prints, not on a guess at it. */
  it('lets a book with no scan off the paper half only when the command finds no reading', () => {
    const none = real(bookWith('no-scan', null), { pixels: false })
    expect(none.outcome, none.details?.join('\n')).toBe('PASSED')
    const refused = real(
      bookWith('no-scan-refused', {
        key: 'synthetic-1906.pdf\u000020\u00001',
        fileName: 'synthetic-1906.pdf',
        pageCount: 6
      }),
      { pixels: false }
    )
    expect(refused.outcome, refused.details?.join('\n')).toBe('NOT CHECKED')
    expect(refused.summary).toMatch(/another copy: it reads synthetic-1906\.pdf/)
  }, 120_000)

  it('does not read the paper off a reading of another copy', () => {
    const bookJson = bookWith('other-copy', {
      key: 'synthetic-1906.pdf\u000020\u00001',
      fileName: 'synthetic-1906.pdf',
      pageCount: 6
    })
    const r = real(bookJson)
    expect(r.outcome, r.details?.join('\n')).toBe('NOT CHECKED')
    expect(r.summary).toMatch(/another copy: it reads synthetic-1906\.pdf/)
  }, 60_000)

  it('reads the paper off the book’s own reading', () => {
    const bookJson = bookWith('own-copy', {
      key: 'synthetic.pdf\u000010\u000077',
      fileName: 'synthetic.pdf',
      pageCount: 2
    })
    const r = real(bookJson)
    expect(r.outcome, r.details?.join('\n')).toBe('PASSED')
    expect(r.summary).toMatch(/paper read from 1 leaves/)
  }, 60_000)
})

describe('the driver checks run on the driver’s copy of this very file', () => {
  /**
   * `driverFor` asked only which path the book was loaded from, so a copy
   * loaded before `book.json` changed ran C1, C5 and C7 and could pass them
   * while the report fingerprinted the file as it is now. Something has to
   * answer on the driver's port for `driverFor` to ask at all: a socket that
   * hangs up stands in for it, and the stub answers `drive.mjs book`.
   */
  const at = join(dir, 'driven')
  const bookJson = join(at, 'book.json')
  let server: Server
  const was = process.env['DRIVE_PORT']
  let then = ''
  let now = ''
  beforeAll(async () => {
    mkdirSync(at)
    const run = { key: 'synthetic.pdf\u000010\u00001', fileName: 'synthetic.pdf', pageCount: 2 }
    writeFileSync(bookJson, JSON.stringify({ run: { ...run, edits: [] } }))
    then = sha256Of(bookJson)
    writeFileSync(bookJson, JSON.stringify({ run: { ...run, edits: [{ id: 'e1' }] } }))
    now = sha256Of(bookJson)
    server = createServer((socket) => socket.end())
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    process.env['DRIVE_PORT'] = String((server.address() as AddressInfo).port)
  })
  afterAll(async () => {
    if (was === undefined) delete process.env['DRIVE_PORT']
    else process.env['DRIVE_PORT'] = was
    await new Promise((done) => server.close(done))
  })

  const holding = (answer: Record<string, unknown>) =>
    driverFor(
      {
        drive: (verb: unknown) => {
          expect(verb).toBe('book')
          return answered(0, { current: 'synthetic.pdf', bookFile: bookJson, ...answer })
        }
      },
      at,
      'synthetic.pdf',
      now
    ) as Promise<{ ok: boolean; why: string }>

  it('runs them when the copy was loaded from these very bytes', async () => {
    const d = await holding({ bookSha: now })
    expect(d.ok, d.why).toBe(true)
  })

  it('does not run them on a copy loaded before the file changed, or with no fingerprint', async () => {
    for (const answer of [{ bookSha: then }, { bookSha: null }]) {
      const d = await holding(answer)
      expect(d.ok, JSON.stringify(answer)).toBe(false)
      expect(d.why).toContain(STALE_COPY)
    }
    const old = await holding({})
    expect(old.ok).toBe(false)
    expect(old.why).toContain(STALE_COPY)
    expect(old.why).toMatch(/restart it/)
  })

  it('reports every driver check NOT CHECKED with that reason', async () => {
    const zeros = answered(0, { references: 0, notes: 0, orphaned: 0 })
    const fresh = await holding({ bookSha: now })
    expect(c5(ctxWith({ drive: () => zeros }, { driver: fresh })).outcome).toBe('PASSED')
    const stale = await holding({ bookSha: then })
    const r: CheckResult = c5(ctxWith({ drive: never }, { driver: stale }))
    expect(r.outcome).toBe('NOT CHECKED')
    expect(r.summary).toContain(
      "the driver's copy is not this book file: load it again (`drive.mjs load <book.json> <scan>`)"
    )
  })

  /** The driver runs in a browser no test starts; this pins what it records. */
  it('drive.mjs load records the fingerprint of the bytes it read, and book answers it', () => {
    const driver = readFileSync(join(REPO, 'scripts', 'drive.mjs'), 'utf8')
    const load = driver.slice(driver.indexOf('\n    load: async ('))
    const loadBody = load.slice(0, load.indexOf('\n    },\n'))
    expect(loadBody).toMatch(/const bytes = await readFile\(bookFile\)/)
    expect(loadBody).toMatch(/const json = stripBom\(bytes\.toString\('utf8'\)\)/)
    expect(loadBody).toMatch(/rememberBookFile\(loaded\.key, bookFile, false, sha256\(bytes\)\)/)
    expect(driver).toMatch(/bookSha: wanted \? localStorage\.getItem\(bookShaPrefix \+ wanted\)/)
  })
})

describe('R2 and R3, the export report', () => {
  const interior = { sha256: B, pages: 4, path: join(dir, 'interior.pdf') }
  const clean = {
    pages: 4,
    warnings: 0,
    notesDropped: [],
    imagesDropped: [],
    designFrom: 'the book file',
    unprintable: []
  }
  const judge = async (report: Record<string, unknown>, text?: string) => {
    const path = join(dir, `proof-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(path, text ?? JSON.stringify(report))
    const ctx = ctxWith({}, { exportReport: path })
    const parts: CheckResult[] = r2r3(ctx, interior, await exportReport(ctx, interior))
    return { r2: parts[0]!, r3: parts[1]! }
  }

  /**
   * Every export of the same length has the same page count, so a report
   * kept from an earlier export passed for this one.
   */
  it('refuses a saved report of another PDF of the same length', async () => {
    const { r2, r3 } = await judge({ ...clean, pdfSha256: C })
    expect(r2.outcome).toBe('NOT CHECKED')
    expect(r3.outcome).toBe('NOT CHECKED')
    expect(r2.summary).toMatch(/another PDF/)
  })

  it('takes a saved report that names this interior, byte-order mark and all', async () => {
    const { r2, r3 } = await judge({}, `\uFEFF${JSON.stringify({ ...clean, pdfSha256: B })}`)
    expect(r2.outcome).toBe('PASSED')
    expect(r3.outcome).toBe('PASSED')
  })

  it('sends a report that names no PDF to a person, and keeps its failures', async () => {
    const { r2, r3 } = await judge(clean)
    expect(r2.outcome).toBe('NEEDS A PERSON')
    expect(r2.subjects).toEqual([B])
    expect(r3.outcome).toBe('NEEDS A PERSON')
    expect((await judge({ ...clean, warnings: 2 })).r2.outcome).toBe('FAILED')
    expect((await judge({ ...clean, pages: 6 })).r2.outcome).toBe('NOT CHECKED')
  })
})

describe('R11, every EPUB picture described', () => {
  /** A zip with nothing in it: the end-of-directory record alone. */
  it('does not pass an EPUB with no pages in it', () => {
    const empty = Buffer.alloc(22)
    empty.writeUInt32LE(0x06054b50, 0)
    const path = join(dir, 'empty.epub')
    writeFileSync(path, empty)
    const r: CheckResult = r11(ctxWith({}), { path })
    expect(r.outcome).toBe('FAILED')
    expect(r.summary).toMatch(/no pages/)
  })
})
