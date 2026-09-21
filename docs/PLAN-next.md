# Plan: what is left

Status: **the tool is safe to run; no second book has been read.** Written after
a day of review that found seventeen faults across four independent passes —
six of them destroying or misreporting work — and closed all of them.

The previous version of this file said "a book-length run against the live API
is all that remains". That is stale twice over: there is no API any more, and
the run has still not happened.

## Where things actually stand

|                                                        |                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Read and published**                                 | _Clairvoyance and Occult Powers_ (328 leaves) — transcribed, proofed, annotated, formatted |
| **On the shelf, unread**                               | _The Human Aura_ (88 leaves), _The Astral World_ (102 leaves)                              |
| **Reading a leaf**                                     | `draft` → correct against pixels → `transcribe`, proven on 12 leaves across 3 books        |
| **Checks that exist and have never run at book scale** | the sense pass, adjudication, the ledger                                                   |
| **Checks that cannot run**                             | none                                                                                       |

The tooling is now better tested than the thing it serves. That is the argument
for everything below being ordered the way it is: **the next unit of work is a
book, not a feature.**

---

## Phase 0 — two faults that would corrupt a book mid-run

Neither is hypothetical. The first caused a real misfiling in the session that
found it.

### 0.1 The driver has three notions of "the current book"

`open` hands a scan to the app. `leaf`, `draft`, `ocr` and `sheet` render from
`loadSourceFile(listRuns()[newest].key)` — the stored scan of whatever run was
saved most recently. `transcribe` keys off the path on the command line.

So a session can open one book, read another's pixels, and file the result
under a third. That is not a description of a risk; it is what happened. Every
render, crop and draft for an afternoon came off the wrong scan, and nothing in
any report said so, because no verb names the book its pixels came from.

**Fix:** one notion of the current book, set explicitly and reported by every
verb that touches pixels. `leaf` and `sheet` should name the file and run they
cut from, in the result. A verb that cannot tell which book it means should
refuse rather than pick the newest.

### 0.2 `load` and `seed` delete before they save

Both call `deleteRun(key)` and then `saveRun`. The delete buys nothing —
`saveRun` does `put` on a keyed store, which replaces — and it converts "the
save failed, you still have yesterday's work" into "the save failed and there
is nothing left".

Worse, `transcribe` never pushes to the shelf; `save` is a separate verb. So a
session that lands eight batches and dies before `save` has all of them deleted
by the next session's opening `load`. Nothing warns, and `load`'s report
describes only the incoming book.

**Fix:** drop the `deleteRun` line. Report what the incoming book displaces —
leaves, edits, images — before overwriting it.

---

## Phase 1 — the editorial query channel

Invariant I10 in [`TRACE-draft-to-store.md`](./TRACE-draft-to-store.md), and the
only one still unmet.

The 1916 leaf prints `belleves`. Not OCR noise: at 600 DPI both strokes are
ascender height, against the x-height dotless `i` of `skeptical` in the same
line. The compositor set it wrong.

**The standing rule is that such a thing is transcribed as printed and raised
as a query for the editor** — never silently corrected, never silently kept.
Whether a reprint fixes a compositor's error, keeps it, or notes it is the
editor's call and nobody else's.

There is no channel for it. `uncertain` means "could not read", which is the
wrong semantics; `Attention` is keyed to a page and is about revisiting a leaf.
Today a query survives only by being mentioned in conversation, which is
exactly the kind of thing that gets lost. Worse, `parsePageTranscription`
silently drops any field it does not recognise, so an agent that does the right
thing and attaches one gets a green report and no record.

**Shape:** a query carries the block, the exact quote, what the paper says,
why it is being raised, and nothing else — no proposed fix, because the fix is
the editor's. It belongs on the shelf as a file a person can read, beside
`corrections.md`. The parser should refuse unknown fields so that silence
becomes impossible.

**Size:** small. One core type, one parser change, one shelf writer, one
section in the proof sheet.

---

## Phase 2 — read _The Human Aura_

88 leaves. This is the deliverable, and it is also the only way to exercise the
half of the pipeline that has never run.

It tests, by doing rather than by argument:

