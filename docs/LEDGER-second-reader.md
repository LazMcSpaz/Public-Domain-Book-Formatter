# Ledger: a second OCR engine, so every book has a witness

The measurement `docs/PLAN-second-reader.md` asked for, and the decision it
leads to. Every number comes out of `node scripts/second-ledger.mjs` over the
trial directories under `docs/ledger-data/second-reader/`; nothing in the
tables was typed by hand.

## The engine

PaddleOCR PP-OCRv6, **tiny tier** (6.4 MB of weights, vendored under
`public/paddle/tiny/` with their SHA-256 and Apache-2.0 licence), run by
`ppu-paddle-ocr` 6.6.0 on `onnxruntime-web` 1.30.0, WASM, one thread, in the
driver's headless Chromium. It reads the original render at 300 DPI — never
a cleaned one — and its line boxes are put into reading order by
`@core/witness/reading-order`, which is the draft's own column geometry.

## The leaves

The cleanup ledger's leaves, so the two can be read together: per book, eight
body leaves evenly spaced through the volume plus the four carrying the most
corrections in the proofed text; six for _The Human Aura_.

| Book                | Leaves                                                |
| ------------------- | ----------------------------------------------------- |
| `human-aura`        | 10, 11, 14, 34, 55, 75                                |
| `clairvoyance`      | 13, 16, 27, 33, 71, 110, 149, 187, 205, 226, 265, 303 |
| `thought-vibration` | 37, 42, 56, 58, 70, 84, 98, 100, 111, 112, 126, 140   |
| `patterns-vol2`     | 23, 37, 46, 51, 79, 83, 107, 137, 165, 193, 221, 233  |

## What is measured

For each leaf, Tesseract's fresh reading (`drive.mjs ocr … fresh`) is the
first reader and the proofed text (`drive.mjs truth`) is the truth. Each
witness — the engine (`drive.mjs second`), and on the three books whose scan
carries somebody's OCR, that layer (`drive.mjs second --layer`) — is scored
by `scoreWitness`:

- **Raised** — substantive disagreements between Tesseract and the witness:
  what an editor would be handed.
- **Real / precision** — of those, how many sit on a word Tesseract in fact
  got wrong.
- **Caught / recall** — of Tesseract's real errors, how many fall inside
  something the witness raised.
- **Both wrong** — Tesseract's errors that no disagreement covers. No witness
  can find these, and the number is written down rather than hidden.
- **Witness errors** — the witness alone against the proofed text.

## The numbers

Measured 2026-09-21 in the driver's Chromium. Tesseract.js at 300 DPI is the
first reader; the engine is PP-OCRv6 tiny on `onnxruntime-web` 1.30.0, WASM,
one thread; the layer is what `extractPageWords` reads out of the file. The
rows are under `docs/ledger-data/second-reader/<book>/`, and the tables are
`node scripts/second-ledger.mjs docs/ledger-data/second-reader/* --regimes docs/ledger-data/second-reader/regimes.json`.
`either` is both witnesses together where a book has both — what an editor
is handed.

### The Human Aura — aura-loose (Acrobat Paper Capture scan, OCR layer)

| Witness  | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught |   Recall | Both wrong | ms/leaf |
| -------- | -----: | ---------------: | -------------: | -----: | ---: | --------: | -----: | -------: | ---------: | ------: |
| `paddle` |      6 |               31 |             24 |     34 |   25 |   **74%** |     25 |  **81%** |          6 |    3025 |
| `layer`  |      6 |               31 |            303 |    309 |   25 |    **8%** |     29 |  **94%** |          2 |      93 |
| `either` |      6 |               31 |              — |      — |    — |         — |     31 | **100%** |          0 |       — |

### Clairvoyance and Occult Powers — tight-clairvoyance (1916 letterpress, LuraDocument scan, OCR layer)

| Witness  | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught |  Recall | Both wrong | ms/leaf |
| -------- | -----: | ---------------: | -------------: | -----: | ---: | --------: | -----: | ------: | ---------: | ------: |
| `paddle` |     12 |               43 |             45 |     35 |   16 |   **46%** |     17 | **40%** |         26 |    4433 |
| `layer`  |     12 |               43 |             30 |     14 |   14 |  **100%** |     14 | **33%** |         29 |     285 |
| `either` |     12 |               43 |              — |      — |    — |         — |     17 | **40%** |         26 |       — |

