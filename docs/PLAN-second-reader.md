# Plan: a second OCR engine, so every book has a witness

Status: **built and measured — kept, tiny tier, as the witness for a book
with no usable layer.** `drive.mjs second` writes the file `witness` takes;
the ledger is [`LEDGER-second-reader.md`](./LEDGER-second-reader.md): over
42 leaves its disagreements were real three times in five and it caught two
in five of Tesseract's errors, with the best of it exactly where nothing else
reads the leaf. Scope B of two; the other is
[`PLAN-page-cleanup.md`](./PLAN-page-cleanup.md).

## Why

`src/core/witness` and `drive.mjs witness` already do the valuable part: set
two machine readings of a leaf side by side, settle the mechanical
disagreements (`joined`) without anyone looking, and hand back the substantive
ones worst-first. On leaf 6 of the first book that turned 223 words into
**three** that needed a person, and all three were real.

The limit is the second reading. Today it comes from archive.org's OCR or a
Gutenberg text, so a book with neither has one reader. This plan gives every
book a second reader that is **not a language model and not Tesseract**:
PaddleOCR's detection and recognition models, running in the browser through
ONNX Runtime Web.

## The engine

- **`ppu-paddle-ocr`** (MIT), web build `ppu-paddle-ocr/web`, on
  **`onnxruntime-web`** (MIT). Runs in the page or a worker, uses WebGPU where
  the browser has it and WASM where it does not. Returns line boxes with
  confidences. Pin both versions, and add them to CLAUDE.md's _Pinned
  dependencies_ with the reason.
- **Model weights are vendored**, like Tesseract's: into `public/paddle/`, never
  fetched from a CDN at run time. Pass them through the service's `model` option
  (`detection`, `recognition`, `charactersDictionary`) as paths resolved against
  `import.meta.env.BASE_URL` — read the subpath note at the top of
  `src/platform/browser/ocr.ts` first, because a root-absolute path fails on
  GitHub Pages from inside a worker. Add the files to whatever `public/sw.js`
  caches, so `npm run check:install` still opens offline.
- **Check the licence of the weights you vendor** (PaddleOCR's upstream models
  are Apache-2.0) and put the source, version and licence in a
  `public/paddle/README.md`.
- **Pick the model tier by measurement.** Start with the tiny tier (~6 MB);
  try the small one (~30 MB, fuller character dictionary) on the same leaves.
  Check the dictionary against the characters these books actually print —
  æ, œ, accented Latin, the dashes and quotation marks — using the lexicon's own
  character inventory. Greek, Hebrew and the long-s are **out of scope** for
  either reader; do not chase them here.
- **Load it lazily** (dynamic `import()`), so the bundle, the first paint and a
  wizard user who never uses it pay nothing.

## Shape

- **`src/platform/browser/second-reader.ts`**: open a book, render a leaf at the
  recon DPI, read it, release it — the same one-page-at-a-time discipline as
  recon.
- **It reads the original render**, not a cleaned one. Two readers that share a
  preprocessing step share its blind spots, and independence is the entire
  point of a witness.
- **Lines into reading order is a pure function in `src/core`** (e.g.
  `src/core/witness/reading-order.ts`): boxes in, leaf text out. Top-to-bottom,
  left-to-right, and — because `src/core/draft` now cuts two-page leaves and
  reads columns — reuse that geometry rather than inventing a second opinion
  about where a column is. Test it on `test/fixtures/boxes`.
- **The output is the contract that already exists.** `drive.mjs witness`
  takes `second.json` = `{ "<leaf>": "text" }`. Write exactly that. If
  `compareWitnesses` needs no change, change nothing in it.
- **A driver verb**: `drive.mjs second [leaf…] [out.json]` — read the named
  leaves (all by default), write `second.json`, and report per leaf the time
  taken and the line count, naming the book and run the pixels came from (see
  `PLAN-next.md` §0.1 on why every pixel verb must say which book it read).
- **Cache it** under the recon cache's rules: keyed by the file, the DPI and
  the model id; a mismatch is refused and deleted, never served.

## Measuring

Same ground truth as the cleanup plan — the proofread leaves of the finished
books — and the same leaf list if that plan has run, so the two ledgers can be
read together.

For each leaf, record:

1. **Paddle alone** against the proofed text: agreeing words, substantive
   disagreements.
2. **Tesseract vs Paddle** through `compareWitnesses`: how many substantive
   disagreements are raised.
3. **Precision** — of those disagreements, how many sit on a word Tesseract got
   wrong (per the proofed text)?
4. **Recall** — of Tesseract's actual errors, how many fall inside a
   disagreement? The errors outside one are the ones both readers made, and no
   witness can find them; that number should be written down, not hidden.
5. Where the book has archive.org OCR, the same two numbers for that witness,
   so the new reader is scored against the one it is joining.
6. Milliseconds per leaf in headless Chromium in the session container, and
   the model tier.

Write it to `docs/LEDGER-second-reader.md` with the decision. **The reader
earns its place if its disagreements are mostly real errors and it catches a
meaningful share of them.** If precision is low, it is manufacturing work and
should be tightened or dropped. That is the standing rule about checks nobody
can score.

## Where it runs, and when it moves

Sessions drive the app in headless Chromium inside their own cloud container,
so `drive.mjs second` runs there with no new infrastructure. **Build that
first.**

Only if the measured time per leaf makes a whole book impractical in a session,
the same code runs in a `workflow_dispatch` job on GitHub Actions, following
`voice-samples.yml` exactly: install the engine with `npm i --no-save` so CI
never pays for it, cache the weights, and commit `second.json` beside the
book. That job needs the scan, which lives on the shelf, so it would need a
read-only token for the shelf as a repository secret — which is why it is the
fallback and not the plan. Standard runners are free on a public repository;
GPU runners are not, and nothing here needs one.

## Tests (pure, no browser)

- Reading order on single-column, two-column and two-page fixture leaves.
- The `second.json` writer's shape, and that `drive.mjs witness` accepts it.
- Cache refusal on a different file, DPI or model id.

## Done when

- `drive.mjs second` writes a `second.json` that `drive.mjs witness` consumes
  unchanged, for a whole book.
- The ledger is committed with the decision, and the model tier with its reason.
- The weights are vendored with their licence, the app still installs and opens
  offline, and a wizard user who never touches it downloads nothing extra.
- `npm test`, `typecheck`, `lint`, `format:check` and `build` pass.

## Next, once the ledger says yes — not part of this plan

- **Put it in the app, not only the driver.** A feature reachable only from a
  chat session is a feature the app does not have: offer the second reading at
  recon on leaves `assessText` flags, and lead Gate 2 with its disagreements.
  Measure phone time before deciding it runs by default.
- The Actions job above, if a session cannot finish a book.
