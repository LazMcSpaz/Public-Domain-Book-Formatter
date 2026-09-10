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

- **2** editorial queries waiting on the editor, of the 14 raised: the Gibbon
  note that closes on a comma (70), and the comma set where a full stop is
  expected between two sentences (86). The other twelve are ruled;
  `rulings.md` on the shelf is the record.
- 13 `uncertain` spans left deliberately, each with a reason on the leaf.
- The figure on leaf 67 prints without the rule the compositor set under it.
  See **The underscored figure**, below.

## The editor's rulings on Chapter I

Twelve of the fourteen queries are settled and recorded on the run itself, so a
session six months from now reads them rather than being told from memory. The
sheet is `rulings.md` beside the book; this is the summary.

**Set right** — seven corrections, applied as ordinary `text` edits and verified
by the deterministic check (`unapplied`) that compares what the editor decided
against what the book prints:

| Leaf | As printed                  | Reads                         |
| ---- | --------------------------- | ----------------------------- |
| 63   | `Nothwithstanding`          | `Notwithstanding`             |
| 66   | `Stalbaüm`, `Schleirmacher` | `Stallbaum`, `Schleiermacher` |
| 67   | `sacred number 4 the most`  | `sacred number 4, the most`   |
| 70   | `the one active ; or male`  | `the one active, or male`     |
| 84   | `take in con sideration`    | `take in consideration`       |
| 89   | `the Northen Hemisphere`    | `the Northern Hemisphere`     |
| 89   | `helicocentric system`      | `heliocentric system`         |

The two on leaf 89 are inside footnote `fn48`, which is worth saying because it
is what found a fault in the check — see below.

**Kept as printed** — five, four of them spots and one standing:

| Leaf       | Words                       | Why                                                                                  |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------ |
| 65         | `THE PYTHOGOREAN NUMERALS.` | See below: it cannot print, and mending it would break a check.                      |
| 95         | `symbolology`               | Both forms were in print in 1877. Kept and watched; a recurrence makes it standing.  |
| 95         | `Terra legit carnem …`      | Not enough is settled about the couplet to depart from the sheet.                    |
| 80         | Felt's prospectus           | It may be Felt's own circular quoted verbatim.                                       |
| _standing_ | `practiced` / `practised`   | Both were current. The edition follows the sheet word by word; tracked, not imposed. |

### The running head that could not have printed

The query on leaf 65 said reproducing `PYTHOGOREAN` "will look to a reader like
our own misspelling". That was wrong, and it was wrong in the direction that
costs something: the editor ruled on a premise the code does not support.

`runningHeadText` (`layout/paginate.ts`) takes a head from the edition title, the
author, or `page.chapterTitle`. It has never read `furniture.runningHead`. The
scanned head is a **record of the sheet** and a witness for the OCR cross-check —
`checkableText` counts it as transcribed so a leaf is not flagged for words OCR
found — so mending it would print nothing different and would make that check
disagree with the paper. Kept as printed, and the reason is on the ruling.

The lesson is narrow and worth keeping: a query has to say what the reader will
actually see, and "will look to a reader like…" is a claim about the engine that
can be checked before it is written.

### The underscored figure on leaf 67

The editor asked whether the treatment the compositor gave the `4` could be kept
without the line spacing coming out wrong. Measured off the pixels rather than
described from the render:

| Measured on the 300-DPI leaf                     | The `4` | The page's own folio `9` | Body roman `t` |
| ------------------------------------------------ | ------: | -----------------------: | -------------: |
| Median dark run across the glyph (stroke weight) |     4.0 |                      4.0 |            2.0 |
| Box height                                       |    32.8 |                     29.8 |           20.8 |

So the figure is **not display type**. It is a text figure at body size in the
fount's own weight — identical to the folio, which nobody would call display —
and it reads heavy beside `number` only because figures in this face are twice
the stroke of the lowercase. Its box (y 1264–1297) is the same vertical extent
as `by` (1264–1298) and `replaced` (1263–1298) on the same line.

What is actually distinctive is a **rule under it**: about 4 px thick and 20 px
wide, centred under the numeral, sitting 3–6 px below the baseline, inked as
solid as the type, and inside the figure's own OCR box — which is why Tesseract
read the whole thing as `4` at 86%.

