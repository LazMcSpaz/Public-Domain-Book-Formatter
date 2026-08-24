# Handoff: reading _The Astral World_ with this tool

You are picking up a shelf of Swami Panchadasi reprints. Two are done —
_The Human Aura_ (88 leaves) and _Clairvoyance and Occult Powers_ (328) —
and the third, **The Astral World: Its Scenes, Dwellers, and Phenomena**,
102 leaves, is waiting on the shelf as
`scans/7d09b24cd35b37b8f0aac52463086b8a49a1f64ec1ad879858901194e77f519c.pdf`.

Read `CLAUDE.md` first; it is the design and it is not decoration. This
document is the part that is only learnable by having done it, written after
reading two books through.

---

## 1. Get oriented before you touch anything

```bash
node scripts/drive.mjs serve &          # holds a browser open on :7788
node scripts/drive.mjs book             # what is stored here, and which is current
node scripts/drive.mjs book <file.pdf>  # make one current — do this FIRST, always
```

**Every verb resolves "the current book" through one place.** If you skip
`book <file>`, a verb either refuses (good) or, historically, silently
worked on the wrong scan for an afternoon (bad — it happened). The current
book now lives in `localStorage`, so it survives a browser restart; if a
verb says _"more than one book is stored here and none is current"_, that is
not a book you never chose, it is one that got lost. Just set it again.

The shelf is a **separate repository**, `LazMcSpaz/Public-Domain-Books-Storage`.
Attach it with `list_repos` then `add_repo` — it may already be attached, so
check `/home/user/public-domain-books-storage` before assuming you cannot
reach it. **The browser's IndexedDB is a cache of the shelf, not the
record.** This container gets reclaimed. Work that only exists locally is
work you are about to lose.

---

## 2. The one rule everything else serves

**A model may propose a reading; only pixels may accept one.**

Concretely: never type a leaf out from the render. A reader producing text
from an image alone has nothing to be wrong against, and it will produce
fluent, confident, partly-invented prose that no downstream check can catch.

The shape that _is_ safe is _"here is an image and here is a text, where do
they differ"_. So:

```bash
node scripts/drive.mjs draft b.json 12 13 14   # OCR + geometry, free, not trusted
node scripts/drive.mjs leaf 12 out 300         # look at the actual leaf
node scripts/drive.mjs transcribe - b.json     # land the corrected batch
```

`draft` carries a `structural` list of what it _guessed_ rather than
measured. That is the order to check things in.

---

## 3. Getting a second reader, which is most of the value

The single highest-leverage thing available. Two independent readings of the
same setting, compared, turn "check every word of 102 leaves" into "check
the thirty places two readers could not agree".

```bash
node scripts/drive.mjs ocr $(seq 0 101) fresh > /tmp/tess.json   # Tesseract, off the pixels
node scripts/drive.mjs witness second.json out.json --ours ours.json
```

**Where to get the second reader:**

- **Project Gutenberg**, if the title is there. _The Astral World_ very
  likely is. **This container's proxy denies gutenberg.org** — you cannot
  fetch it. Ask the user to upload the HTML; they have done it twice and it
  takes them a minute.
- If the Gutenberg file has `class="pagenum"` anchors, `scripts/gutenberg-blocks.mjs`
  splits it by leaf exactly. _The Human Aura_'s did. _Clairvoyance_'s (an
  older ebook, 12480) did **not**, and had to be aligned to our leaves by
  fingerprint — see `align-gutenberg.mjs` in the session scratchpad for the
  approach. Check which you have before planning.
- Failing that, **Tesseract against the model pass is already two readers**
  and needs nobody's permission.

**Measured, so you know what to expect.** On _Clairvoyance_, our own two
readers caught about **half** of what a third human-proofread transcription
revealed; with the `stray-spelling` check added, about **61%**. Gutenberg is
worth having and is not the difference between safe and unsafe.

---

## 4. What the checks actually catch, and what they miss

Run all of these. They cost nothing.

```bash
node scripts/drive.mjs consistency out.json pristine   # BEFORE corrections
node scripts/drive.mjs consistency out.json            # after, to confirm
node scripts/voice.mjs audit <book.json>               # the prose you wrote
```

**`consistency ... pristine` is the important one and the easy one to get
wrong.** Run over the _edited_ text it can only ever confirm work already
done. The whole point is to find what wants correcting.

| Check                             | Catches                                               | Blind to                                     |
| --------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `witness` (two readers)           | substitutions — `tlairvoyant`, `snbstance`            | anything both readers got wrong the same way |
| `stray-spelling`                  | dropped letters — `hundrds`, `developd`, `conciously` | substitutions; short books                   |
| `doubled-word` / `doubled-phrase` | seam damage, a line set twice                         | —                                            |
| `unclosed-quote`                  | a quotation never closed                              | —                                            |
| `auditProse`                      | hedging, dismissals, long dashes                      | **flatness** — needs a reader                |

Two things nothing mechanical sees, and both bit us:

- **Punctuation position and case.** `witness` lower-cases and strips
  punctuation before diffing. A missing full stop was found _by eye_. For
  the Aura I ran case-sensitive and punctuation-count passes separately;
  worth repeating.
- **Paragraph breaks.** `draft` over-segments badly — it reported ten
  paragraphs on a leaf that prints two. Do not trust its paragraph count.

---

