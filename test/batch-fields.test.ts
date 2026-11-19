import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ALL_PAGE_ROLES } from '@core/pages'
import { PAGE_FIELDS, BLOCK_FIELDS, BLOCK_KINDS } from '@core/transcribe/schema'
// @ts-expect-error — a plain Node module with no types. `batch.mjs` has no
// build step and cannot import TypeScript, so the list is written twice; this
// test is the only thing that makes that safe.
import * as script from '../scripts/lib/batch-fields.mjs'

/**
 * `batch --check` asks the same question `parsePageTranscription` asks, before
 * a batch is landed rather than while it is landing. Two copies of the list is
 * two chances to be wrong, and it went wrong the first time it mattered: the
 * script kept four block fields against the schema's ten, so a batch carrying
 * the emphasis the source states came back as ten refusals a leaf from a
 * parser that would have accepted every one of them.
 */
describe('the fields a batch may carry', () => {
  it('is one list, whichever side asks', () => {
    expect([...script.PAGE_FIELDS].sort()).toEqual([...PAGE_FIELDS].sort())
    expect([...script.BLOCK_FIELDS].sort()).toEqual([...BLOCK_FIELDS].sort())
    // The kinds too: the check kept seven of the schema's nine and refused a
    // batch for `list-item`, a kind the parser takes and the engine sets.
    expect([...script.BLOCK_KINDS].sort()).toEqual([...BLOCK_KINDS].sort())
  })
})

/**
 * The reader brief is the third copy: every reader is told which roles and
 * kinds it may write. It listed four roles of the parser's twenty, so a reader
 * of a book with plates had no `plate` or `title-page` to name.
 */
describe('the reader brief', () => {
  const brief = readFileSync(new URL('../docs/BRIEF-reading.md', import.meta.url), 'utf8')

  it('names every role and block kind the parser accepts', () => {
    for (const role of ALL_PAGE_ROLES) expect(brief, role).toContain(`\`${role}\``)
    for (const kind of BLOCK_KINDS) expect(brief, kind).toContain(`\`${kind}\``)
  })
})
