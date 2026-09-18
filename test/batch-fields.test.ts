import { describe, it, expect } from 'vitest'
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