**So the line spacing is not the obstacle, and would not have been.** The trap
CLAUDE.md records — "the slot grid is one _body_ leading, anything set larger
occupies several slots" — is about a **block** set larger, a title or a
subtitle. Inside a paragraph the engine has exactly one mechanism for a span set
differently from its host: `Attachment` (`layout/break-lines.ts`), which carries
its own `sizePt` and `risePt`, is measured at its own size so the breaker gets
the line length right, and touches the slot grid not at all. A footnote's
reference mark rides it today. An inline run at body size costs nothing in
spacing, and the paper is at body size.

The obstacle is a different one and should be recorded as itself: **the book has
no underline.** `<i>` and `<b>` are the whole inline notation, and `<b>` in EB
Garamond draws a real bold — which would print a lie about a figure that is not
bold. Adding a third inline kind is the same shape of change `strong` was: 28
files, 101 references, through parsing, seam-carry, retype, splice, the breaker,
`drawPage`, the reading column and the sweep. Worth doing when a book needs it;
not worth doing for one numeral.

**The figure therefore prints plain, and the rule is recorded here rather than
silently dropped.** The comma the editor approved is in.

### What applying the rulings found

`unapplied` is the deterministic cross-check between what the editor decided and
what the book prints — the one thing standing between "we agreed to fix that"
and a book that quietly keeps the error. Applying these twelve rulings ran it
for the first time on a book with rulings in it, and **three of the seven
corrections came back as outstanding after they had landed**.

None of them was a bad correction. The check's one caller handed it
`doc.blocks.map((b) => b.text)` and called that the book, which it is not:
assembly pulls footnotes out of the block flow (so both leaf-89 corrections were
invisible), divisions the editor wrote are not blocks, and a block's `text` has
its emphasis stripped out into word indices (so the leaf-67 correction, which
carries an `<i>`, could not be found at all).

Fixed by putting the rule for what counts as the book in one place —
`bookText` in `@core/assemble` — and making `unapplied` take the document rather
than a string, so no caller gets to decide. The three tests were run against the
reinstated bug and fail. This is the `deriveChapters` shape again: a second copy
of a rule agrees with the first until the day it doesn't.

