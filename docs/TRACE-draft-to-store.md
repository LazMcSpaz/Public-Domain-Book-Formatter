# One flow, traced through the code

**Pixels on a scanned leaf → a validated transcription in the run store.**

This is a worked example, not a survey. It follows a single call path hop by
hop and states, at each hop, what I assert the code does and why. Every
assertion is numbered and falsifiable.

**The reviewer's job is to open each named function and decide whether the
claim is true.** Where it is not, the claim is the bug — not the code — and
saying so is the finding.

**The claim list is a floor, not a ceiling.** It was written by the person who
wrote the code, which means it is shaped by the same blind spots — this
repository's own rule is that the writer is the one party who cannot judge
their own work, and that is exactly why an outside reviewer is worth having.
Behaviour I did not think to claim is the most valuable thing you can find.
Forty-eight claims all holding is _not_ a passing grade on its own; it means
the stated intent is met, and says nothing about intent I failed to state.

Line numbers are hints and will drift; the function names are the anchors.

---

## Why this flow

It is the newest code in the repository, it is the only path by which
conversation-produced text reaches a book, and it is where three geometric
bugs and three false-report bugs were found in a single sitting — all of them
invisible to the test suite, all of them found only by running a real page
through. That makes it the flow most likely to still be wrong.

---

## The map

```
scan.pdf
   │
   │  Stage A — the free reading
   ├─► recon (browser)  ──► OcrWord[]  { text, confidence, bbox, pageIndex }
   │                            │
   │                            ├─► recon-cache (IndexedDB), if the user allows it
   │                            │
   │  Stage B — geometry
   │   drive.mjs draft ─────────┴─► core/draft draftPage() ──► DraftPage
   │                                                             │
   │                                                    batch.json (on disk)
   │  Stage C — the pixels decide                                │
   │   drive.mjs leaf / sheet ──► crops ──► a human or agent corrects the text
   │                                                             │
   │  Stage D — the only merging door                            ▼
   └─► drive.mjs transcribe ──► parsePageTranscription ──► findRunForFile
                                                          ──► merge by pageIndex
                                                          ──► createSavedRun
                                                          ──► saveRun (IndexedDB)
                                                          ──► verifyPage (report only)
```

---

## Stage A — the free reading

### Hop A1 — recon produces boxed words

`src/platform/browser/recon.ts`, and `ocr.ts` for the engine.

**In:** a PDF and a DPI (`RECON_DPI`).
**Out:** `OcrWord[]` — `{ id, text, confidence, bbox, pageIndex }`.

- **C1.** `confidence` is Tesseract's own per-word score, 0–100, and is a real
  probability — not a model's opinion of itself. SPEC §4 depends on this
  distinction holding everywhere downstream.
- **C2.** One page is rendered, consumed and released at a time. A 300-DPI page
  is ~19 MB of pixels; a book held at once would be gigabytes.
- **C3.** A born-digital PDF skips Tesseract entirely — its own text is read out
  and shaped as `OcrWord` with `confidence: 100`, so everything downstream works
  unchanged. `looksScanned` decides this **structurally** (does one image cover
  the page?), never by measuring word quality.

**How to break it:** find a path that accumulates page canvases; find a caller
that treats `confidence` as anything other than an engine probability; find a
place where `looksScanned` is bypassed by a file-extension check.

### Hop A2 — the cache, and when it must refuse

`src/platform/browser/recon-cache.ts` → `loadReconCache` (~139)
`src/core/project/recon-cache.ts` → `reconCacheUsable` (~92)

- **C4.** A cached reading is refused when the DPI differs, because a different
  DPI puts every word box, crop and illustration region somewhere else.
- **C5.** A cached reading is refused when it is a **partial** reading handed
  back as a whole book — otherwise a book is silently missing its second half.
- **C6.** A refused record is _deleted_ rather than kept, **except** when it is
  still usable as a resume checkpoint.
- **C7.** The cache holds `Blob`s, not object URLs. A `blob:` URL names data in
  a tab that has since closed.
- **C8.** The cache is written **only** when the user has agreed to keep book
  data on this device, so its absence is ordinary and must never be reported as
  a failure.

**How to break it:** call `loadReconCache` with a different DPI and see whether
anything is returned; check whether a checkpoint survives a refusal.

---

## Stage B — geometry, which is the whole of the draft

### Hop B1 — the driver picks the words

`scripts/drive.mjs` → `draft` (~1454)

