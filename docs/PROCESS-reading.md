# Reading a book: what should happen, how, and what comes out

The process a book goes through from a scan to a transcription that can be
proofed, annotated and printed — written down so it can be **run and audited by
someone who did not build it**.

For the **code-level** version of one of these stages — the same flow traced
hop by hop with a numbered, falsifiable claim at each one — see
[`TRACE-draft-to-store.md`](./TRACE-draft-to-store.md). That is the document to
review code against; this one is the process a person follows.

There is no API. Every reading step happens either in a browser the driver
holds open, or in a conversation. That changes what the safeguards have to
catch, and most of this document is about the safeguards rather than the steps.

---

## The one rule

**A model may propose a reading; only pixels may accept one.**

The line is drawn at the **artefact**, not at the activity. A reader without
the scan may say _"this does not cohere, and I would expect X"_ — that is a
**finding**, and it is allowed. It becomes an edit only after a reader **with
the crop** has said what the paper says, and that reader is shown the crop
**before** the hypothesis, because a model shown both confirms rather than
reads.

What must never exist is a step whose **output is text** — a "clean this up"
pass that hands back prose instead of a list of places to look.

---

## Invariants

These are the claims worth attacking. Each is meant to be false-ifiable by
running something, and the reviewer should try to break every one.

| #   | Invariant                                                                                  | How to attack it                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | No step ever produces book text from an image alone.                                       | Find any path where a leaf's words are authored rather than corrected.                                                                           |
| I2  | `transcribe` is the only writer that **merges**; every other writer replaces, and says so. | `grep -rn 'saveRun(' src/ scripts/` — there are several. Confirm each is either the wizard's own path, a fixture seeder, or an explicit replace. |
| I3  | A batch that fails to parse changes nothing at all.                                        | Land a batch whose 2nd page is malformed; confirm page 1 did not land.                                                                           |
| I4  | A batch merges by `pageIndex`; it never replaces silently.                                 | Land two disjoint batches; confirm both survive.                                                                                                 |
| I5  | A batch lands in the run the app will actually open.                                       | Land after `open`; confirm `matchedRunBy` is not "starts a new run" when a run exists.                                                           |
| I6  | No report claims a check it did not perform.                                               | Land a leaf the recon cache has no words for; confirm `ocr` says NOT CHECKED.                                                                    |
| I7  | No report claims a book is finished when the leaf count was guessed.                       | Land with no scan stored and no app open; confirm `complete: false`.                                                                             |
| I8  | A draft is never mistaken for a transcription.                                             | Confirm every draft carries `structural`, and that nothing reads a draft file.                                                                   |
| I9  | Escalation is decided by measurement, never by a model's self-assessment.                  | Find any gate keyed on a model saying it felt unsure.                                                                                            |
| I10 | A suspected printer's error is neither silently fixed nor silently kept.                   | **Currently unmet — see Gaps.**                                                                                                                  |

---

## Stage 0 — Bring the scan in

```bash
node scripts/drive.mjs serve &                 # holds a browser on :7788
node scripts/drive.mjs open <path/to/scan.pdf> # or: load <book.json> <scan.pdf>
node scripts/drive.mjs wait gate-identity
```

**What should happen.** The app renders the PDF, OCRs every leaf, harvests the
book's vocabulary, and stops at the identity gate.

**What to know.** `open` hands the scan to the app but does **not** store it;
only `load` stores it. That is why several verbs need the app to still be open.
The recon cache is written only when the user has agreed to keep book data on
the device, so its absence is ordinary rather than a failure.

**Result.** `state` reports `step: gate-identity` and the true `pageCount`.

---

## Stage 1 — Take the free reading first

This is the step that matters most, because it changes the job from _"read this
image and produce text"_ — the generative act, where invention lives — into
_"here is an image and here is a text, where do they differ"_.

A born-digital PDF has its own words read straight out of it (`looksScanned`
decides, structurally: does one image cover the page?). A scan goes through
Tesseract. Either way the words arrive with confidences and boxes.

**Result.** `drive.mjs ocr <n>` returns what was read, as plain text.

---

## Stage 2 — Draft the leaf from the geometry