- **the batching** (SPEC's Stage 5) — one subagent per handful of leaves, each
  given the images, the draft and the previous batch's tail for the seam, each
  returning a batch and dying. The property that made the old vision pass safe
  was that it could not drift because it could not see far; this rebuilds it
  deliberately, and it has never been run;
- **the seam** — paragraphs crossing a leaf boundary, hyphens healed;
- **checkpointing** — a session that dies loses one batch, not a book;
- **the ledger** — findings raised, confirmed, refuted. A check nobody can
  score is worse than no check, because it manufactures confidence.

**Do it in three sittings, not one.** Leaves 0–29 first, then stop and look at
what the checks caught before committing to the rest. If the sense pass
proposes a hundred findings and sixty survive the pixels it is earning its
place; if fifteen survive it should be tightened or dropped, and that is worth
knowing after thirty leaves rather than after eighty-eight.

---

## Phase 3 — the checks, once there is a book to check

Only meaningful after Phase 2. In order:

1. `consistency` — free, deterministic, no adjudication needed.
2. The sense pass, one chapter to a chunk, output findings and never text.
3. Adjudication against the crop, the reader shown the crop **before** the
   hypothesis.
4. The sheet a person reads. Nothing reaches the book until then.
5. Score it. Keep the ledger per book.

---

## Phase 4 — the reading pass, promoted ahead of the next book

[`PLAN-reading.md`](./PLAN-reading.md), and it is now the next thing built,
before any further book is read.

The reason is measured rather than felt. _Clairvoyance and Occult Powers_
carries 23 footnotes across 328 leaves, and **22 of the 23 are hung on a proper
name** — Roentgen, Marconi, Crookes, the SPR, Kant, Leadbeater, Christian
Science. Individually good; as a set, a list of the things the annotator
already knew. What a reader stops at — an argument that does not follow, a term
used long before it is defined, an exercise that cannot be carried out as
written — is not a named entity, cannot be found by scanning for hooks, and got
no notes at all. The introduction has the same shape for the same reason: it is
written from evenly spaced extracts, which is a sampling of a book rather than
a reading of one.

So the deficiency is in the selection, and selection is the editor's. Reading
_The Human Aura_ before there is a way to record that reading would spend the
book and leave the defect in place.

---

## Phase 5 — the ledger, which is a habit and needs to be a check — **done**

**Three of eleven books on the shelf have a ledger.** _Clairvoyance_,
_Uncommon Therapy_, _The Human Aura_, both Hall collections, _Thought
Vibration_, the combined Panchadasi volume and _Patterns_ Vol. I were all
finished without one; the last of those got its ledger only when a later
session went looking for the book's score and found there was none.

**The instruction is not unclear.** It is stated three times — in `CLAUDE.md`
under how a book gets read, in `PROCESS-reading.md` at the sense pass, and as
its own numbered section, **§7 Keep the ledger**, in `HANDOFF.md`. A rule
written down three times and kept three times in eleven is not a comprehension
problem. This repository already has the diagnosis, in its own words: _"Two
things that are supposed to be standing rules turned out to be habits, and
habits skip."_

Four structural reasons, in the order they bite:

1. **Nothing checks it.** `HANDOFF.md` §8, _Before you stop_, lists five
   commands and the ledger is in none of them. `book-files.mjs --check` exists
   for precisely this failure — it compares `corrections.md`, `notes.md`,
   `glossary.md` and `introduction.md` against the book and exits non-zero on
   drift, on the stated grounds that such a thing _"belongs beside the tests
   rather than in somebody's memory"_. The ledger is the one derived file it
   does not cover.
2. **It lives in the wrong repository.** Ledgers are `docs/LEDGER-*.md` in the
   formatter checkout; the books are on the shelf. Every other per-book
   record — `corrections.md`, `queries.md`, `rulings.md`, `review.md`,
   `about.json` — sits in the book's own directory. The ledger is the only one
   that does not travel with its book, so finishing a book means remembering to
   commit to a second repository.
3. **It is written last, at the end of the longest job.** A book is read across
   several sessions, and the ledger falls at the point where a session is
   oldest and nearest its limit. The editor's own words for why the work is
   spread across chats — _"to avoid confusing you or running out of my context
   window"_ — are exactly the condition under which a final, unchecked,
   cross-repository step gets skipped.
4. **There is no template and nothing derives it.** `corrections.md` has
   `correctionRows`, a pure module that rebuilds it from the book; the ledger
   is written by hand from the memory of a conversation. This file already
   records what that costs: _"They were built by a script in one session's
   scratchpad, so the first session to end took the only thing that could
   rewrite them."_ The reading section of Patterns Vol. I's ledger is blank
   for that reason and says so.

What to do, cheapest first:

- **Move the ledger into the book's directory** as `books/<slug>/ledger.md`,
  and migrate the three that exist. It then travels with the book it scores and
  is committed by the same commit as everything else it describes.
- **Cover it in `book-files.mjs --check`.** Not the prose — the counts. Does a
  ledger exist; do its leaf count, correction count, note count, query count
  and page count match `book.json`. A ledger that is merely out of date is the
  common case and is exactly what a check catches.
- **Derive the derivable half.** The scan, the block kinds, the edit counts,
  the rulings tally, the export numbers and the check scores are all in the
  artefacts. Generate those sections the way `correctionRows` generates its
  entries, and leave the narrative — the reading, what the book cost the
  process — for a person, above the first generated heading, exactly as the
  other readable files keep the editor's own sentences.
- **Put it in `HANDOFF.md` §8**, so the last list a session reads names it.

The order matters and follows this repository's own rule about which fixes can
be relied on: a check that runs beats a file in the right place, which beats an
instruction written a fourth time.

### What building it found

**The shelf had already half-invented the fix, and the two halves had
drifted.** Two books kept a `ledger.md` in the book directory _and_ a
`docs/LEDGER-*.md` copy, and the copies were not the same file: the Isis
ledger was **986 lines on the shelf against 905 in `docs/`**, five days
staler, missing the whole section on the figures. So this was never a new
convention to introduce — it was one already winning, with a duplicate
quietly rotting beside it, which is the same disease one level up. The shelf
copies are kept and the `docs/` ones deleted.

**`--finish`, run across the shelf, found what nothing had been asked.** Ten
books, and only _Patterns_ Vol. II comes back finished:

- **88 queries across six books have never been ruled on** — 63 of them on
  _Isis_ Vol. I. Each is a decision the editor has not made and the book is
  carrying as printed, which may well be right, and none of them was visible.
- **Four books made corrections and have no `corrections.md`.**
- **Five books have a glossary whose marks nobody has checked.**

**`--shelf` answers the apparatus question.** _The Human Aura_ is complete
with no glossary and no front matter where _Clairvoyance_ — same author, same
series, same shelf — has both. That is the gap CLAUDE.md names in those words
and calls an unchecked habit, now a hole in a column.

**And one directory is not a book at all.** `ManlyPalmerHall-CollectedBooklets`
has no `book.json`, only `sources.md`, `notes-pending.md` and a `readings/`
folder. Nothing had ever said so.

Three faults were injected against the module and two of this file's own
lessons recurred while writing it: a fixture with one bare mark and one
highlight passed with the two counts swapped, and the front-matter check
matched the _word_ "introduction" — which every book on this shelf fails,
because all five call theirs "Before You Begin".

## Phase 6 — every book carries its shape, and the flow is generated — **done**

The editor's ask, in his words: _"we need a flowchart for the instructions
since not every book presented has the same components (scan, plus OCR,
etc)."_ The process was written for a scan and every other shape of book was
read by a session deciding, stage by stage, what still applied.

Built: `src/core/provenance` — `BookShape` (pixels; text layer `none`,
`converted` or `typeset`; a second digitisation; `measured` or `declared`,
with the evidence), `routeFor` (the stages that apply, each with its reason),
and `docs/FLOW.md`, whose table is generated from the code between markers a
test compares. `SavedRun` v19 carries the shape; recon, the EPUB opener and
the app record it at intake; `scripts/shape.mjs` measures a shelf under Node
with the browser's own coverage walk, moved to core; `book-files.mjs --finish`
owes a book with no shape; `drive.mjs crops` refuses a book with no pixels by
its shape.

Measured: ten books on the shelf, eight off their files, two declared (the
_Isis_ scan the shelf cannot hold; the Hall collection). Routes: five
`scan-with-layer`, two `scan`, three `converted-text`. Two things the
measurement corrected on the way: a text layer is decided by the majority of
sampled pages and not the mean (Google's boilerplate on one leaf of _Thought
Vibration_ made the mean say the book had one), and a scan's OCR layer is a
**second digitisation for free** — archive.org's reading, sharing no blind
spot with Tesseract — which is what Phase E's second reader compares against
first on five of these ten books.

## Phase 7 — standing rulings, pre-filled and held — **done**

The editor's decision, in two words: _"pre-filled and held"_. A query a
standing ruling's `covers` reach used to be settled silently — `answerFor`
returned the standing ruling, `outstanding` dropped the query, and it never
reached the gate or the sheet. Now it is **held**: it stays outstanding,
arrives at the gate with the ruling's decision filled in (`Question.held`,
which `defaultAnswers` ignores and a test holds it to), and is filed only when
a person approves it — the Accept button on the screen, the "Approve all N"
bar at the gate, or `drive.mjs held approve --yes`. Every filed ruling names
the standing ruling it came from in its reasoning.

