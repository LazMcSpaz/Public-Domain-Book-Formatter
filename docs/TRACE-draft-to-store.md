# One flow, traced through the code

**Pixels on a scanned leaf → a validated transcription in the run store.**

This is a worked example, not a survey. It follows a single call path hop by
hop and states, at each hop, what I assert the code does and why. Every
assertion is numbered and falsifiable.

**The reviewer's job is to open each named function and decide whether the
claim is true.** Where it is not, the claim is the bug — not the code — and
saying so is the finding.

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

- **C12.** A word joins the line whose vertical band it **overlaps most**, and
  only if that overlap covers at least `SHARED_BAND` (0.35) of the word's own
  height.
- **C13.** Every open line is considered, not just the most recent.
- **C14.** A line's band is the running **mean** of its words' edges, never
  their union — a union lets one tall word widen a line until it swallows the
  next.

**Why.** The first version clustered on distance from the _current_ line only.
Words arrive sorted by top edge, so a word sitting a few pixels low — a
quotation mark, a descender, a letter the scan thickened — fell outside the
tolerance and opened a line of its own, which the next line's words then
joined. The symptom was **the last word of every line appearing at the end of
the line below it**, silently reordering the page. `test/draft.test.ts` has the
regression.

**How to break it:** construct a page whose lines are close enough to overlap
across two real lines; construct a word taller than its line.

### Hop B3 — the measure

`measureOf` (~251)

- **C15.** The measure is the **median** left and right edge across lines, not
  the extreme. One line running into the gutter would otherwise widen the
  measure and stop every real indent from registering.

### Hop B4 — blocks

`draftPage` (~384), with `isCentred` (~257), `isIndented` (~273)

- **C16.** Three things break a block, and only three: a vertical gap wider
  than `PARAGRAPH_GAP` × the page's own median gap; a first-line indent; a
  change between centred and ranged-left.
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

- **C19.** A candidate must pass **all three** tests: set apart by
  `FURNITURE_GAP` × the median gap; shorter than `FURNITURE_WIDTH` (60%) of the
  measure; and **no taller than `DISPLAY_HEIGHT` (1.2) × the body**.
- **C20.** Height is measured on the line's **tallest** word, not its median,
  because a letterspaced display title comes back from OCR as a couple of real
  words and a row of dashes, and a dash has almost no height.
- **C21.** Every furniture decision, taken or declined, is reported in
  `structural` **with the two numbers it turned on**.

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
  runs first but is a **read**; the first write is `saveRun`, well after.
  _(Precise wording matters here: the in-code comment says "parsed before
  anything is touched", which is now slightly ahead of itself. Confirm the
  ordering rather than the comment.)_
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