- **C9.** The cache is tried first; if absent, the leaves are read again **at
  the same `RECON_DPI`**. A draft read at a different DPI would put every box
  somewhere other than the crops its corrections are checked against.
- **C10.** The report says **which** reading was used (`read:`), because a
  fallback that does not announce itself is indistinguishable from a cache hit.
- **C11.** The book is found via `listRuns()` sorted by `savedAt`, newest
  first. **This is a weakness worth attacking:** it means any stray run shadows
  the real one. `runs drop <n>` exists because of it.

### Hop B2 — words onto lines

`src/core/draft/index.ts` → `toLines` (~177)

- **C12.** A word joins the line whose **nearest word in x** it agrees with in
  height, within `SAME_LINE` (0.6) of the body.
- **C13.** Every open line is considered, not just the most recent.
- **C14.** An **oversize** word — taller than `OVERSIZE` (1.8) times the body —
  neither recruits other words nor opens a line of its own. It is placed on the
  line it physically covers most, after the lines are built.

**Why local, and why in x.** Scans are skewed. On leaf 6 of the 328-page book
one line's word centres drift from **902 to 934** across the measure — 32
pixels against a 35-pixel body — so that line's last word sits nearer the _next_
line's first word than its own line's first word. Every rule built on a
whole-line average tears such a page apart and reassembles it wrong. Words
adjacent in x share a baseline whatever the slope, so a local comparison needs
no angle estimated and no line fitted.

**Why oversize words are placed last.** They are neither ordinary words nor
lines. The `=` on `astral-world` leaf 6 is the `E` of `EVERY` as a three-line
drop capital, 244 pixels against a 62-pixel body; the `:` on `tight-scramble`
leaf 7 is the `d` of `beyond` in a box 3 pixels wide and **1 pixel tall**.
Letting either open a band put its text mid-sentence, because a band centred
between two lines sorts between them.

**How to break it:** a page skewed the other way; a two-line drop capital; a
marginal note; a superscript footnote marker; a table where columns are far
apart in x.

### Hop B3 — the measure

`measureOf` (~251)

- **C15.** The measure is the **median** left and right edge across lines, not
  the extreme. One line running into the gutter would otherwise widen the
  measure and stop every real indent from registering.

### Hop B4 — blocks

`draftPage` (~384), with `isCentred` (~257), `isIndented` (~273)

- **C16.** Three things break a block, and only three: a **baseline-to-baseline**
  stride wider than `PARAGRAPH_GAP` (1.5) × the page's own; a first-line indent;
  a change between centred and ranged-left. Measured top-to-top, never
  bottom-to-top: on a tightly-set face the space between one line's bottom and
  the next line's top is **negative** — −18 and −6 pixels on two real leaves,
  because the boxes overlap — so a threshold built from it fires on every line.
  That shattered four paragraphs into thirteen blocks.
- **C17.** There is deliberately **no** "the previous line ended short" rule. It
  is right about most paragraph ends and wrong about every sentence finishing
  near the margin, and a wrongly _split_ paragraph is harder to see in a diff
  than a wrongly _joined_ one.
- **C18.** A centred line needs equal insets **and** `CENTRED_SLACK_TOTAL` (15%)
  of real slack. Equal insets alone are not enough: an indented first line that
  breaks a word early is inset on both sides to the pixel, and an earlier
  version called exactly that a heading.

### Hop B5 — furniture, and the rule that saves a title

`takeFurniture` (~286)

- **C19.** A **bare number set off at the margin** — `FOLIO_GAP`, 6% of the
  measure of white space before it — is decisive: the head beside it is
  furniture whatever its width or its size.
- **C20.** Failing that, a candidate must be set apart, short, made mostly of
  letters and digits, and no taller than `DISPLAY_HEIGHT` (1.35) times the body.
- **C21.** A line reading `LESSON XIII.` is a chapter's number, never a running
  head. At the **foot** of a leaf only a folio is taken — `FINIS.` is a
  colophon and belongs in the text.
- **C21a.** Every furniture decision speaks in `structural`, **taken or
  declined**, with the numbers it turned on.

**Measured:** the first version of this took four lines across twelve leaves
and every one was wrong, while capturing **0 of 9** real running heads — so the
original edition's folio went into the body text on every leaf. It is now 9 of
9, with the folio split off, and the four wrong takes all declined by name.
`test/draft-real.test.ts` pins each one, and checks the folios run in step with
the leaves: within a book, folio minus leaf index is a constant, which one
misread folio breaks.