```bash
node scripts/drive.mjs draft batch.json 12 13 14
```

**What should happen.** `src/core/draft` (pure, 18 tests) turns a bag of boxed
words into a page of blocks. The characters come off the pixels; what the
module adds is the geometry OCR measured and was throwing away:

- words gathered onto lines by **vertical band overlap**, against every open
  line rather than only the current one;
- lines broken into blocks at a wide gap, a first-line indent, or a change
  between centred and ranged-left;
- a centred line called a heading only if it is **also substantially shorter
  than the measure**;
- a short, detached, **body-sized** line at the head or foot taken as a running
  head or folio — size is what separates a running head from a display title;
- consecutive low-confidence words gathered into `uncertain` spans.

**Result.** A JSON array in the exact shape `transcribe` takes, plus per-leaf:

- `role` — a guess, and the field most likely to be wrong;
- `structural` — **what was guessed rather than measured**, in plain language,
  including the measurement behind every furniture decision. This is the
  reading order for Stage 3, not a warning list to clear.

**Nothing believes a draft.** It is not saved anywhere, nothing downstream
reads a draft file, and the only way its contents reach the store is by being
corrected and passed to `transcribe`.

---

## Stage 3 — Correct the draft against the pixels

Never type a leaf out from the render. Open the leaf, compare, and change only
what differs.

```bash
node scripts/drive.mjs leaf 12                                  # whole leaf
node scripts/drive.mjs leaf 12 band 500 0.06,0.28,0.90,0.13     # a band, at any DPI
node scripts/drive.mjs sheet doubts 12:belleves 12:Soclety      # word crops
```

**Order of work:** `structural` first, then `uncertain`, then a read-through.

**What good practice looks like, from the first real leaf:**

- Reading a leaf in **horizontal bands at 500 DPI** is cheaper and more
  reliable than cropping word by word.
- In a worn scan, **i-dots are worthless as evidence and stroke height is
  decisive**: a dotless `i` is x-height, an `l` is ascender height. Establish
  the discriminator on a word you are sure of before trusting it on one you
  are not.
- A hyphen at a line break is not always a line-break hyphen: `counter-part`
  heals to `counterpart`, but `thought-transference` keeps its hyphen. Where
  the page cannot settle it, say so in `uncertain` rather than choosing.
- The book's own spelling and pointing are promised to the reader untouched.

**Result.** A batch where every page carries `pageIndex`, a `role`, `blocks`,
`uncertain` and `furniture`.

---

## Stage 4 — Land the batch

```bash
node scripts/drive.mjs transcribe <scan.pdf> batch.json [merge|replace]
```

**What should happen.**

1. Every page is validated through `parsePageTranscription` — the app's own
   parser. A page that will not parse **fails the whole call**.
2. `pageIndex` is required on every page. Position in the array is not it.
3. The run is found with `findRunForFile` — exact key first, then name and
   size, because the timestamp moves for reasons that have nothing to do with
   the book.
4. Pages are merged by `pageIndex`. `replace` is opt-in and explicit.
5. Each landed leaf is cross-checked against the **cached OCR** with
   `verifyPage`. OCR is not a language model, so it has no shared blind spots
   with whoever wrote the batch. Reported, not enforced.

**Result** — every field is meant to be literally true:

| Field                           | Meaning                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `landed`                        | pages in this batch                                                              |
| `transcribed`                   | pages in the run afterwards                                                      |
| `pageCount` / `pageCountFrom`   | the leaf count and where it came from; says "this is a floor" when nothing knows |
| `complete`                      | never true when the leaf count was guessed                                       |
| `stillMissing` / `firstMissing` | leaves not yet read                                                              |
| `matchedRunBy`                  | how the run was found, or that a new one was started                             |
| `ocr`                           | names how many leaves were **actually** compared                                 |
| `flagged`                       | per-leaf OCR disagreements                                                       |

Housekeeping: `runs` lists readings held on the device, `runs drop <n>` removes
one. A stray run is not harmless — it is what `listRuns()` hands back as the
newest, which is how every other verb finds the book.

---

## Stage 5 — Scale it across a book

