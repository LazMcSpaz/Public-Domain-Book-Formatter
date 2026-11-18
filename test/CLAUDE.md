# test/

The automated tests (vitest), one flat folder of `*.test.ts` files plus `fixtures/`. `npm test` runs them in Node with no browser, network or API key; it is the main gate for a code change. The wider guide is [docs/reference/testing.md](../docs/reference/testing.md).

## May use

- `src/core/` (alias `@core`), `src/platform/` with stubs (alias `@platform`), the plain-Node helpers in `scripts/lib/`, and `fixtures/`.

## Must not

- Need a browser, a network, a running dev server or a real API key: browser checks belong in `scripts/check-*.mjs`.
- Read a book from the shelf: commit a small fixture to `fixtures/` or build one in the test.

## Key files

- `../vitest.config.ts`: runs `test/**/*.test.ts` in Node and defines the aliases.
- `fixtures/`: OCR word boxes, a sample hOCR file, the English word list.
- `layout-*.test.ts`: the engine, measured with `fixedWidthMeasurer` so every break is exact arithmetic.
- `provenance.test.ts`: also pins the route table in `docs/FLOW.md` to the code.

## Folder-specific rules and lessons

- Before creating a test file, `ls` the path: `emphasis.test.ts` was once replaced by a new file with the same name.
- Prove each new test: put the fault back, watch the test fail, remove it again. A test green before and after the fix tests nothing.
- Test question and answer round trips by transfer: questions from profile A, answered with defaults, applied to B, must turn B into A.
- If a fault only shows at scale, build a fixture big enough to trip it (the contents bug needed 40 chapters; 2 and 14 passed).
- Assert the invariant the code itself guards (for example the page count), never a proxy for it (the number of laid-out items).
- Never write a ratio into a test or comment from eyeballing a render; measure the ink off the PNG first (`scripts/lib/ink.mjs`).
- Footnote tests assert which words carry each reference (the raised runs), not counts; fixtures need a following leaf with marks.
