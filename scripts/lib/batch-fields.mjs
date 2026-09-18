/**
 * What a corrected batch may carry, for the scripts that have no build step.
 *
 * `parsePageTranscription` owns this list — `PAGE_FIELDS` and `BLOCK_FIELDS`
 * in `@core/transcribe/schema` — and refuses anything not on it, because a
 * field silently dropped is how an editorial query disappears with a green
 * report beside it. `batch.mjs --check` asks the same question *before* a
 * batch is landed, and it is plain Node with no way to import TypeScript, so
 * the list has to be written twice.
 *
 * Twice means it can drift, and it did: `--check` kept a list of four block
 * fields while the schema had ten, so every batch carrying the emphasis the
 * file states came back as ten refusals per leaf against a parser that would
 * have taken it happily. `test/batch-fields.test.ts` compares the two and
 * fails if they ever part again — which is the only thing that makes a second
 * copy safe.
 */

export const PAGE_FIELDS = [
  'pageIndex',
  'role',
  'blocks',
  'uncertain',
  'furniture',
  'queries',
  'metadata',
  'words',
  'structural'
]

export const BLOCK_FIELDS = [
  'kind',
  'text',
  'cells',
  'headerRow',
  'emphasis',
  'strong',
  'level',
  'marker',
  'continuesPrevious',
  'continuesNext'
]

/**
 * The block kinds, for the same reason. `--check` kept its own list of seven
 * while the schema had nine, so a reader who set the Summary's six bullets of
 * *Patterns* Vol. II as `list-item` — the kind the engine hangs a marker on —
 * had the batch refused six times over for a kind the parser takes.
 */
export const BLOCK_KINDS = [
  'paragraph',
  'heading',
  'blockquote',
  'verse',
  'epigraph',
  'caption',
  'footnote',
  'list-item',
  'table'
]