A conversation that has read three hundred pages of one author is the exact
condition under which fluent invention appears. The vision pass was safe
because it saw one leaf at a time and **could not drift, because it could not
see far**. That property is rebuilt on purpose:

- **Triage deterministically.** OCR confidences are real probabilities and
  `assessText` measures damage. Clean leaves keep their OCR draft; damaged or
  structurally ambiguous ones get eyes.
- **One subagent per handful of leaves**, given the images, the draft, and the
  tail of the previous batch for the seam. It returns a batch and dies. The
  parent never holds a page image.
- **Checkpoint every batch.** A session that dies loses one batch, not a book.

---

## Stage 6 — Check the book against itself, for free

```bash
node scripts/drive.mjs consistency out.json
```

`checkConsistency` (pure, deterministic, no spend) finds: a name spelled two
ways, a doubled word or line, a quotation that never closes, a cross-reference
to a chapter that is not there.

Nothing here proposes a reading, so nothing needs adjudicating — only looking.

**Tuning is measured, not felt.** The name-variant check at an edit distance of
2 produced 17 findings of which 1 was real; at 1 edit with a prefix exemption
it produced 3, all real. The cost — `Baillie`/`Bailly` will never be caught —
is recorded in a test rather than forgotten.

---

## Stage 7 — Read for sense

```bash
node scripts/drive.mjs chunks out.json     # one chunk per chapter, plus a register
```

The one check with **meaning** available. `a fate that could move mountains` is
two real words either side of one wrong one, both scanning, both what OCR saw,
and nothing mechanical will ever catch it.

- One **chapter** per chunk, because coherence is what is being tested and a
  chapter is a thing that coheres.
- Every reader is given the book's own established vocabulary, or each meets
  "Panchadasi" and "akasha" cold and files them as incoherent.
- The editor's own written sections are excluded — there is no crop behind them.
- Output is **findings, never text**. A finding is `blockId`, an exact `quote`,
  a `kind` from a closed list, a `why`, and an `expected` **marked as a
  hypothesis**. There is deliberately no `style`, `spelling` or `punctuation`
  kind.
- A quote that is not in its block comes back **unplaced** rather than attached
  at a guess.

---

## Stage 8 — Adjudicate every finding against the crop

```bash
node scripts/drive.mjs crops findings.json    # cuts a crop per finding
node scripts/drive.mjs review findings.json verdicts.json
```

The adjudicating reader is shown **the crop and not the hypothesis**. `Verdict`
has no field for it and the crop manifest does not carry one.

`settle()` builds the correction from the **verdict** and never from
`expected`. That is the whole safeguard, expressed as code rather than as an
instruction, because an instruction is a thing a tired session skips.

Three outcomes: `corrected` (the paper says something else), `as-printed` (a
true detection with nothing to change — not a false positive), `unreadable`.

**Keep the ledger.** `scoreSense` reports raised, unplaced, unreadable,
as-printed, corrected, and how often the hypothesis happened to be right. If
sixty findings in a hundred survive the pixels the pass is earning its place;
if fifteen do it is noise and should be tightened or dropped. A check nobody
can score is worse than no check, because it manufactures confidence.

---

## Stage 9 — A person decides

The verdicts are **a sheet to read, not a queue to approve**. Nothing reaches
the book until the editor has looked, and the sheet is built so that looking is
cheap: the crop, what the paper says, what was proposed, and what the
deterministic checks made of it, in one place.

---

## Editorial queries — the standing rule

Some things are neither transcription errors nor findings: they are **decisions
that belong to the editor**.

The case that raised this: the 1916 leaf prints `belleves`. Not OCR noise — at
600 DPI both strokes are ascender height, against the x-height dotless `i` of
`skeptical` in the same line. The compositor set it wrong.

**The rule.** Transcribe it as printed, and **raise it as a query**. Never
silently correct it; never silently keep it. Whether a reprint keeps a
compositor's error, fixes it, or notes it is the editor's call and nobody
else's.

Queries a reader should raise: a printer's error; a word the page genuinely
cannot settle; an inconsistency the book itself contains; anything where
"faithful to the original" and "correct" disagree.

---

## Known gaps — read this before reviewing