Measured before building: of the 88 queries with no ruling on the shelf, **3**
fall under an existing standing ruling by its covered words — `centre` on
leaf 7 of _The Human Aura_ (twice, once in the combined volume) and
`practiced` on leaf 76 of _Isis_. Small, and the point was never the count:
those three were being reported settled by the app and unruled by the finish
check at the same time, which is two answers to one question. Both now say
held, `queries.md` lists the held ones apart with what each would be, the
review sheet marks them `held` rather than settled, and the ledger's Queries
row carries waiting and held counts matched by leaf and quote rather than
subtracted.

## Phase 8 — clean the page before Tesseract reads it — **done; `off` stays**

Built as `PLAN-page-cleanup.md` asked: `@core/image/cleanup` chooses ops
from the leaf's own tones (percentiles of its luminance histogram, so cream,
grey and foxed paper all land on the same white), `platform/browser/cleanup`
applies them on the **one read path** recon and `drive.mjs ocr … fresh` both
take, the cleaned pixels reach the engine and nothing else, no preset may
change the page's size, and the recon cache refuses a reading made under a
different preset exactly as it refuses a different DPI.

Then measured, on the ground-truth harness Phase A built: 42 leaves across
four books, chosen by rule and written down first, four presets, one render
and one read each, aligned against the proofed text. `off` 241 substantive
disagreements, `gentle` 239, `gentle+despeckle` 241, `binarise` 245 — noise,
and the rule's floor says so. The despeckle costs 2.5 seconds a leaf. The
ledger (`docs/LEDGER-page-cleanup.md`) carries the tables, the rule with its
floor, and the decision: **`off` stays**, and the reason the gain was never
there — the disagreements that remain on this shelf are columns read across,
a gutter shadow and an unmodelled face, none of which a levels curve reaches.

