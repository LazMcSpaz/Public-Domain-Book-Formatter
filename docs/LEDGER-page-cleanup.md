# Ledger: cleaning the page before Tesseract reads it

The measurement `docs/PLAN-page-cleanup.md` asked for, and the decision it
leads to. Every number here comes out of `node scripts/cleanup-ledger.mjs`
over the trial files `drive.mjs cleantrial` wrote; nothing in the tables was
typed by hand. The leaf list was written down **before** anything ran.

## The leaves

Per book: eight body leaves evenly spaced through the volume (the middle of
each eighth), plus the four body leaves carrying the most corrections in the
proofed text — the leaves the reading found hardest. Six for _The Human
Aura_, a shorter book with almost no corrections. Chosen by rule from each
book file, never by looking at the pages.

| Book                | Regime                                                        | Leaves | Evenly spaced                        | Most corrected   |
| ------------------- | ------------------------------------------------------------- | -----: | ------------------------------------ | ---------------- |
| `clairvoyance`      | tight-clairvoyance (1916 letterpress, LuraDocument scan)      |     12 | 33, 71, 110, 149, 187, 226, 265, 303 | 13, 16, 27, 205  |
| `thought-vibration` | Google Books scan, no text layer                              |     12 | 42, 56, 70, 84, 98, 112, 126, 140    | 37, 58, 100, 111 |
| `patterns-vol2`     | archive.org scan of a 1977 typescript, columns on many leaves |     12 | 23, 51, 79, 107, 137, 165, 193, 221  | 37, 46, 83, 233  |
| `human-aura`        | aura-loose (Acrobat Paper Capture scan)                       |      6 | 14, 34, 55, 75                       | 10, 11           |

Ground truth is each leaf's proofed words — the transcription with every
correction applied, placed leaf by leaf by `leafTruth` (`drive.mjs truth`)
— with the leaf's running head and folio in front and its footnotes behind,
in the order the engine meets them on the page. A reading is aligned to it
with `compareWitnesses`; **substantive** is a disagreement in letters and is
the number that decides. **Joined** is the same letters differently broken
(a healed line-break hyphen) and is noise here.

## Presets

- `off` — the render as it is, byte for byte. Today's behaviour.
- `gentle` — grayscale, then levels anchored to the leaf's own paper and ink
  (the 85th and 2nd percentiles of its luminance histogram).
- `gentle+despeckle` — the above, then a radius-1 despeckle.
- `binarise` — `gentle`, then a threshold at the midpoint. Measured because
  the plan said to; expected to lose, since Tesseract binarises internally.

## The numbers

Measured 2026-09-21 in the driver's Chromium, Tesseract.js 300 DPI, one render
per leaf and one read per preset through `recognizeLeaf` — the call recon
makes. The rows are in `docs/ledger-data/page-cleanup/`, one file per book,
and the tables are `node scripts/cleanup-ledger.mjs docs/ledger-data/page-cleanup/trial-*.json --regimes docs/ledger-data/page-cleanup/regimes.json`.

### Clairvoyance and Occult Powers — tight-clairvoyance (1916 letterpress, LuraDocument scan)

| Preset             | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |
| ------------------ | -----: | ---------: | -------: | ----------: | -----: | ---------: | -------: | -----: |
| `off`              |     12 |       3252 |     3072 |      **43** |     70 |       94.9 |        0 |   3707 |
| `gentle`           |     12 |       3252 |     3075 |      **40** |     71 |       94.9 |      411 |   3454 |
| `gentle+despeckle` |     12 |       3251 |     3073 |      **41** |     70 |       94.8 |     3852 |   3404 |
| `binarise`         |     12 |       3252 |     3076 |      **40** |     70 |       94.8 |      342 |   2773 |

### The Human Aura — aura-loose (Acrobat Paper Capture scan)

| Preset             | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |
| ------------------ | -----: | ---------: | -------: | ----------: | -----: | ---------: | -------: | -----: |
| `off`              |      6 |       1290 |     1226 |      **31** |     18 |       93.5 |        0 |   1825 |
| `gentle`           |      6 |       1291 |     1218 |      **31** |     18 |       93.3 |       65 |   1656 |
| `gentle+despeckle` |      6 |       1291 |     1218 |      **31** |     18 |       93.3 |      910 |   1654 |
| `binarise`         |      6 |       1289 |     1215 |      **36** |     16 |       91.7 |       83 |   1572 |

### Patterns Vol. II — archive.org scan of a 1977 typescript, columns on many leaves