### Thought Vibration — Google Books scan, no text layer

| Witness  | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught |  Recall | Both wrong | ms/leaf |
| -------- | -----: | ---------------: | -------------: | -----: | ---: | --------: | -----: | ------: | ---------: | ------: |
| `paddle` |     12 |               29 |             31 |     10 |    6 |   **60%** |      6 | **21%** |         23 |    3521 |

### Patterns Vol. II — archive.org scan of a 1977 typescript, columns on many leaves, OCR layer

| Witness  | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught |  Recall | Both wrong | ms/leaf |
| -------- | -----: | ---------------: | -------------: | -----: | ---: | --------: | -----: | ------: | ---------: | ------: |
| `paddle` |     12 |              138 |            129 |     88 |   54 |   **61%** |     51 | **37%** |         87 |    4041 |
| `layer`  |     12 |              138 |             74 |    109 |   79 |   **72%** |     79 | **57%** |         59 |     216 |
| `either` |     12 |              138 |              — |      — |    — |         — |     80 | **58%** |         58 |       — |

### All books

| Witness  | Leaves | Tesseract errors | Witness errors | Raised | Real | Precision | Caught |  Recall | Both wrong | ms/leaf |
| -------- | -----: | ---------------: | -------------: | -----: | ---: | --------: | -----: | ------: | ---------: | ------: |
| `paddle` |     42 |              241 |            229 |    167 |  101 |   **60%** |     99 | **41%** |        142 |    3859 |
| `layer`  |     30 |              212 |            407 |    432 |  118 |   **27%** |    122 | **58%** |         90 |     219 |
| `either` |     30 |              212 |              — |      — |    — |         — |    128 | **60%** |         84 |       — |

### The rule, applied

A witness earns its place at precision ≥ 50% and recall ≥ 50% in aggregate, with precision not under 33% on any single book.

- `paddle`: precision 60%, recall 41% → does not earn its place
- `layer`: precision 27%, recall 58%; precision under 33% on The Human Aura → does not earn its place

## The decision

**Kept, tiny tier, as the witness for a book with no usable layer — and not
the default witness on every book.** The rule written before the numbers
asked for recall of one half; the engine gave two fifths.

What the numbers say, book by book:

- **_The Human Aura_**: the engine is the witness this book was waiting for.
  74% of what it raises is a real error and it catches 81% of them, with six
  of thirty-one errors left that both engines make alike. The scan's own
  layer — Acrobat's Paper Capture, 2012 — is worthless here: 303 errors on
  six leaves against Tesseract's 31, so its disagreements are noise nine
  times in ten. A book like this had one reader, and now has two.
- **_Clairvoyance_**: the layer is the better witness. Everything it raises
  is real (14 of 14) and it catches a third; the engine raises 35, is right
  16 times, and catches 17 — a different third, so together they reach 40%.
  Twenty-six of forty-three errors are made by all three readers alike: this
  1916 face is where every engine here reads worst, and no witness reaches
  those.
- **_Thought Vibration_**: no layer, so the engine is the only second reader
  there is. It raises little (10 on twelve leaves), six of it real, and
  catches a fifth. Twenty-three of twenty-nine errors are shared — the
  Google scan's gutter shadow, which both engines read the same way.
- **_Patterns_ Vol. II**: the layer is again the better witness (72% precise,
  57% caught) and the engine adds to it (either: 58%). Eighty-seven of 138
  errors are shared, and they are the columns: both engines read the
  transcript leaves across, and so did the layer. That is not an OCR fault
  and no third reader will fix it; `findPairedBands` is what knows where
  those columns are, and a reading order that used it _before_ the engine —
  cutting the leaf into its columns and reading each — is the next thing
  worth trying on this book.
- **Over everything**: precision 60%, recall 41%, 3.9 seconds a leaf. A whole
  book of three hundred leaves is twenty minutes in a session container,
  which is practical; the GitHub Actions fallback in the plan is not needed.

So the engine earns a place and not a throne: use it where the book has no
layer, or a layer that scores like _The Human Aura_'s, and use the layer where
it scores like _Clairvoyance_'s. `second --layer` writes the layer in the same
shape so the choice can be measured on any book in a minute, and both files
go through `witness` unchanged.

