You are correcting a machine reading of five leaves of H. P. Blavatsky's _The Key to Theosophy_ (London, 1889), against photographs of those leaves (a Google Books scan).

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool; it is sharp enough to read every accent directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer at a word, crop the render — there is no PIL or ImageMagick on the desktop, and you do not need to write a cropper: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from the formatter checkout; pixels of the 400 DPI render; `scale` 2 or 3 to enlarge an accent, 0.5 to see a whole column).

## What this book is

A dialogue. Each turn opens with the speaker in small capitals — `ENQUIRER.` and `THEOSOPHIST.` at first, then `ENQ.` and `THEO.` — followed by the speech in the same paragraph. Section heads (`SECTION I.`) and sub-heads in capitals; footnotes at the foot of the leaf, marked `*`, `†`, `‡` in the text and at the head of the note; Greek, Sanskrit and a little Hebrew set in the text.

## The scan cuts the head of every leaf

This Google copy was cropped at the top: the running head and folio are gone on every leaf, and usually the first line of text too, whole on some leaves and in half on others. Nothing is missing _between_ leaves; what looks like a missing page is the lost top line. So:

- **Do not raise a query about it.** Record it once per leaf in the page's `cut` field (see Output).
- A half-cut line: set a letter only where what survives of it settles it (the lower half of most lower-case letters does; capitals and `c`/`e`/`o` often do not). **Never supply a word from the sense of the passage.** Where a word cannot be read off what is left, stop the line there, begin the block at the first word you can read, and say what was left out in `cut.note`.

## What each engine is bad at on this book (reported by the readers of leaves 0–29)

- **Speaker labels.** Ours: `TreosopHIST.`, `Tueo.`, `Turo.`, `Tureo.`, `Treo.`, `Taro.`, `Tuco.`, `ExqQ.`, `ENxQ.`, `Enq.`, and `ENQ..` from a speck. The other: `Evq.`, `Taro`. They are always one of `ENQUIRER.`, `THEOSOPHIST.`, `ENQ.`, `THEO.` as the page prints them; set them in plain capitals.
- **Worn sorts.** In this printing a worn `n` prints as `u` and a worn `e` as `c` (`Ou`, `Diffcreuce`, `makiug`, `Schocls`). **Both** engines copy that faithfully, so agreement is no evidence. Transcribe as printed and raise a printers-error. But a letter that is only damaged while the word still reads plainly as the right word (a nicked `h` in `honour`) is not a printer's error: transcribe the word and raise nothing.
- **Figures.** In this face `3` looks like `8`, and the other engine reads `9` as `g` and `1` as `I`. Check every number against the image.
- **Greek.** Both engines lose it entirely. Read it off the image letter by letter with the accents and breathings the page prints (`ἡ γνῶσις τῶν ὄντων`); where a mark is a blot, set the letter bare and raise `unclear`.
- **Ours** turns the opening double quote into `*`, `««`, `we`, `‘“` or `®`, turns `‘` into `¢`, drops opening quotes altogether, reads `†` as `t` or `t+`, and puts `|`, `:`, `’`, `-`, `+` or `TTT` where there is a speck or pen stroke. It reads `c`/`e`/`o` wrongly in the small type (`sceptios`, `Chuist`) and runs words together on a tight line (`Iwill`). It drops `æ` (`Encyclopædia`) and circumflexes (`bonâ fide`).
- **The other** reads `c` as `o`, `u` as `n`, `h` as `lh` or `b`, `d` as `l`, and doubles or drops letters (`annmonius`, `buldha`). It is often better than ours on single letters and on the first, half-cut line.
- **Blackletter** (the imprint, the dedication) defeats both engines. Read it off the image.
- **Small words between display lines** (`BY`, `OF THE`) are dropped by ours; the other usually keeps them.
- **Italic capitals** set the section sub-heads (`THE MEANING OF THE NAME.`): plain capitals, no `<i>`, since the italic is the heading's design. Small capitals in running text (`MYSTERIES`): plain capitals.
- **Spacing before `;` `:` `?` and inside quotation marks varies on a single page** (`lies;` and `principles ;`; `“ greater ”` and `“greater”` a few lines apart). Transcribe each occurrence as printed: a gap as wide as a word space is a space. Do not normalise in either direction.
- **The page's own spellings stand**: `ecstacy`, `Budhism`, `phænomena`, `Boëhme`. They are not printer's errors.
- **This copy carries a former owner's handwriting** on the half-title and pen marks in places: set such a block to `""`.

## Block kinds

The draft guessed each block's `kind` from its geometry, and this book sets quotations and footnotes in the same small type, so it gets some wrong. Where a kind is plainly wrong, give the right one as `"kind"` on that block in your output: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A quotation set in small type within the text is `blockquote`, not `footnote`; a section sub-head is `heading`; the end of a speech typed `footnote` is `paragraph`. A footnote is only what stands below the rule at the foot of the leaf.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong"}, ...],
  "cut": {"lines": "none|part|whole|more", "firstWords": "the first words you set on this leaf", "note": "what the scan lost here, and anything you left out"},
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
