You are correcting a machine reading of five leaves of H. P. Blavatsky's _A Modern Panarion_ (London, 1895), against photographs of those leaves (a Google Books scan).

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool; it is sharp enough to read every accent directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer at a word, crop the render — there is no PIL or ImageMagick on the desktop, and you do not need to write a cropper: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from the formatter checkout; pixels of the 400 DPI render; `scale` 2 or 3 to enlarge an accent, 0.5 to see a whole column).

## What this book is

A collection, published after her death: articles and letters from newspapers and magazines of the 1870s and 1880s, each under its own title, often with the original paper's name and date, and sometimes with the letter it answers quoted in smaller type. Footnotes at the foot of the leaf, marked `*`, `†`, `‡`; Greek, Sanskrit, Hebrew and French set in the text.

## If the scan cuts the head of a leaf

_The Key to Theosophy_'s Google copy was cropped at the top, and this one comes from the same source, so look for it on every leaf. There the running head and folio were gone on every leaf, and usually the first line of text too, whole on some leaves and in half on others, and several lines at a time later in the book; nothing was missing _between_ leaves except those lines. Wherever this copy does the same:

- **Do not raise a query about it.** Record it once per leaf in the page's `cut` field (see Output).
- **Nothing above the cut is supplied**, not even a closing quotation mark whose partner survives. A mark you cannot see is not set; say so in `cut.note`.
- A lost line sometimes leaves no trace at all. The sign is a leaf that opens mid-sentence where the one before ended a sentence, or the reverse; record it as `whole`.
- A half-cut line: set a letter only where what survives of it settles it (the lower half of most lower-case letters does; capitals and `c`/`e`/`o` often do not). **Never supply a word from the sense of the passage.** Where a word cannot be read off what is left, stop the line there, begin the block at the first word you can read, and say what was left out in `cut.note`.

## What each engine was bad at on _The Key to Theosophy_

The same engines on a Google scan of the same decade, so most of this will hold here; say in your report what does not.

