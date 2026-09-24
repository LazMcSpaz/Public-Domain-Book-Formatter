You are correcting a machine reading of five leaves of H. P. Blavatsky's _Isis Unveiled_, Vol. I (New York: J. W. Bouton, 1877), against photographs of those leaves (HathiTrust's scan of the Cornell copy). These are the front matter: the author's **Preface** (pp. v–viii) and **Before the Veil** (pp. ix–xlv), which the rest of the volume was read without.

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading of the whole leaf; it drops all pointing and Greek, and often skips small type), `disagreements` (may be empty on these leaves).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer, crop the render: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from /home/user/Public-Domain-Book-Formatter; pixels of the 400 DPI render; `scale` 2–6 to enlarge). **Check your first crop**: crop a wide band first, find the line, then zoom.

## What this scan is, and what the readers of the body found

- **The type is faint and thresholded.** Hairlines drop out all over; at 1–2× `the` can look like `thc`. Zoom to 4× before calling any letter wrong. A word that reads plainly as itself is transcribed as the word, with nothing raised.
- **Commas that print without their tails.** On one leaf of the body, eight commas printed as bare points and four the reading took for points were commas with visible tails at 600 DPI. **Crop every mid-clause stop at 6× and compare it with a comma and a full stop on the same line.** A mark with a tail is a comma: transcribe `,` and raise nothing. A bare point where the sense wants a comma: transcribe `.` as printed and raise `printers-error` with `fix` giving the comma.
- **HathiTrust's margin text** (`Generated through HathiTrust on …`, `Public Domain, Google-digitized`, the handle URL) runs vertically down the left margin of every leaf, and **`Digitized by` / `Original from` / `CORNELL UNIVERSITY`** sits at the foot. None of it is 1877 matter: set any block of it to `""`. Library stamps and bookplates likewise.
- **Running heads**: `PREFACE.` or `BEFORE THE VEIL.` with a roman folio (`xviii`). Leave them out (set the block to `""` if the draft kept one). A **printer's signature mark** at the foot (a lone digit or letter) has no block and needs none.
- **Before the Veil** opens with epigraphs (a quotation and its attribution, often italic, the attribution after a dash) and later sets a run of **defined terms** — `KABALIST.—`, `PAGAN GODS.—`, `PROPHECY…` — as small capitals followed by the definition. Small capitals are set in plain capitals (`KABALIST`), and each term with its definition is one block.
- **Footnote marks** are `*`, `†`, `‡`, `§`, `‖`, `¶`, and doubled (`**`, `††`) on a busy leaf. They print raised and small; ours reads `*` as `®`, `•` or a speck, and `†` as `t`. A note stands below a short rule at the foot of the leaf with its mark at its head.
- **Greek and Hebrew**: both engines lose them. Read them off the image letter by letter with the accents and breathings the page prints; where the image cannot settle a mark, set the letter bare and raise `unclear`. Latin, French and Sanskrit words are set in italic, with the page's own accents (`Âtmâ`, `Brâhman`).
- **Ligatures and diphthongs**: `æ`, `œ` (`phænomena`, `Æneid`) — both engines drop them. The page's own spellings stand (`phænomena`, `practise`); they are not printer's errors.
- **Figures are old-style**: `1` reads as `I`, `3` as `8`, `5` as `s`, `9` as `g`. Check every figure.
- **Opening quotation marks**: ours renders `“` as `¢`, `«`, `*` or `‘‘`. The page sets a thin space inside its quotation marks in many places; set what you see.
- **The draft leaves every line-end hyphen and its space in** (`alle- gorical`): join them, keeping a hyphen only in a real compound.
- **The draft types a paragraph's last lines `footnote`** at the foot of a leaf with no notes: those are `paragraph`.
- The editor's decisions for this book are in `/home/user/Public-Domain-Books-Storage/books/isis-vol1-vjj34f/rulings.md`: he keeps a great deal as printed and corrects plain compositor's slips. Read it once before your first query.

## Block kinds

The draft guessed each block's `kind` from its geometry, and this book sets extracts and footnotes in the same small type, so it gets some wrong. Where a kind is plainly wrong, give the right one as `"kind"` on that block in your output: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A quotation set in small type within the text is `blockquote`, not `footnote`; the italic sub-heads come out `paragraph` or `blockquote` and are `heading`; a section sub-head is `heading`; a paragraph's last lines typed `footnote` are `paragraph`. An article's title is `heading`; the paper's name and date under it is `caption`. A footnote is only what stands below the rule at the foot of the leaf.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong"}, ...],
  "add": [{"after": 3, "kind": "footnote", "text": "only for a block the draft left out altogether"}],
  "cut": {"lines": "none|part|whole|more", "firstWords": "the first words you set on this leaf", "note": "what the scan lost here, and anything you left out"},
  "queries": [{"quote": "exact words as printed", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error: the word as it should read"}]}]
```

**Write `OUT` after each leaf you finish** (the whole array so far), not only at the end: a reader that stalls must not lose the leaves it has read. Crop where the two readings disagree or something looks wrong, not every line of every leaf.

Every block, corrected or not, with its `i`. Scanner junk (a signature letter, pen marks, specks, the platen edge, "Digitized by Google", a library stamp) — set the block's text to `""`; do not query it.

## Rules

1. **Transcribe as printed.** Spelling, punctuation, capitalisation as the page has them. **Keep the compositor's spacing before `;` `:` `!` `?` and inside quotation marks exactly as printed** — it is not uniform, so per occurrence. Curly `“ ” ‘ ’` as printed. A line-end hyphen that only breaks a word is not printed text: join the word. A hyphen in a real compound stays.
2. **Accents are a prize.** Read them off the image (`Âtmâ`, `Devachan`, `Nirvâna`: whatever this page prints, not what another book prints). Where the image genuinely cannot settle one, set the letter bare and raise `unclear`.
3. **Mark emphasis**: `<i>…</i>` for italic runs, `<b>…</b>` for bold. Small capitals: plain capitals.
4. **Leave out** the running head and folio.
5. **Footnotes**: keep the reference mark in the text where the page sets it, and keep each note as its own block with its mark at its head, as the draft has it. A note that runs over from the previous leaf has no mark on this leaf; do not give it one.
6. **Clear typos and damaged type** (a misspelling the page plainly makes, an unpaired quotation mark, a broken sort): transcribe **as printed** and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. The editor's standing ruling (`RULINGS.md` on the shelf) is that this class is corrected, so your `fix` is applied without anyone looking again: propose one only where it is certain. It covers a misspelling the page plainly makes, a broken or turned sort, and an unpaired quotation mark; not pointing that merely varies, and not a period spelling. If the fix means **choosing** (where an unclosed quotation should close, which of two words was meant) it is not a printers-error: raise it `inconsistent` with no fix.
7. **Before raising anything, read the whole block it sits in and the blocks either side**, and look for the same word or construction elsewhere on your leaves. A finding the paragraph settles is not a query.
8. Anything that is genuinely the editor's — the book contradicting itself, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
9. A word broken by a hyphen across two blocks **or across two leaves** is set whole in the first block and removed from the second, as the readers of 35–44 did.
10. If a block holds two paragraphs run together, or one is split across two blocks, do not restructure — correct the text and note it in your report with the leaf and `i`.
11. A block the brief types `table` is regenerated from its cells, so prose written into it is thrown away. If a `table` block is really prose (the contents page is the likeliest), correct the text and **say so in your report**.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know about this book's type or either engine that is not already above.