| Preset             | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |
| ------------------ | -----: | ---------: | -------: | ----------: | -----: | ---------: | -------: | -----: |
| `off`              |     12 |       3071 |     2638 |     **138** |     25 |       89.6 |        0 |   2353 |
| `gentle`           |     12 |       3071 |     2636 |     **139** |     25 |       89.6 |      138 |   2295 |
| `gentle+despeckle` |     12 |       3070 |     2637 |     **140** |     26 |       89.6 |     1505 |   2315 |
| `binarise`         |     12 |       3072 |     2640 |     **139** |     25 |       89.3 |      172 |   2173 |

### Thought Vibration — Google Books scan, no text layer

| Preset             | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |
| ------------------ | -----: | ---------: | -------: | ----------: | -----: | ---------: | -------: | -----: |
| `off`              |     12 |       2383 |     2285 |      **29** |     38 |       94.7 |        0 |   2008 |
| `gentle`           |     12 |       2382 |     2285 |      **29** |     38 |       94.7 |      296 |   1940 |
| `gentle+despeckle` |     12 |       2382 |     2285 |      **29** |     38 |       94.6 |     2925 |   1949 |
| `binarise`         |     12 |       2383 |     2283 |      **30** |     38 |       94.5 |      333 |   1890 |

### All books

| Preset             | Leaves | Words read | Agreeing | Substantive | Joined | Mean conf. | Clean ms | OCR ms |
| ------------------ | -----: | ---------: | -------: | ----------: | -----: | ---------: | -------: | -----: |
| `off`              |     42 |       9996 |     9221 |     **241** |    151 |       93.1 |        0 |   2566 |
| `gentle`           |     42 |       9996 |     9214 |     **239** |    152 |       93.1 |      251 |   2433 |
| `gentle+despeckle` |     42 |       9994 |     9213 |     **241** |    152 |       93.0 |     2496 |   2427 |
| `binarise`         |     42 |       9996 |     9214 |     **245** |    149 |       92.7 |      254 |   2178 |

### The rule, applied

A reduction counts only past a floor of 13 (a twentieth of `off`'s 241, never under 10); a book loses when its count rises by more than 3% or one, whichever is larger.

- `gentle`: -2 substantive against `off` in aggregate (not better); loses on no book → not eligible
- `gentle+despeckle`: 0 substantive against `off` in aggregate (not better); loses on no book → not eligible
- `binarise`: +4 substantive against `off` in aggregate (not better); loses on The Human Aura → not eligible

**Default: `off`** — no preset is eligible.

## The decision

**`off` stays the default.** No preset beats it.

- `gentle` is a wash: three fewer substantive disagreements on
  _Clairvoyance_, one more on _Patterns_ Vol. II, none either way on the
  other two, two fewer over ten thousand words. That is the run-to-run noise
  of the engine, not a difference, and the rule's floor says so.
- `gentle+despeckle` reads the same words and costs **2.5 seconds a leaf**
  to clean — a radius-1 despeckle over eight million pixels in plain
  JavaScript is as long again as the OCR it precedes. On a three-hundred-leaf
  book that is twelve minutes for nothing.
- `binarise` loses, as the plan said it would: five more on _The Human
  Aura_, four more in aggregate, and the mean confidence down half a point.
  Tesseract binarises internally, and a threshold set in front of it takes
  the soft edges away that its own adaptive cut would have used.
- Mean confidence moved by nothing on the two presets that did not lose,
  which is the secondary evidence agreeing with the primary.

What the trial also says, and the plan did not ask: these scans are already
clean enough for the engine. The disagreements that remain are not tonal —
they are _Patterns_' columns read across (138 of the 241 are on that book,
and its leaves are the ones `findPairedBands` exists for), a Google scan's
gutter shadow, and words the 1916 compositor set in a face the engine has no
model of. None of those is a levels problem, and a cleaning stage cannot
reach them. The gain the plan hoped for is not there to be had on this shelf.

**Kept:** the machinery, because it cost nothing to keep and the next shelf
may be foxed or grey where this one is not. `DEFAULT_CLEANUP` is `off`;
`drive.mjs ocr … fresh --clean=<preset>` and `cleantrial` measure any leaf
through any preset on the same path recon takes; the recon cache refuses a
reading made under a different preset. A later ledger that finds a preset
clearing the floor on a book like that changes the default with its numbers
beside it, and nothing else has to change.

**Not done, and named:** the trial did not include leaves `assessText`
rated damaged, because that verdict needs a whole reading and none of these
books had one cached in this container; the most-corrected leaves stood in
for them. And the four presets are the four the plan named; a levels curve
with gamma, or a mild unsharp mask, were not tried. Either belongs in the
next ledger, not in this one's conclusion.
