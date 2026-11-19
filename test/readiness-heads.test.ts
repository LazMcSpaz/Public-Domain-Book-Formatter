import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as coherence from '@core/coherence'
import type { CheckResult } from '@core/coherence'
// @ts-expect-error: a plain Node module with no types, which `readiness.mjs`
// loads before anything can load TypeScript.
import { exportReport, r2r3 } from '../scripts/lib/readiness-ready.mjs'

/**
 * R2 and a book's running heads shortened to fit. Synthetic reports and
 * fingerprints only: no book is read here. The rest of R2 and R3 is in
 * readiness-scripts.test.ts.
 */
const dir = mkdtempSync(join(tmpdir(), 'readiness-heads-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const B = 'b'.repeat(64)
const interior = { sha256: B, pages: 4, path: join(dir, 'interior.pdf') }
const clean = {
  pages: 4,
  warnings: 0,
  notesDropped: [],
  imagesDropped: [],
  designFrom: 'the book file',
  unprintable: []
}

/** R2 and R3 from a saved export report, as `readiness.mjs` reads one. */
async function judge(report: Record<string, unknown>) {
  const path = join(dir, `proof-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(path, JSON.stringify(report))
  const ctx = {
    exportReport: path,
    driver: { ok: false, why: 'not needed' },
    run: { short: (s: unknown) => String(s) }
  }
  const parts: CheckResult[] = r2r3(ctx, interior, await exportReport(ctx, interior))
  return { r2: parts[0]!, r3: parts[1]! }
}

describe('R2 and the running heads shortened to fit', () => {
  /**
   * A topic-heads book's long heads were layout warnings, and R2 needs
   * `warnings: 0`, with nowhere to give a short form: the book could never be
   * ready. They are a person's to read now, each with what printed and where,
   * settled by a sign-off on this interior.
   */
  it('puts every running head shortened to fit to a person, who signs it off', async () => {
    const headsShortened = [
      { text: 'Of the Lamp that Burned All Night', setAs: 'Of the Lamp…', pages: [7, 9] },
      { text: 'Stair', setAs: '', pages: [12] }
    ]
    const { r2, r3 } = await judge({ ...clean, pdfSha256: B, headsShortened })
    expect(r2.outcome).toBe('NEEDS A PERSON')
    expect(r2.subjects).toEqual([B])
    expect(r2.summary).toMatch(/2 running heads were too long/u)
    expect(r2.details).toEqual([
      'running head “Of the Lamp that Burned All Night” printed as “Of the Lamp…” on pages 7, 9',
      'running head “Stair” left out, as no word of it fits on page 12'
    ])
    expect(r3.outcome).toBe('PASSED')
    const signed = coherence.applySignOffs(
      [r2],
      coherence.parseSignOffs(
        `Signed off: R2 ${B} 2026-11-19 the owner read the shortened heads and kept them`
      ).signOffs,
      '2026-11-19'
    ).results[0]!
    expect(coherence.isSettled(signed)).toBe(true)
    // An empty list is nothing to read, and a report that fails still fails.
    expect((await judge({ ...clean, pdfSha256: B, headsShortened: [] })).r2.outcome).toBe('PASSED')
    const failing = (await judge({ ...clean, pdfSha256: B, warnings: 1, headsShortened })).r2
    expect(failing.outcome).toBe('FAILED')
    expect(failing.details).toContain(
      'running head “Stair” left out, as no word of it fits on page 12'
    )
  })
})