0. **`load` replaces rather than merges, and deletes first.** `drive.mjs load`
   calls `deleteRun(key)` before writing the shelf's copy, as does `seed`. If
   the device holds work the book file does not, loading discards it silently.
   This has not been tested against a divergent pair and should be.
1. **There is no channel for an editorial query.** This is invariant I10 and it
   is currently unmet. `uncertain` means "could not read", which is the wrong
   semantics; `Attention` is keyed to a page and is about revisiting a leaf,
   not about a decision with a crop and a reading attached. Today a query
   survives only by being mentioned in conversation, which is exactly the kind
   of thing that gets lost. **The right shape is probably a file on the shelf a
   person can read**, keyed to block and quote.
2. **`draft` handles single-column matter only.** Two columns come back
   interleaved. It does not detect this and should.
3. **A leaf OCR barely read produces a poor draft and says so only indirectly**
   — through `uncertain` and low word counts. There is no explicit "this leaf
   needs eyes, not a draft" signal, which is what Stage 5's triage needs.
4. **`transcribe` sets `usage: 0` and `modelId: 'in-session'`.** Honest — no
   API was called — but it means the run carries no record of how a leaf was
   read.
5. **Stage 5 has not been run at book scale.** Everything above Stage 4 is
   proven on one real leaf and on fixtures. The batching, seam handling and
   checkpointing are designed but not exercised over hundreds of leaves.
6. **The recon cache is often absent** (it needs the keep-data answer), so
   verbs fall back to reading leaves afresh. Check that every fallback says
   which reading it used.

---

## What has actually been demonstrated

| Claim                                            | Evidence                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| A leaf can be drafted from cached OCR            | leaf 6 of the aura scan: 498 words → 15 blocks, 14 uncertain spans                                    |
| The draft's structure matches the page           | LESSON / title / description / folio came out in order and matched the synopsis parser's expectations |
| A malformed batch changes nothing                | batch with a missing `pageIndex` refused whole, naming the page                                       |
| Batches merge                                    | leaves 0,1 then leaf 5 → `transcribed` 2 → 3, `stillMissing` 7 → 6                                    |
| `replace` replaces                               | same batch in replace mode → `transcribed` 1, `stillMissing` 8                                        |
| A landed leaf persists and re-lands idempotently | re-landing leaf 6 → `matchedRunBy: "name, size and date"`, `transcribed` stays 1                      |
| The OCR cross-check runs                         | leaf 6: `checked against the cached reading, all 1 leaf(s)`, `flagged: []`                            |
| The pixels overrule sense                        | `belleves` confirmed against `skeptical` at 600 DPI                                                   |
| The suite is green                               | 1340 tests, 51 files; typecheck, lint and format clean                                                |

**Not demonstrated:** Stages 5–9 end to end on a real book; the fact bank and
annotation paths under the no-API model; anything at book scale.

---

## Brief for a reviewing agent

Do not take this document's word for anything. Specifically:

1. **Attack the invariants table.** Each row names an attack. Report which hold
   and which do not, with the command and the output.
2. **Re-run the demonstrated claims.** They were run on this machine; confirm
   they reproduce from a clean start (`runs drop` any stray runs first).
3. **Probe the other run writers.** `transcribe` is not the only one, and I
   stated that it was before checking. `App.tsx` writes runs — that is the
   wizard's own path and must keep working. `drive.mjs seed` writes a fixture.
   `drive.mjs load` writes a book file from the shelf and **calls `deleteRun`
   first**. Work out whether `load` can destroy device-side work the shelf copy
   does not have, and if it can, say so plainly.
4. **Read `src/core/draft/index.ts` adversarially.** It is the newest code
   here — written in a single sitting — and it had three geometric bugs that
   appeared only when a real page went through it. Tests built from synthetic
   boxes will not find the fourth; run it over leaves from a real scan.
5. **Check every report for a claim it cannot support.** Three of the four bugs
   found in `transcribe` were of exactly one kind: a field that said a check
   had happened, or that a book was finished, when neither was true. That is
   the failure mode of this codebase.
6. **Do not tune a threshold to make something pass.** If a check is noisy,
   measure it, record the cost in a test, and say what it now misses.
