# Correcting a drafted batch

_The method a batch reader is given, verbatim. `scripts/batch.mjs` hands this
to every subagent along with a per-batch brief naming its leaves, its seam and
the few things the deterministic rules could not settle. It is book-independent
on purpose: everything specific to one volume belongs in the per-batch brief._

You are checking a **draft** of some leaves of a scanned book against the
renders of those leaves. You are not transcribing them.

## The one rule

**Never type a leaf out from the render.** The draft already carries what OCR
read off the pixels. Your job is _"here is an image and here is a text, where do
they differ"_ — open the render, read it against the draft, and change only what
differs. A reader who produces text from an image alone has nothing to be wrong
against, and that is the one unrecoverable failure for a public-domain reprint.

If you cannot read a word on the render, **leave the draft's reading and say so
in `uncertain`**. Do not supply a plausible word.

## What is already settled — do not redo it

The draft has had two deterministic passes over it. Both are measured, both
abstain rather than guess, and neither needs your attention except where named:

- **Line-break hyphens.** `ad- vanced` has already been joined or kept, decided
  by whether the book sets the whole word or the compound elsewhere in the
  volume's own vocabulary. Measured at 0 disagreements against readers with the
  images. **Any that are still written `foo- bar` in your draft are ones the
  rule refused to settle** — they are listed for you below, and those are worth
  a look on the render.
- **Running heads and folios.** The head and the page number have been lifted
  off into `furniture`, using the volume's own numbering, voted from the leaves
  whose folio was read confidently. Leave `furniture` alone unless the render
  shows it plainly wrong — and where your brief names a leaf whose folio the
  numbering disputes, read the number off the render and put the right one in.

## What to look for, in this order

1. **`structural`** on each leaf. It says what the draft _guessed_ rather than
   measured. Read it first; it is the order to check things in. Delete it from
   your output.

   Two things it used to say on every single leaf have been taken out of it and
   said once, here, because a line that appears on every leaf is a line nobody
   reads: **the `role` and every block `kind` is a guess — the words are what
   OCR read**, and the line-break hyphens have already been settled (above), so
   the only ones left in your draft are the ones nobody could settle.

2. **`uncertain`** spans — runs of words OCR itself scored low. Check each
   against the render.
3. **Italics.** The draft carries none. The book italicises heavily — book
   titles, Latin, Greek transliterations, emphasis. Mark them with `<i>…</i>`
   in the block text.
4. **Block kinds.** A quotation set as an indented block is `blockquote`;
   verse is `verse`; a note at the foot is `footnote`; matter in columns is
   `table`.
5. **Footnotes.** Each is a block of kind `footnote` **and must carry its own
   `marker`** — `"*"`, `"†"`, `"‡"`, `"§"`, or the digit the page prints. Do
   not leave the mark inside the text and omit the field: the marker is
   stripped from the front of the text downstream using this field, so a note
   with the wrong marker keeps a stray `†` and loses a `*`. This went wrong on
   six notes in the last chapter.
6. **The reference mark in the body.** Where the body carries a `*` or `†`
   pointing at a note, keep it in the body text exactly where it is printed.

## What you must not do

- **Do not correct the book.** A compositor's error, a place the book
  contradicts itself, a passage where "faithful to the original" and "correct"
  pull apart: transcribe it **as printed** and attach a `query` to that leaf.
  There is deliberately no field for a proposed fix — a suggestion beside a
  question is an answer in all but name, and the answer is the editor's.
- **Do not claim evidence you do not have.** You have one flat 150-DPI PNG per
  leaf. Do not write "confirmed at 8×" or "checked at 600 DPI" — three of six
  readers on one chapter did exactly that, and while their readings held up, the
  warrant did not. Worse, a fourth raised a query saying "the third letter has
  no crossbar on the render, where the `e` before it plainly does", which was
  specific, confident, and a description of a page that does not exist. Say what
  you actually looked at, and where you cannot tell, say that instead.
- **Do not invent a footnote's continuation**, a running head, or a folio.

## Output

Write a JSON array to the path you are given — one object per leaf, in leaf
order, in exactly this shape and **no other fields** (a field the parser does
not know is refused and the whole batch is rejected):

```json
[
  {
    "pageIndex": 97,
    "role": "chapter-opening",
    "furniture": { "runningHead": "…", "folio": "39", "stamp": ["…"] },
    "blocks": [
      { "kind": "paragraph", "text": "…with <i>italics</i> where the book sets them…" },
      { "kind": "footnote", "marker": "*", "text": "See Gibbon’s “Decline and Fall,” vol. ii." }
    ],
    "uncertain": [
      {
        "text": "as the draft has it",
        "alternatives": ["what it might be"],
        "reason": "the sort is broken on the render"
      }
    ],
    "queries": [
      {
        "quote": "the words as printed",
        "kind": "printers-error",
        "why": "why this is the editor's decision and not yours"
      }
    ]
  }
]
```

`role` is one of `body`, `chapter-opening`, `table-of-contents`, `blank`.
`kind` on a block is one of `paragraph`, `heading`, `blockquote`, `verse`,
`footnote`, `caption`, `table`. `kind` on a query is one of
`printers-error`, `inconsistent`, `unclear`. Omit `uncertain` and `queries`
when there are none. Drop `structural` and `hyphens` — they are input, not
output.

## Report back

When you are done, say in three lines: how many leaves, how many places you
changed the draft's reading, and how many queries you raised. Nothing else.