**Why.** A running head and a page's display heading sit in the same place —
alone at the top, short, white space beneath — so position cannot separate
them. Size can. Without C19 the contents leaf lost `SYNOPSIS OF THE LESSONS` to
`furniture.runningHead`, taking the leaf's own title off the page.

**Known limit, stated rather than hidden:** on the real leaf this rule did
_not_ fire, because Tesseract failed to read the display title at all and
caught only the rule beneath it (25px against a 35px body). The rule is sound;
the input was junk. **The draft cannot tell you about type it never read**, and
that is the strongest argument for Stage C existing.

### Hop B6 — role and uncertainty

`guessRole` (~337), `uncertainSpans` (~349)

- **C22.** `role` is guessed from the words alone and is the field most likely
  to be wrong. It cannot see that a leaf is a plate or the second leaf of a
  three-leaf contents.
- **C23.** Consecutive words below `uncertainBelow` (60) become **one** span,
  with the confidence range in the reason.
- **C24.** `structural` always ends by saying the role and every block kind is a
  guess. A draft must never be mistakable for a transcription.

### Hop B7 — the file

`drive.mjs draft`, tail

- **C25.** The file written is exactly the array `transcribe` takes, with
  `structural` **kept beside each page rather than stripped** — a draft handed
  on without it looks exactly like a checked transcription.
- **C26.** Nothing reads a draft file. It is not saved to the store, and its
  contents reach the book only by being corrected and passed to `transcribe`.

**How to break C26:** `grep` for any other reader of a draft's output shape.

---

## Stage C — the pixels decide

`drive.mjs leaf` (~624), `sheet` (~1557)

- **C27.** `leaf <n> <name> <dpi> <x,y,w,h>` takes the crop as **fractions**, so
  the same crop survives a change of resolution.
- **C28.** `sheet` cuts each named word from the leaf it sits on, using the OCR
  box, so evidence is the pixels and never a re-render of the text.
- **C29.** No step in this stage writes anything. Correction is a human or
  agent editing the batch file.

**The method, which is a claim about practice rather than code:** in a worn
scan, i-dots are unreliable and **stroke height is decisive** — a dotless `i`
is x-height, an `l` is ascender height. Establish the discriminator on a word
you are certain of before trusting it on one you are not. This is how the
1916 leaf was shown to genuinely print `belleves`.

- **C30.** A suspected compositor's error is transcribed **as printed** and
  raised as a query for the editor. Never silently corrected; never silently
  kept. **There is no code channel for this today** — see the gap below.

---

## Stage D — the only merging door

`scripts/drive.mjs` → `transcribe` (~868)

### Hop D1 — validate before writing

- **C31.** Every page goes through `parsePageTranscription`, the app's own
  parser — the same one the API path used. A page that will not parse throws,
  and **the whole call fails**.
- **C32.** No write to the store happens before the parse. `findRunForFile`
  runs first but is a **read**; the first write is `saveRun`, well after. The
  whole batch is understood before a single page of it lands, because a
  partly-understood transcription looks exactly like a whole one and prints
  with holes in it. **Verify the ordering in the code, not the comment beside
  it** — that comment was wrong once already.
- **C33.** `pageIndex` is required on every page and is never taken from array
  position. A batch must be able to say which leaves it read.

### Hop D2 — find the right run

`src/platform/browser/run-store.ts` → `findRunForFile` (~214)

- **C34.** Exact key (`name\0size\0lastModified`) first, then **name and size**,
  because the timestamp moves for reasons that have nothing to do with the book
  — a re-download, a restore, a sync between devices.
- **C35.** Name _and_ size together, never name alone: two scans of the same
  title share a name constantly.
- **C36.** The batch is saved under the key it was **found** under, not the one
  computed. Otherwise it lands in a run nothing will ever open — no error, no
  book, and a session that believes it filed a leaf. **This was a real bug.**
- **C37.** `matchedRunBy` reports which of the three cases occurred.

### Hop D3 — merge

- **C38.** Pages are merged into a `Map` keyed by `pageIndex`, then sorted. A
  batch covering leaves 40–47 leaves the other three hundred alone.
- **C39.** `replace` is opt-in, explicit, and named in the command line.
- **C40.** Everything else on the run — `edits`, `failures`, `identityAnswers`,
  `adjudicated`, `facts` — is carried across unchanged.

### Hop D4 — say true things about the result

- **C41.** `pageCount` is taken, in order, from: the held run; the stored scan;
  **the book open in the app**; and only then a floor derived from the highest
  leaf read.
- **C42.** `pageCountFrom` names which. When it is the floor, it says so in
  those words.