## 5. Pitfalls that cost real time

**The scan is not always the leaf.** Some captures are placed so the page
box shows only part of the leaf. Leaf 57 of the Aura lost the right half of
every line and read as 113 words of a 202-word page — _not_ empty, so "did
it read nothing?" is the wrong question. `ocr ... fresh` now tests for ink
against the frame and re-renders wider automatically. If a leaf reads
oddly short, render it with `leaf <n> out 300 whole` and compare.

**Long sweeps kill the browser.** Rendering hundreds of leaves at 300 DPI
exhausts the container. `ocr` recycles the PDF document every 40 leaves,
which helps and is not sufficient — **chunk anything over ~100 leaves**,
restarting the browser between chunks. A 102-leaf book will probably survive
one pass; do not assume it.

**`transcribe` merges by `pageIndex`, and `replace` means replace.** I used
`replace` once meaning `merge` and discarded 88 leaves. Merge is the default
for a reason.

**Never hand `mergeBatchIntoRun` a run summary.** It now throws, because it
did not: a summary has no `transcriptions`, so a merge silently threw away
twelve landed leaves, two corrections and three rulings — and reported
`landed: 72` while doing it. If you add a field to `SavedRun`, a test fails
until you decide whether it is carried. Do not shortcut that test.

**Editing core does not reload in the open browser page.** Dynamic imports
are cached for the page's lifetime. Restart the driver after touching
`src/`, or you will "fix" something and watch the old behaviour.

**Gutenberg's licence text is inside the same markup as the book.** It landed
on the last leaf of the Aura and would have printed under the author's name.
`consistency` caught it on `including including`. `gutenberg-blocks.mjs`
strips the wrapper now — but check the first and last leaves by eye anyway.

---

## 6. Editorial decisions are not yours

When "faithful to the original" and "correct" pull apart — a compositor's
error, the book contradicting itself, a passage with no pixels behind it —
**transcribe it as printed and raise a query**:

```bash
node scripts/drive.mjs queries out.md      # what is waiting, and what was ruled
node scripts/drive.mjs rule <leaf> "<as printed>" corrected "<reads>" "why" mention
node scripts/drive.mjs rule standing "British/American spelling" noted - "why" mention covers:centre,colors
```

There is deliberately **no field for a proposed fix** on a query: a
suggestion beside a question is an answer in all but name. A _ruling_ may
carry one, because a ruling is the answer.

The rulings already made on this shelf, which you should follow unless told
otherwise:

- **Obvious printer's errors are fixed**, and the introduction says so.
- **The British/American spelling mix is kept**, and the introduction says so.
- **Chapter titles come from the chapter itself**, not the contents page,
  where the two disagree.
- **Text with no pixels behind it is set from the other witnesses** rather
  than left as a hole — but it is still raised as a query first.

A `corrected` ruling is not done until an edit lands. `queries` reports
`decidedButNotPrinted` for exactly that gap; it should be empty.

---

## 7. Prose, and the thumb on the scale

You will write an introduction, a note on the text, and possibly a glossary.
Read `voice/etsu-t-dhent.json` on the shelf before writing a word.

The standing rule: **it is nobody's place to assert the absolute truth of
these things, and equally nobody's place to quietly deny it.** State the
tradition's teaching plainly — "supposed" and "so-called" belong on contested
claims and single-witness stories, never on doctrine. Never argue the reader
round. Ancestry is not an argument. And warmth is not imprecision: an entry
so flat nobody would want to try anything has failed.

`node scripts/voice.mjs audit <book.json>` runs after the writing and before
the push. **Do not tune the limits to make a draft pass.** What it cannot see
is flatness — read the doctrinal entries end to end and ask whether they
sound like someone who finds the material alive.

---

## 8. Before you finish

```bash
npm run typecheck && npm test && npm run format:check && npm run lint
node scripts/drive.mjs proof 1 5 40        # real pages from the real PDF
```

**Proof the book against the look it will export.** Both typographic bugs
found this week were invisible to every unit test and obvious on a rendered
page — optical margins were opening a visible gap before every hyphenated
line break, on every justified page of every book.

Then push to the shelf. The book file, `about.json`, `queries.md`,
`rulings.md`, and the human-readable `introduction.md` / `glossary.md` /
`notes.md` go beside each other under `books/<slug>/`. **Pictures go to
`images/<digest>.png`, never inline** — base64 is a third larger than the
bytes, is rewritten on every save, and git keeps every version. One book's
inline plate made its file 29.8 MB instead of 917 KB.

---

## 9. Open questions on this shelf

- **Trim size is unsettled** and is a set-wide decision. See
  `docs/research/PROMPT-trim-and-positioning.md`. The constraint: KDP will
  not print text on a spine under 79 pages, and _The Human Aura_ at 6 × 9 is
  50 pages. Only 5 × 8 at 12 pt clears it. _The Astral World_ at 102 leaves
  should land near 95 pages there. **Do not lock a trim without the user.**
- **_Clairvoyance_ has one query outstanding** — leaf 163, an unclosed
  quotation. Not yours to settle.
- _Clairvoyance_ has no `queries.md` history before this week; its
  uncertainty gate and adjudication pass were never recorded.

## 10. If you remember one thing

Every check in this app exists because the writer is the one party who
cannot judge their own work. When you are sure the text is right, that is
precisely the moment to cut a crop and look at the paper.