Next in the agreed order: E (the second reader).

## Deliberately not doing

- **More review of the draft module.** Four passes have now been run over it.
  The next fault will be found by a real page, not by a reader — that has been
  true every single time.
- **Widening the fixture set before there is a reason.** Twelve leaves across
  two typographic regimes found every fault so far. Add leaves when a book
  breaks, and add the leaf that broke.
- **A second renderer, still.** Unchanged and for the unchanged reason.
- **Tuning any threshold to make a page look better.** Every constant in
  `src/core/draft` now carries the distribution it was set from. Measure, record
  what the new value costs, or leave it.

---

## What the third book actually showed

_The Astral World_ is read, checked against two further witnesses, proofed and
on the shelf. The full ledger is on the shelf, at `books/SwamiPanchadasi-TheAstralWorld-1vbqzip/ledger.md`.
Phase 2 is therefore done for a book, and the one thing it turned up that no
amount of reading would have is worth repeating here:

**301 line-break hyphens printed mid-line, and every check passed.** `draftPage`
joins OCR lines with a space, so the compositor's `ad-` / `vanced` survives as
`ad- vanced`, and assembly's hyphen healing runs at page _seams_ only. Both OCR
engines break the lines in the same places, so no second reader disagreed; the
leaf read against its render looked right, because the paper breaks there too;
`consistency` was clean; the book was already pushed. The first rendered proof
showed it immediately.

`draftPage` now counts them and says so in `structural`, which is the most it
can honestly do — `counter-part` joins and `thought-transference` must not, and
nothing on the leaf settles which. Healing them needs a witness that sets the
same words with its line breaks elsewhere, which is what the typeset third
reading was for.

**So: proof a rendered page before believing the checks, not after.** That is
now true three times running.

## The standing lesson from the review

Written down because it held every single time, without exception:

**Every fault reasoned about was diagnosed wrongly. Every fault measured was
diagnosed correctly, first try.** The scramble was blamed on a tall box and was
a 1×3-pixel speck; the paragraph split was blamed on a corrupted line top and
was the indent rule; the folio threshold was set from taste at 6% and the real
distribution had two heads at 4%. Three separate times, in one day, on code
whose author had just written it.

Print the boxes.