**The tier.** Tiny, because it was the one measured and it was enough to
decide with. The `small` tier (31 MB, the full character dictionary) is the
next thing to measure, for recall: on _Clairvoyance_ and _Thought Vibration_
the engine's own error count is level with Tesseract's, which is what a
larger recogniser would move. It is fetched by `node
scripts/fetch-paddle-models.mjs small` and read by `second --tier small`; it
is not vendored until a ledger says it should be.

**What was kept honest.** The engine read the original render, never a
cleaned one, so this ledger and the cleanup ledger are independent. Reading
order is the draft's column geometry, tested on the fixtures: on single-column
leaves it reproduces Tesseract's emission order to 0.97 and above, and on
the transcript leaves it cuts the columns Tesseract read across — which is
why leaf 221 of _Patterns_ shows 52% agreement in `witness`: the two readers
are in different orders there, not in different words, and the disagreement
count on such a leaf is an order fault before it is an OCR one. That is named
above as the next thing to try, not hidden in the aggregate.

**Not done, and named:** the `small` tier; a row-major order for transcript
tables, which neither engine nor the layer gives; the reader in the app
rather than only in the driver, which the plan's own next section owns; and
the cache, which is `localStorage` keyed by file, DPI and model rather than
the recon store, because that store is capped and evicts oldest-first and a
book's worth of text must not push a ten-minute OCR reading out.

---

## Which leaves to read again, measured before it was built

The plan's next section says to offer the second reading "on leaves
`assessText` flags". Measured on the 42 proofed leaves above — 214 real errors
— with `scripts/select-ledger.mjs`, against a coin averaged over 500 shuffles:

| share of leaves | oracle | **noise, then score** | noise alone | score alone | longest first | random |
| --------------: | -----: | --------------------: | ----------: | ----------: | ------------: | -----: |
|             25% |    68% |               **50%** |         47% |         35% |           18% |    26% |
|             50% |    84% |               **72%** |         62% |         58% |           38% |    51% |
|             75% |    94% |               **89%** |         75% |         86% |           79% |    76% |

**The rule as written does not work.** `assessText`'s score reaches 35% of the
damage at a quarter of the leaves against a coin's 26%, and the verdict
separates no better: `mixed` leaves average 6.6 real errors and `trustworthy`
ones 4.0, so a leaf this app calls trustworthy carries four.

The reason is in `assess.ts`'s own docstring, and it is not a defect in it:
_"a misreading shaped like a word … no statistic over word shapes will ever
catch that"_. A second reader earns its keep on exactly those — `thc` for
`the`, `arc` for `are` — so selecting for them with a measure of word shape
asks a check for the one thing it says it cannot see. The rule was reasoned
about rather than measured, which this repository has a standing lesson about.

**Noise does not work on its own either, and the first version of this table
said it did.** `noise` — the share of tokens carrying a symbol no typesetter
set — is **zero on 34 of the 42 leaves**. It ranks eight leaves and says
nothing whatever about the other thirty-four, so at three quarters of the book
it reaches 75% against a coin's 76%. Ranked on noise and then on score it
beats the coin at every share, and that is what `planSecondReading`
(`@core/witness/select`) does, with the page index last so one book plans the
same way twice.

### Two faults in this table's own first version

Both flattered the signals, both were found by making the script agree with
the module rather than by reading either, and both are worth recognising
anywhere a ranking is scored.

- **The baseline was one shuffle.** A sample of size one, quoted as though it
  were the coin: it read 24% at a quarter of the leaves where the mean over
  500 shuffles is 26%, and 59% at a half where the mean is 51%.
- **The tie-break was doing the work.** The column called "noise" was sorted
  by noise with a _score_ tie-break, and — noise being flat on four leaves in
  five — the tie-break is what ranked most of the book. One signal was given
  credit for another's work, and the module built from that table implemented
  the other tie-break and so would not have reproduced its own numbers.

**What a subset must not be called is "the damaged leaves".** A quarter of the
leaves is half the damage. `SecondReadingPlan` carries `expectedRecall` beside
the selection, from the table above, so a caller cannot show the saving
without the cost; reading everything is what finds everything, and it is the
default. A subset offered as though it were the damage is the check
manufacturing confidence, which is the one failure this ledger exists to
avoid.

Three faults were injected against the tests and all three caught: ranking on
`score` instead of `noise`, dropping the score tie-break, and quoting the
recall of the share _asked for_ rather than of the selection actually made —
which a short book makes different, since a quarter of three leaves is one.