- **Worn sorts.** In this printing a worn `n` prints as `u` and a worn `e` as `c` (`Ou`, `Diffcreuce`, `makiug`, `Schocls`). **Both** engines copy that faithfully, so agreement is no evidence. Transcribe as printed and raise a printers-error. But a letter that is only damaged while the word still reads plainly as the right word (a nicked `h` in `honour`) is not a printer's error: transcribe the word and raise nothing.
- **Faint arches are not worn sorts.** The scan is thresholded thin, so the hairlines of `n`, `h`, `m` drop out all over (`beginuiug`, `tlie`, `ou`). Where the letter's shape is otherwise whole and the word reads plainly, transcribe the word and raise nothing; zoom to 3× before deciding. Raise a printers-error only for a fully formed wrong letter (a `c` with no crossbar at all), or a sort that has **lost an ascender and become another real word** (`out` for `but`), which neither engine will flag.
- **Figures.** In this face `3` looks like `8`, and the other engine reads `9` as `g` and `1` as `I`. Check every number against the image.
- **Greek.** Both engines lose it entirely. Read it off the image letter by letter with the accents and breathings the page prints (`ἡ γνῶσις τῶν ὄντων`); where a mark is a blot, set the letter bare and raise `unclear`.
- **Ours** turns the opening double quote into `*`, `««`, `we`, `‘“` or `®`, turns `‘` into `¢`, drops opening quotes altogether, reads `†` as `t` or `t+`, and puts `|`, `:`, `’`, `-`, `+` or `TTT` where there is a speck or pen stroke. It reads `c`/`e`/`o` wrongly in the small type (`sceptios`, `Chuist`) and runs words together on a tight line (`Iwill`). It drops `æ` (`Encyclopædia`) and circumflexes (`bonâ fide`).
- **The other** reads `c` as `o`, `u` as `n`, `h` as `lh` or `b`, `d` as `l`, and doubles or drops letters (`annmonius`, `buldha`). It is often better than ours on single letters and on the first, half-cut line.
- **Blackletter** (the imprint, the dedication) defeats both engines. Read it off the image.
- **Small words between display lines** (`BY`, `OF THE`) are dropped by ours; the other usually keeps them.
- **Italic capitals** set the section sub-heads (`THE MEANING OF THE NAME.`): plain capitals, no `<i>`, since the italic is the heading's design. Small capitals in running text (`MYSTERIES`): plain capitals.
- **Spacing before `;` `:` `?` `!`**: the compositor sets a thin space there nearly everywhere, narrower than a word space. **Any visible gap is set as one space; only a mark touching its word is set close** (`serious?`). Inside quotation marks the same: a visible gap after `“` or before `”` is a space. Do not normalise, in either direction, what you can see.
- **Thresholding.** The scan is thresholded thin: most `e` crossbars and many `n`/`h`/`m` arches have dropped out. At 1–2× `the` looks like `thc`. Only at 4× does a truly open `c` for `e` (`trec`) separate from a lost hairline. The footnote type, which prints heavy, shows this in nearly every `e`; that is not a worn sort and not bold type.
- **A capital on a half-cut line** often survives only as its feet. Set it only where every lower-case letter after it is read off the page and leaves one possible word (`Pythagorean`); otherwise stop the line there.
- **Accent-shaped specks** sit over vowels (`consciousnéss`, `reve̊red`) and both engines take them for accents; this book sets no accent on English words.
- **Long quotations in small type** (Sinnett, Walker, Conelly, the verse): `blockquote`, one per block even where the draft splits them a line at a time. A lead-in line in text type ("Mr. Conelly proceeds—") is `paragraph`. Rows of printed dots between stanzas: `* * * * *`.
- **A section numeral (`XII.`) is printed above every section title and the draft never gives it a block: add it** with the `add` list, kind `heading`, directly above the title.
- **To tell a real `c`-for-`e` from a lost hairline**, crop at 8× beside a plain `c` on the same line: a lost hairline leaves a stub of crossbar pointing left; a wrong sort has only the ball at the top.
- **A full stop can print with a short tail** and read as a comma at 1–2×. At 4× compare it with a real comma on the same leaf before raising anything.
- **The draft sometimes drops a whole line**, most often a footnote's first line or a half-cut first line; the other engine usually keeps it. On every leaf with a footnote, compare the two readings of the note's opening.
- **Footnote marks print as a solid round blob** (`•`) and a full stop can print heavy and raised (`see•`): the first is `*`, the second `.`.
- **The draft sometimes has no block at all** for a footnote, a sub-head or a section numeral (`VII.`) that the page prints. Put it in with the page's `add` list: `after` is the `i` it follows (`-1` for the top of the leaf), `kind` one of the five below, `text` read off the page like any other block. Add only what you can see printed; never a line the scan lost.
- **Lines are lost at the foot of some leaves as well as the head**: record it in `cut.note`.
- **Greek and Hebrew**: print accents and breathings only sometimes (`τὸ πᾶν` on one leaf, `παν` bare on the next). Set exactly what each occurrence prints. The section numeral above a section title (`III.`, `IV.`) sometimes has no block: note it in your report, do not add a block.
- **The page's own spellings stand**: `ecstacy`, `Budhism`, `phænomena`, `Boëhme`. They are not printer's errors.
- **This copy carries a former owner's handwriting** on the half-title and pen marks in places: set such a block to `""`.

## Block kinds

The draft guessed each block's `kind` from its geometry, and this book sets quotations and footnotes in the same small type, so it gets some wrong. Where a kind is plainly wrong, give the right one as `"kind"` on that block in your output: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A quotation set in small type within the text is `blockquote`, not `footnote`; the italic sub-heads come out `paragraph` or `blockquote` and are `heading`; a section sub-head is `heading`; a paragraph's last lines typed `footnote` are `paragraph`. An article's title is `heading`; the paper's name and date under it is `caption`. A footnote is only what stands below the rule at the foot of the leaf.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong"}, ...],
  "add": [{"after": 3, "kind": "footnote", "text": "only for a block the draft left out altogether"}],
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
6. **Clear typos and damaged type** (a misspelling the page plainly makes, an unpaired quotation mark, a broken sort): transcribe **as printed** and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. The editor's standing ruling (`RULINGS.md` on the shelf) is that this class is corrected, so your `fix` is applied without anyone looking again: propose one only where it is certain. It covers a misspelling the page plainly makes, a broken or turned sort, and an unpaired quotation mark; not pointing that merely varies, and not a period spelling. If the fix means **choosing** (where an unclosed quotation should close, which of two words was meant) it is not a printers-error: raise it `inconsistent` with no fix.
7. **Before raising anything, read the whole block it sits in and the blocks either side**, and look for the same word or construction elsewhere on your leaves. A finding the paragraph settles is not a query.
8. Anything that is genuinely the editor's — the book contradicting itself, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
9. A word broken by a hyphen across two blocks is set whole in the first block and removed from the second, as the readers of 35–44 did.
10. If a block holds two paragraphs run together, or one is split across two blocks, do not restructure — correct the text and note it in your report with the leaf and `i`.
11. A block the brief types `table` is regenerated from its cells, so prose written into it is thrown away. If a `table` block is really prose (the contents page is the likeliest), correct the text and **say so in your report**.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know about this book's type or either engine that is not already above.
