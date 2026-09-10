# Reading ledger — _Isis Unveiled_, Vol. I

693 leaves of scan. **38 transcribed so far**: pageIndex 59–96, which is
Chapter I entire, folios 1–38. The remaining 655 are unread.

This is the first book here read at chapter scale under the no-API process,
and the first whose scan carries a digitization stamp or whose text carries
footnotes at all. Everything below is measured from the drafts and the landed
batches rather than taken from a reader's own account of its work.

## The scan

HathiTrust's scan of the Cornell copy of the 1877 first edition, merged from
its 19 chunks — 357 MB, past `MAX_SCAN_BYTES` by an order of magnitude, so it
lives in the working container and not on the shelf. See
`ISIS-UNVEILED-1877-scans.md` on the shelf for the leaf-to-folio map and how to
rebuild it.

**Recon: 693 leaves in 47 minutes, 4.1 s a leaf**, at 300 DPI. Run twice,
because the first reading was destroyed by a restart script that deleted the
driver's persistent profile. That profile holds the recon cache and the stored
scan; nothing else here costs 47 minutes to replace.

## The readers

| Reader                   | What it is                                                                      | Independent of                              |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------- |
| OCR                      | Tesseract off the 300-dpi render                                                | —                                           |
| `@core/draft`            | the geometry OCR measured and threw away                                        | nothing — same words                        |
| Six batch agents         | one per handful of leaves, given the page images and the draft                  | the draft's _judgement_, not its characters |
| The deterministic checks | `verifyPage` against the cached OCR, `checkConsistency` over the assembled text | all of the above                            |

There is no second OCR engine and no typeset witness for this book. The agents
are therefore the only reader with _meaning_ available, and the OCR
cross-check is the only reader independent of them.

## What the reading changed

Measured across the 38 leaves, draft against landed batch:

|                              | Draft |  Landed |                                                               |
| ---------------------------- | ----: | ------: | ------------------------------------------------------------- |
| Running heads in `furniture` |    26 |  **37** | of 37 possible — leaf 59 is a chapter opening and prints none |
| Italic runs                  |     0 | **227** | OCR recovers no emphasis at all                               |
| Footnote blocks              |    51 |  **58** | seven the draft never saw                                     |
| Unhealed line-break hyphens  |   217 |   **0** |                                                               |
| Verse blocks                 |     0 |   **7** | all were `heading`, being centred                             |
| Heading blocks               |    14 |       3 |                                                               |
| `uncertain` spans            |   389 |  **13** | the rest were settled against the image                       |
| Editorial queries            |     0 |  **14** |                                                               |

## What each check raised, and what survived

| Check                                      | Raised | Confirmed | Refuted |
| ------------------------------------------ | -----: | --------: | ------: |
| `verifyPage` — OCR against the landed text |      6 |     **6** |       0 |
| `checkConsistency` over the chapter        |      8 |     **0** |       8 |

**The OCR cross-check earned its place outright.** All six findings were
`orphan-footnote` on one batch, whose agent left the reference mark inside the
footnote's text and set no `marker` field. That matters rather than being
pedantry: `assemble-book` calls `stripLeadingMarker(raw, block.marker ?? '*')`,
so a dagger note with no marker would have been labelled `*` **and** kept its
`†` in the text. Repaired deterministically by lifting the leading mark into
`marker`, and the batch re-landed clean.

**`checkConsistency` produced nothing real on this chapter**, and every finding
is explainable rather than random:

- three `stray-spelling`, each proposing a word that is wrong in context —
  `teachers` for `teaches` in "as it teaches", `hermetic` for `heretic` in
  "treated as a heretic", `finger` for `finer` in "the finer intuition of a
  Champollion";
- five `unclosed-quote`, being the **ditto marks** in the yuga table (`1,296,000 “`),
  two verse quotations opening in one block and closing in another, and two
  quotations continuing across a page seam, which is how the book is set.

0 of 8 on one chapter is not enough to condemn a check that costs nothing, but
it is recorded so it can be scored rather than trusted. If the rate holds over
several chapters the quote check wants a rule for tables and verse.

## What only a reader with the image could find

