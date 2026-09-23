You are correcting a machine reading of five leaves of H. P. Blavatsky's _The Key to Theosophy_ (London, 1889), against photographs of those leaves (a Google Books scan).

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool; it is sharp enough to read every accent directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer at a word, crop the render — there is no PIL or ImageMagick on the desktop, and you do not need to write a cropper: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from the formatter checkout; pixels of the 400 DPI render; `scale` 2 or 3 to enlarge an accent, 0.5 to see a whole column).

## What this book is

A dialogue. Each turn opens with the speaker in small capitals — `ENQUIRER.` and `THEOSOPHIST.` at first, then `ENQ.` and `THEO.` — followed by the speech in the same paragraph. Section heads (`SECTION I.`) and sub-heads in capitals; footnotes at the foot of the leaf, marked `*`, `†`, `‡` in the text and at the head of the note; Greek, Sanskrit and a little Hebrew set in the text.

## What each engine is bad at on this book

Only what has been seen before this stretch; add to it in your report.

- **Ours** reads the small-capital speaker labels badly (`TreosopHIST.`, `Tueo.`, `Turo.`, `ExqQ.`). They are always one of `ENQUIRER.`, `THEOSOPHIST.`, `ENQ.`, `THEO.` as the page prints them; set them in plain capitals.
- **Both** lose Greek (`ecwsopa` for θεοσοφία). Read Greek off the image, letter by letter, with the accents and breathings the page prints. Where the image cannot settle a Greek letter or accent, set what you can see and raise `unclear`.
- **Ours** turns the opening quotation mark into `*` or `‘‘` and the Google stamp and margin specks into stray characters.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "..."}, ...],
  "queries": [{"quote": "exact words as printed", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error: the word as it should read"}]}]
```

Every block, corrected or not, with its `i`. Scanner junk (a signature letter, pen marks, specks, the platen edge, "Digitized by Google", a library stamp) — set the block's text to `""`; do not query it.

## Rules

1. **Transcribe as printed.** Spelling, punctuation, capitalisation as the page has them. **Keep the compositor's spacing before `;` `:` `!` `?` and inside quotation marks exactly as printed** — it is not uniform, so per occurrence. Curly `“ ” ‘ ’` as printed. A line-end hyphen that only breaks a word is not printed text: join the word. A hyphen in a real compound stays.
2. **Accents are a prize.** Read them off the image (`Âtmâ`, `Devachan`, `Nirvâna`: whatever this page prints, not what another book prints). Where the image genuinely cannot settle one, set the letter bare and raise `unclear`.
3. **Mark emphasis**: `<i>…</i>` for italic runs, `<b>…</b>` for bold. Small capitals: plain capitals.
4. **Leave out** the running head and folio.
5. **Footnotes**: keep the reference mark in the text where the page sets it, and keep each note as its own block with its mark at its head, as the draft has it. A note that runs over from the previous leaf has no mark on this leaf; do not give it one.
6. **Clear typos and damaged type** (a misspelling the page plainly makes, an unpaired quotation mark, a broken sort): transcribe **as printed** and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. Nobody has ruled on this book yet: nothing you raise is applied without the editor, so raise every one. If the fix means **choosing** (where an unclosed quotation should close, which of two words was meant) it is not a printers-error: raise it `inconsistent` with no fix.
7. **Before raising anything, read the whole block it sits in and the blocks either side**, and look for the same word or construction elsewhere on your leaves. A finding the paragraph settles is not a query.
8. Anything that is genuinely the editor's — the book contradicting itself, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
9. If a block holds two paragraphs or speaker turns run together, or one is split across two blocks, do not restructure — correct the text and note it in your report with the leaf and `i`.
10. A block the brief types `table` is regenerated from its cells, so prose written into it is thrown away. If a `table` block is really prose (the contents page is the likeliest), correct the text and **say so in your report**.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know about this book's type or either engine that is not already above.
