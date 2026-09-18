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

## Open the renders a few at a time

**Never open more than three renders in one message.** A page of this book is a
megabyte or so of pixels, and a request carrying seven of them times out on the
server rather than failing cleanly — measured twice on the same seven leaves, in
both cases at the exact turn that opened them. The batch is then lost whole and
has to be read again from nothing.

Read them in groups of three or fewer: open a group, check those leaves against
their drafts, write what you found, and only then open the next group. It costs
one extra turn per group and it is the difference between a batch that lands and
a batch that dies at the first turn.

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
3. **Italics, small capitals, subscripts.** The draft carries none. The book
   italicises heavily — book titles, Latin, Greek transliterations, emphasis.
   Mark them with `<i>…</i>` in the block text. Where the paper sets a word in
   **small capitals**, write it in its own case inside `<sc>…</sc>`: a word set
   caps-and-small-caps is `<sc>Hermetist</sc>`, a word set small throughout is
   `<sc>will</sc>`, and a full capital is left as a capital — the tag lowers
   what is lower case and leaves capitals alone. A figure set **below the
   line**, as in a chemical formula, is `Na<sub>2</sub>CO<sub>3</sub>`. Vol. I
   had none of this marked and needed three sweeps of 357 words afterwards; a
   reader looking at the leaf can see it in a glance.
4. **Block kinds.** A quotation set as an indented block is `blockquote`;
   verse is `verse`; a note at the foot is `footnote`; matter in columns is
   `table`.
5. **Footnotes.** Each is a block of kind `footnote` **and must carry its own
   `marker`** — `"*"`, `"†"`, `"‡"`, `"§"`, or the digit the page prints. Do
   not leave the mark inside the text and omit the field: the marker is
   stripped from the front of the text downstream using this field, so a note
   with the wrong marker keeps a stray `†` and loses a `*`. This went wrong on
   six notes in the last chapter.

   **A note that runs over from the leaf before carries no marker.** The tail
   of a long note at the foot of the next leaf prints without a `*` or `†`, and
   it is recorded without one — assembly joins it to the note above. Giving it
   one makes a fresh note that waits for a mark, takes the next leaf's, and
   sets every note of that marker one reference early to the end of the
   volume. One such on Vol. I displaced 188 references.

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
- **`text` is what the paper prints, even when the paper is wrong.** Where a
  sort is plainly a slip — `nevertheiess`, `kabalisf`, `casily` — the slip
  goes in `text` and a `printers-error` query goes beside it. Do not write the
  word you know was meant and put the paper's form in `alternatives`: Vol. I's
  readers did that six times, and each was a silent correction that had to be
  found by re-cutting the leaf. The plain ones are ruled on in bulk afterwards
  under a standing instruction; that is cheap. Finding them is not.
- **Where a letter cannot be told at this size, name the word and both
  readings** in `uncertain` — `text` as the paper most plausibly has it,
  `alternatives` the other, `reason` which letters are in doubt. The parent
  cuts every such word at 600 DPI before the batch is landed. Vol. I left 149
  of these to a pass at the end, and a third of the ones re-cut were wrong;
  named as you go, they cost a crop each and nothing else.

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

`role` is one of `body`, `chapter-opening`, `part-divider`, `blank`,
`half-title`, `title-page`, `copyright`, `dedication`, `epigraph`, `preface`,
`table-of-contents`, `list-of-illustrations`, `plate`, `appendix`, `glossary`,
`index`, `colophon`, `digitization-notice` — that last for a scanning library's
inserted leaf, which is neither the book's nor blank.
`kind` on a block is one of `paragraph`, `heading`, `blockquote`, `verse`,
`footnote`, `caption`, `table`. `kind` on a query is one of
`printers-error`, `inconsistent`, `unclear`. Omit `uncertain` and `queries`
when there are none. Drop `structural` and `hyphens` — they are input, not
output.

## Report back

When you are done, say in three lines: how many leaves, how many places you
changed the draft's reading, and how many queries you raised. Nothing else.