**Leaf 72's footnote was never OCR'd at all.** The page prints
`* Exodus, xxv., 40.` under the rule; the word boxes go from the last body line
at y=1969 straight to the stamp at y=2411, with nothing between. No
deterministic check could have caught it — the transcription ends up with
_more_ text than OCR, not less, so nothing is missing to detect. Restored from
the render and **adjudicated against a 500-DPI crop before being believed**.

That single leaf is the argument for the whole image-based pass.

## The systematic faults, which the chapter made visible

**The digitization stamp, on every leaf.** `Digitized by … CORNELL UNIVERSITY`
at the foot of all 693. Now lifted by `@core/draft` — 38 of 38 in this chapter,
none left in the text — and recorded in `furniture.stamp` rather than dropped.
Measured, not assumed: landing leaf 59 with the stamp dropped produces
`confident-word-missing`; landing it recorded produces `flagged: []`. Dropping
it silently would have flagged all 693 leaves.

**Printer's signature marks, every sixteenth folio.** OCR emits them as a
stray digit block with no home in `PageFurniture`. Found on folios 17 (`2`) and
33 (`3`), which predicts one on every folio ≡ 1 (mod 16); drafting folios 49,
65 and 81 outside the chapter returned `4`, `5` and `6`. **Confirmed 3 of 3.**
Vol. I will carry about 39 of them. Two agents removed theirs independently and
neither had anywhere to put it.

**A running head fell into the body on 12 leaves of 38.** The set-apart test
declines them by a hair — leaf 101 stands 35 from the line below against a
threshold of 36. The declines now speak, so each was visible and 11 were moved
by hand (the twelfth is the chapter opening, which prints none). At 32% of
leaves this is the largest remaining hand cost in the process and the number
most worth attacking — but the constant must be measured, not tuned to make a
page come out nicer.

**Bands of scanner noise read as words.** Leaf 62 carried
`A ET yr rt er oR BDI + 37 = VSO OPE Err AT` spliced onto a paragraph; leaf 70
and leaf 84 the same off the footnote rule. They are a horizontal band at one
y, spanning the full measure, at OCR confidence 0–50 — mean about 26. Deleting
them by rule would be wrong: low confidence means _needs eyes_, and the leaves
that most need reading would be the ones eaten. The honest fix is a report, not
a deletion, and `@core/draft` does not make one yet.

**One folio was misread rather than misplaced.** The draft gave leaf 66 the
folio `3`; the page prints `8`. Nothing in `structural` flagged it, because the
furniture rule was confident. Caught by an agent and independently confirmed by
the leaf-to-folio map, which is constant at `leaf = folio + 59` for this volume.

## What the batch readers are worth, and where they overstate

Their substantive readings held up under checking. Two spot-checks against
crops the parent cut itself: the paper does print `symbolology` and does print
`mediæval` with the ligature, both as reported.

But **three of the six reported evidence they could not have had** — "confirmed
at 4×", "checked at 8×", "verified at 10×" — when what each was given was one
150-DPI page image and no means of magnifying it. The readings were right; the
warrant was inflated. One agent did do the honest thing and measured, summing
dark pixels per column to tell a broken em dash from two.

The lesson is the one the process already states: a reader's account of its own
confidence carries no weight, and the crop is what settles a reading. Score the
batch by what survives the pixels, never by how sure it sounded.

## Cost, for sizing the rest

- Recon: 4.1 s a leaf, once per volume.
- Six agents over 37 leaves: 121k–205k tokens each, 43–86 tool calls each,
  5.5–14.6 minutes each, run in parallel.
- The parent held **no page image** for any leaf a batch read. The one leaf it
  read itself, leaf 59, took six crops — a chapter opening with Greek in a
  footnote is the expensive kind.

At this rate the remaining 655 leaves of Vol. I are on the order of 95 further
batches. That is the number to argue with before running it.

## Still open

- 14 editorial queries, waiting on the editor; `queries.md` on the shelf.
- 13 `uncertain` spans left deliberately, each with a reason on the leaf.
- The book has not been saved to the shelf, so this reading exists only in the
  container's IndexedDB.