One thing it left behind, worth someone's attention rather than a fix here: a
query raised through `drive.mjs query` is refused unless its words are on the
leaf, while a query arriving inside a transcription reply is not checked at all.
The leaf-67 query's quote was written in a notation the book never uses
(`<i>Tetractys</i>.` against the book's `<i>Tetractys.</i>`), which is how the
first ruling on it was recorded unfindable. A query nobody can look up is worse
than none — the driver's own words — and `parsePageTranscription` has the page's
blocks in hand when it accepts one.

## Chapter II, and what the batch shape costs

The chapter was read as **four arms of one experiment**, because the question
after Chapter I was whether the agents could be made cheaper and nobody had
measured anything. All four had the same brief except for one paragraph, and the
draft they were given had already had the hyphen rule and the numbering rule
run over it.

| Arm | Leaves | How the brief told it to work  |  Tokens |   Per leaf | Tool calls | Per leaf |
| --- | -----: | ------------------------------ | ------: | ---------: | ---------: | -------: |
| A   |      6 | one leaf at a time             | 175,295 | **29,216** |         71 |     11.8 |
| B   |      6 | every render first, then write | 135,111 | **22,519** |         15 |      2.5 |
| C   |     12 | every render first, then write | 224,225 | **18,685** |         84 |      7.0 |
| D   |     10 | every render first, then write | 163,472 | **16,347** |         18 |      1.8 |

Chapter I, for comparison, ran at about **26,000 a leaf** — six agents of six,
each working a leaf at a time, on a draft with neither rule applied.

**What the numbers actually say is that batch size is not the lever; turns
are.** Cost per leaf tracks tool calls per leaf almost exactly, and the two
lines cross: C is a bigger batch than B and dearer per leaf than D, because C
did not follow the instruction — 84 calls for twelve leaves against D's 18 for
ten. Every turn re-sends the whole accumulated context, so a reader that opens
a render, writes a leaf, opens the next render and writes again is paying for
the first render eleven more times.

The paragraph that produced that difference is one sentence long. Arm A was
told to work a leaf at a time; B, C and D were told to open every render in a
single block and then write once. **Same six leaves, A against B: 29,216 a leaf
against 22,519, and nothing found by the expensive one that the cheap one
missed.**

Chapter II came to **698,103 tokens for 34 leaves — 20,532 a leaf**, against
Chapter I's ~26,000, and that is with half the arms deliberately or accidentally
running the dear way. At D's rate the remaining 621 leaves of the volume are on
the order of **10.2M tokens against 17.2M** at the Chapter I rate.

What did _not_ change is accuracy. Every arm landed with `flagged: []` except
one leaf of C, word counts moved between −3.4% and +2.2% against the draft, and
the schema validator found nothing in any of the four. Two of the arms fixed
folios the numbering rule had disputed — leaf 120 to 62 and leaf 126 to 68, both
against the render, both confirming what the check had predicted.

### The queries, put to the crop before they were put to the editor

Chapter II raised 21 queries. Before any of them went on the editor's sheet
they went through the step the process calls Stage 8 — **cut the word out of
its own leaf at 600 DPI and look, without the hypothesis in front of you**. It
is one render per leaf and it is free.

**Thirteen were checkable that way and twelve held.** The paper really does set
`necessarially`, `superstitution`, `visioin`, `aud`, `vas`, `cxact`, `conld`,
`sweeetheart`, `Athough`, `immeas-urabiy`, `Soerius` and the comma in
`the study, of ancient philosophy`. Those are the editor's, and they are on the
sheet.

**One was not a query at all.** Leaf 117's note came back as `Sec Huxley:
“Physical Basis of Life.”` with a query asking whether an 1877 compositor's slip
should be carried into a reprint — and the crop reads **`See`**, with two `e`s.
There was never a decision there; the reading was wrong. What makes it worth
recording is the reason the reader gave: _"the third letter of the first word
has no crossbar on the render, where the `e` before it plainly does."_ That is
specific, confident, and describes a page that does not exist. It is the same
fault the six readers of Chapter I showed when three of them claimed
magnification they did not have — the readings mostly hold and **the warrant
does not**, which is exactly why a finding becomes an edit only after somebody
looks at the pixels.

`drive.mjs unquery` came out of it, because there was no way to withdraw a
question raised on a misreading: `rule` records the editor's answer to a real
question and lives forever in `rulings.md`, and this one had no question in it.
It refuses without a reason, and the reason has to be what the crop shows — a
sheet is not shortened for being long.

### Chapter III, on the shape the measurement recommended

Two batches of thirteen, told to open every render in one block, on a draft
trimmed to 80% by dropping the settled hyphens and the two `structural` lines
that repeat on every leaf.

| Batch | Leaves |  Tokens |   Per leaf | Tool calls | Per leaf |
| ----- | -----: | ------: | ---------: | ---------: | -------: |
| E     |     13 | 173,043 | **13,311** |         23 |      1.8 |
| F     |     13 | 164,511 | **12,655** |         25 |      1.9 |

**12,983 a leaf across the chapter**, against Chapter II's 20,532 and Chapter
I's ~26,000 — half the baseline, on the same accuracy. `flagged: []` for all 26
leaves, word drift between −3.5% and +1.4%, and `--check` clean on both.

The volume's numbering disputed four folios in this chapter and every one was
settled against the render: 138 → 80, 140 → 82, 141 → 83, 146 → 88. With leaves
120 and 126 from Chapter II that is **six for six**, and five of the six are the
same fault — this fount's old-style **8** read as a **3**.

At this rate the remaining 595 leaves are about **7.7M tokens**, against 15.5M
at the Chapter I rate.

### Chapter IV, and the trap that nearly cost a chapter

| Batch | Leaves |  Tokens | Per leaf | Tool calls |
| ----- | -----: | ------: | -------: | ---------: |
| A     |     13 | 188,939 |   14,534 |         22 |
| B     |     13 | 167,663 |   12,897 |         24 |

**13,715 a leaf**, `--check` clean on both, `flagged: []` on both, and the
volume's numbering disputed one folio (168 → 110) which the reader settled
against the render.

What this chapter turned up is not about the reading. Three readers across two
chapters had raised the same query — a lone figure at the foot of every
sixteenth leaf — so the rule for it was written and committed and went green:
signature `n` sits on folio `sheet × (n − 1) + 1`, so the figure and the folio
check each other and no sheet size has to be assumed. Then the next chapter was
drafted and **no signature was taken**.

The rule was right. `npm test` was running it. The driver was not: the restart
script started vite only when port 5173 was silent, so it had never restarted
vite at all, and the process from the start of the session was still serving
from an in-memory transform cache holding every module as it stood before each
`src/core` edit since. `curl` on the canonical `/@fs/…` URL came back without a
function that had been on disk for an hour; the same URL with `?v=<timestamp>`
came back with it.

**A whole chapter had been drafted by the old code and looked entirely fine**,
which is the only reason this is survivable: a draft is an input to a reader
who checks it against the render, never a thing that lands. The lesson is in
CLAUDE.md now, along with the cheap test — if the plain URL and the
cache-busted one disagree, the code is right and the server is stale.

Two more rules came out of the same pass. The signature mark: six in this
volume, on folios 33, 49, 65, 81, 97 and 113, every one giving a sheet of 16,
and the one on folio 33 is leaf 91 — in the fixture since before any of this,
with a stray `3` nobody had noticed. And a head that _measures_ as display type
because one speck of dirt on the line is tall: leaf 202 reads
`: 144 THE VEIL OF ISIS.`, 39 pixels against a 27-pixel body, and only the
folio it carries says it is furniture.

### What the free check is worth, scored

`checkConsistency` over the first 176 leaves — Stage 6, pure, deterministic, no
spend. **46 findings.** Scored one by one, because a check nobody can score
manufactures confidence:

| Kind              | Found |  Real | What the rest were                                  |
| ----------------- | ----: | ----: | --------------------------------------------------- |
| `doubled-word`    |     4 | **3** | `that which is is that which was` — correct English |
| `stray-spelling`  |    11 |     1 | a real word that resembles a commoner one           |
| `name-variant`    |     9 |     0 | the same                                            |
| `unclosed-quote`  |    21 |     — | not scored; the book quotes on nearly every leaf    |
| `missing-chapter` |     1 |     0 | a forward reference to Chapter VII, unread          |

**`doubled-word` is earning its place and the other two are not, at this
scale.** Of its four, `of of` (124) and `a a` (189) were already on the sheet
from readers, and **`with with` on leaf 201 was not** — "their own mental
requests were complied with with perfect fidelity", the line ending `complied`
and the next opening `with with`. Confirmed at 900 DPI, and OCR read the
doubling independently. Eleven readers with the render had passed over it.

The false positives are a **scale effect, not a regression**. The name-variant
check was tuned on _Clairvoyance_ from 17 findings with 1 real to 3 with 3 real,
and that tuning holds for a 200-page book in one language. _Isis Unveiled_ runs
to 628 pages of English carrying Sanskrit, Latin, Greek, French, German and
Norse, so `heretic` against `hermetic`, `Parsis` against `Paris`, `Virgil`
against `Virgin`, `genus` against `genius` and `Sanscrit` against `Sanskrit` are
all one edit apart and all correct as printed. Recorded rather than re-tuned:
the honest fix is a rule that knows a book has more than one language in it, and
guessing a new threshold from these 46 would be exactly the tuning-to-pass the
process forbids.

Eight of the 21 `unclosed-quote` findings went away for a reason that is not a
tuning: **verse and tables do not have quotations to close.** Printing
convention opens every line of quoted verse and closes only the last, and in a
column of figures a repeated `“` is the ditto mark. Exempted by block _kind_,
which is a fact about what those things are rather than a guess about how much
noise to tolerate — the same line set as prose is still reported, and that is
tested. The **13 that remain are real prose with a mark that never closes**,
and they are worth a pass: a closing mark OCR lost is the sort of thing that
prints and is found by a reader.

`missing-chapter` firing on a forward reference is an artefact of running the
check over a **partly read** book, which is worth doing anyway — it caught the
doubling three chapters before the book is finished — and is not a fault.

### Where the batch size actually settles

Chapter VI made the earlier reading of this sharper, and corrected part of it.

**The render-loading turn times out, intermittently, and it is not a size
threshold.** Four batches of this chapter died at exactly the same line —
_"now I'll open all N renders in one block"_ — each having read its brief, its
draft and nothing else. Three were opening fourteen images. The fourth was
opening **seven**, which is what killed the tidy explanation: batches of six,
seven, ten, twelve, thirteen and fourteen all came through elsewhere. Size
raises the risk and does not decide it, so there is no number to pick that buys
safety.

I wrote "eight is the size that has never failed" into the process on the
strength of the first three, and a seven-image batch failed within the hour.
The honest guidance is the dull one: keep the batch at the cheap size, and
relaunch the occasional casualty.

**And batch size does pay, which the Chapter II experiment understated.** The
seven-leaf batches the timeouts forced came in at **20,614 tokens a leaf**,
against about 13,000 for thirteen-leaf ones. The brief, the shared method
document and the setup are paid once per agent whatever its size, so a small
batch amortises them over fewer leaves. The ledger said "batch size is not the
lever; turns are", and that was half right stated as a whole: **turns dominate,
and per-agent overhead is the second term.**

So the shape is twelve or thirteen leaves, opened in one block and written
once, with a line in the brief telling the reader to split the load if that
request times out. Paying for two blocks up front buys nothing.

Nothing was lost in any of the three failures: no output file existed and the
batches already landed were untouched, which is what checkpointing per batch is
for.

### Where the rest of the cost is

At 150 DPI a leaf's render is about 1,280 tokens, so at two turns the images are
about 2,600 of D's 16,347. The rest is the brief, the draft, the reply and the
reading. The draft is the part worth attacking: measured on Chapter III's first
batch, `blocks` is 50% of it, `structural` 18%, the settled `hyphens` 16% and
`uncertain` 12%. The hyphens are pure noise to a reader — they have already been
applied to the text, and the unsettled ones are named in the brief — and two
`structural` lines repeat verbatim on every leaf. Taking those out puts the
draft at **80%** of its size, which is what Chapter III is being read against.

## What of this chapter's reading was deterministic

Measured after the fact, against what the readers actually decided. Every one
of these is a pure function over data the app already holds, and each was
checked by asking whether the rule agrees with the reader rather than whether
it looks plausible.

| Rule                                                                                                              |                                      Settled | Disagreed | Abstained |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------: | --------: | --------: |
| Heal a line-break hyphen when the joined form occurs elsewhere in the book, keep it when the hyphenated form does |                                **181 / 216** |     **0** |        35 |
| Accept a near-miss running head when its number equals the folio the volume's offset predicts                     |                                   **9 / 12** |     **0** |         3 |
| Flag a folio that disagrees with the volume's offset                                                              |                                    **2 / 2** |         0 |         — |
| Drop the printer's signature mark on every folio ≡ 1 (mod 16)                                                     | 2 / 2 in chapter, 3 / 3 predicted outside it |         0 |         — |

**The hyphen figure is a correction of an earlier one in this ledger, which
said 210 of 217 with 7 abstentions.** That number was measured with a
vocabulary that included the chapter's own corrected transcriptions — so the
readers' decisions were in the evidence, and the rule was largely agreeing with
itself. The figure above is measured the other way: the vocabulary is the
volume's OCR from the 655 leaves **outside** this chapter and no transcription
at all, 27,653 words. On that evidence the rule settles 181 of 216 candidates
and **every one of the 181 matches what a reader with the images landed**; the
35 it abstains on are left character for character.

That is a floor, not the shipped behaviour: `drive.mjs draft` weighs a leaf
against every cached leaf of the volume _and_ every leaf already corrected,
which on this book is 28,647 words and settles more — `Carpen- ter's` is
unsettled on the strict vocabulary and joined on the real one.

The offset is not assumed: it is voted by the leaves whose furniture the draft
took confidently — 24 of 26 agree on `leaf = folio + 58` in pageIndex terms —
and the two that dissent are precisely the two misread folios. The check and
the correction fall out of the same count.

The three hyphens and three heads the rules abstain on are the right ones to
abstain on: on leaves 69 and 95 OCR mangled the folio past reading (`37` came
through as `fig`), and leaf 59 is a chapter opening that prints no head at all.

**About 228 of the roughly 526 corrections made on this chapter — 43% — were
decidable without eyes.** They were done by hand, in agents, at token cost.