- **C43.** `complete` is **never** true when the count was guessed. Taking the
  count from the batches made `stillMissing: 0` and `complete: true` come out
  of a book barely started — the one wrong answer here, because it is the
  answer that stops anybody looking. **This was a real bug.**
- **C44.** `usage` is zero and `modelId` is `in-session`, because no API was
  called. Putting a number there nobody spent would be a lie in the book file.

### Hop D5 — the independent witness

`src/core/transcribe/verify.ts` → `verifyPage` (~83)

- **C45.** The transcription is compared against **cached OCR of the same
  leaf**. OCR is not a language model, so it has no shared blind spots with
  whoever wrote the batch. With the API gone it is the only independent witness
  left.
- **C46.** Findings are **reported, not enforced**. This is a place to look, not
  a gate.
- **C47.** Leaves the cache has no words for are counted **apart**, and `ocr`
  says how many were actually compared. Reporting "checked" over skipped leaves
  is worse than no check, because it stops anyone looking again. **This was a
  real bug.**
- **C48.** `checkableText` counts the running head and folio as transcribed —
  they are, in `furniture` — and `dispositionFor` exempts leaves mined for
  metadata or discarded. Without both, a title page reports its whole imprint
  as missing.

---

## The claims, as a checklist

| Hop          | Claims  | Where                                                            |
| ------------ | ------- | ---------------------------------------------------------------- |
| A1 recon     | C1–C3   | `platform/browser/recon.ts`, `ocr.ts`                            |
| A2 cache     | C4–C8   | `platform/browser/recon-cache.ts`, `core/project/recon-cache.ts` |
| B1 driver    | C9–C11  | `scripts/drive.mjs` `draft`                                      |
| B2 lines     | C12–C14 | `core/draft` `toLines`                                           |
| B3 measure   | C15     | `core/draft` `measureOf`                                         |
| B4 blocks    | C16–C18 | `core/draft` `draftPage`, `isCentred`                            |
| B5 furniture | C19–C21 | `core/draft` `takeFurniture`                                     |
| B6 role      | C22–C24 | `core/draft` `guessRole`, `uncertainSpans`                       |
| B7 file      | C25–C26 | `scripts/drive.mjs` `draft`                                      |
| C pixels     | C27–C30 | `scripts/drive.mjs` `leaf`, `sheet`                              |
| D1 validate  | C31–C33 | `scripts/drive.mjs` `transcribe`                                 |
| D2 find run  | C34–C37 | `platform/browser/run-store.ts` `findRunForFile`                 |
| D3 merge     | C38–C40 | `scripts/drive.mjs` `transcribe`                                 |
| D4 report    | C41–C44 | `scripts/drive.mjs` `transcribe`                                 |
| D5 verify    | C45–C48 | `core/transcribe/verify.ts` `verifyPage`                         |

---

## What I already know is wrong or missing

Stated up front so the reviewer spends their time on the unknown.

1. **C30 has no implementation.** There is no channel for an editorial query.
   `uncertain` means "could not read"; `Attention` is keyed to a page and is
   about revisiting a leaf. A query survives today only by being mentioned in
   conversation.
2. **`load` and `seed` call `deleteRun` before saving.** They replace. If the
   device holds work the shelf's book file does not, loading discards it
   silently. Untested against a divergent pair.
3. **`draft` handles single-column matter only.** Two columns come back
   interleaved and nothing detects it.
4. **C11 is a design weakness, not just a note.** "Newest run wins" is how
   every driver verb finds the book.
5. **Nothing has been run at book scale.** Stage B and D are proven on one real
   leaf and on fixtures.

---

## How to review this

1. **Take the claims in order and mark each: holds / fails / cannot tell.** A
   claim you cannot decide from the code is itself a finding — it means the
   code does not make its own intent legible.
2. **Prefer running to reading** where a claim is executable. Several are one
   command.
3. **Attack B2 and B5 with real pixels, not fixtures.** Every geometric bug
   here so far appeared only when a real page went through; synthetic-box tests
   found none of them. Use a scan other than the two in
   `~/public-domain-books-storage/scans/`.
4. **Assume every report field is lying until checked.** Three of the four bugs
   in Stage D were of exactly one kind: a field claiming a check had happened,
   or a book was finished, when neither was true. That is this codebase's
   characteristic failure.
5. **Do not tune a constant to make something pass.** If a threshold is wrong,
   measure it, record the cost in a test, and state what it now misses.
6. **Report claims that are true but useless** — a check that cannot fail is
   not a check.
