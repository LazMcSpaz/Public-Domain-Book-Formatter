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
on the shelf. The full ledger is in [`LEDGER-astral-world.md`](./LEDGER-astral-world.md).
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
