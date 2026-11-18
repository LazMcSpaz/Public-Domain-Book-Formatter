# src/core/

All the book logic as pure code: reading shapes, assembly, edits, the checks, the layout engine, queries, the book file and the guided flow's steps. This is where the tests aim.

## May use

- Other modules inside `src/core/` (alias `@core`), and the two pure packages already here: `hyphenation.en-us`, `tex-linebreak`.

## Must not

- Touch the DOM, `window`, `document`, files or the network, or import `node:` modules (tests run it in Node; `harness/check.py` blocks the imports).
- Import from `src/platform/` or `src/app/`.

## Key files

- `edits/book-edits.ts`: `applyEdits`, the edit list applied over the pristine reading.
- `assemble/assemble-book.ts`: leaves joined into one book; `deriveChapters`.
- `assemble/book-text.ts`: `printedTexts`, the one list of everything the book prints.
- `annotate/schema.ts`: `findQuote`, `findAnchor`, `checkProposals`.
- `project/saved-run.ts`, `project/book-file.ts`: the saved run (`CURRENT_SCHEMA_VERSION`, `migrateSavedRun`) and the shelf's `book.json`.
- `wizard/steps.ts`, `wizard/questions.ts`: the guided flow; questions are data.
- `layout/`: the layout engine, with its own CLAUDE.md.

## Folder-specific rules and lessons

- Prefer pure deterministic checks (no browser, no network) that judge work whoever wrote it, like `checkProposals` and `findAnchor`.
- A pass that asks what the book prints reads `printedTexts`; never build its own list of the book's parts.
- Place a note or highlight from its quoted words (`findQuote`, `findAnchor`), never from a typed offset; a quote not found is reported, never guessed.
- Modules plain-Node scripts load through `scripts/resolve-ts.mjs` (`project/ledger.ts`, `queries/standing.ts`, `queries/key.ts`, `provenance/`) must not reach TS-only syntax such as parameter properties.
- After fixing parse or engine code, re-export every shelf book the fault could reach and check the PDF bytes; shelf PDFs go stale silently.
- **annotate/**: never loosen `audit.ts` limits, floors or lexicons to make a draft pass; fix the draft and re-run `voice.mjs audit`.
- **assemble/**:
  - Chapters come only from `deriveChapters` (a run of headings is one chapter); never re-derive them with a copy of the rule.
  - A printed folio maps to a leaf through `folioRuns` (`furniture.folio`), never a fixed leaf offset; keep `seams` sound through edits.
- **draft/**: a draft is never saved or believed; it reaches the store only corrected, via `transcribe`. Every geometric guess goes in `structural`.
- **edits/**:
  - Corrections are an edit list over the pristine transcription; never alter the pristine text itself.
  - Memos and highlights never print (`applyEdits` skips them); tell them apart with `correctsTheBook`, never by `blockOf`.
- **image/**: ops are a non-destructive stack over the original pixels; an op that changes size must show in `sizeAfterOps` (the DPI check divides by it).
- **project/**: bump `RECON_CACHE_VERSION` when a recon record gains a field, so an older reading is refused, not served as empty.
- **provenance/**: a text layer is `converted` (needs reading) unless a typesetting producer is named; never default to `typeset`.
- **queries/**: a proposal is an option, never a `defaultValue` or `held` value; the three plain decisions are always appended.
- **sync/**: the outbox queues edits, never the book: a flush re-reads the shelf file, folds the queue in and writes once (`mergeOutbox`).
- **transcribe/**:
  - Words split on `\s`, U+00A0 included, everywhere; emphasis is by word index, so never treat a no-break space specially in one place.
  - A table's text is a derived view of its cells; reconcile the two only through `normalizeTable`, wherever a table enters.
  - Any text change carries emphasis, strong and parts by characters (`settleParts`, `spliceRunInto`); table cells fold parts to whole words.
