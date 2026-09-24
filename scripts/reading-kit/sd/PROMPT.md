You are correcting a machine reading of five leaves of H. P. Blavatsky's _The Secret Doctrine_, Vol. I, _Cosmogenesis_ (London: The Theosophical Publishing Company, 1888), from Theosophical University Press's online edition of its photographic facsimile.

**Read this first, it is the whole job.** There is **no picture of these leaves anywhere**. The files were put through Acrobat ClearScan, which OCR'd the scan, drew the text again in a synthesised font and threw the photograph away. So you are given **two machine readings of the same leaf** and nothing else, and your job is: _where do they differ, and which of the two does the book itself say is right?_ You never write a word neither reading has (the exceptions are listed under Rules), and you never correct the author.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`; `blocks` `[{i, kind, text}]` (keep `i`) — **the first reading**: ClearScan's own text layer, shaped into blocks from where ClearScan placed each line, with the conversion's mechanical damage already taken off (TUP's "Online Edition" stamp removed, words the layer split with spaces joined where the second reading sets them whole, quotes curled, the space before `, . ; : ! ?` and inside quotation marks closed, `•` and `t` at a note's head set as `*` and `†`);
- `secondReader` — **the second reading**: Tesseract run over the page ClearScan draws, as one run of text with the running head at its front. It has whole words and line-end hyphens (`con- ditioned`), and its own faults: whole passages with `v` for `r` (`De Vivibus Membrovum`), `7.¢.` for `i.e.`, `Brahm4` for `Brahmâ`, `oF`/`Tue`/`SuMMING` for small capitals, quotation marks read as `‘“`, `«“`, `**`, `*’`, and a footnote mark it reads as `*` or drops;
- `disagreements` — the places the two readings' **words** differ (punctuation is not compared; read it yourself).

Use `WORKDIR` for scratch files. Do not write anywhere else.

**The book's own vocabulary is your witness.** Count a word before you rely on it (run from `/home/user/Public-Domain-Book-Formatter`, with `SD_KIT=KITDIR`):

```bash
python3 scripts/reading-kit/sd/lex.py Mulaprakriti "Mula prakriti" origo ovigo   # counts in Vol. I and Vol. II
python3 scripts/reading-kit/sd/lex.py --ctx "tc be" 5                             # where Vol. I sets a phrase, by leaf
```

## How to decide a disagreement

1. **One reading is a word and the other is not**: take the word. `origo`/`ovigo`, `term`/`tern`, `Subject`/`Snbject`. An ordinary English word needs no count; a name, a Sanskrit or technical term, or a Latin phrase does — take the form the book sets, by `lex.py`.
2. **Both are words** (`arc`/`are`, `form`/`from`, `Brahma`/`Brahmâ`): the sentence usually settles it — read the whole block and the ones either side. If it truly does not, keep the first reading and raise `unclear`, naming both, no fix.
3. **Neither is right, or neither is a word** (Greek, Hebrew, Devanagari, a mangled name the book never sets again): keep the first reading exactly and raise `unclear` once per passage, saying what is lost. Never reconstruct Greek or Sanskrit from memory.
4. **Both readings agree on something plainly wrong** (`tc be`, `Egyptain`): ClearScan built its outline from the paper, so this is most likely what 1888 printed. Transcribe it as both give it and raise `printers-error` with the `fix` (the shelf's standing ruling 1 corrects this class; propose a fix only where it is certain).
5. **Accents and ligatures**: neither reading carries them as characters, and `lex.py` counts accent-free text, so it cannot confirm one. Each reading leaves a **trace** instead, and a trace is evidence. Set the accented letter wherever either reading shows one of these traces at that place, and set the bare letter where neither does:
   - `â`: second reading `4`, `d`, `&`, `é`, `i`/`ia` (`Brahm4`, `Purdna`, `Jaganniatha`); first reading `tl`, `tt`, `il`, `;l`, `d` (`Brahmtl`, `Brahmd`).
   - `ü`: `ii` or a dotted `i.i` (`Miiller`, `Mi.iller`) → `Müller`.
   - `æ`/`Æ`: first reading `re`, `<e`, `;:e`, `/E`, `JE`, `.iE`, `ce`; second `z`, `Z`, `@`, `ae` → `æ`/`Æ` (`archæology`, `Æther`, `æons`).
   - `ô`, `é`: `6`, `»é` (`r6le` → `rôle`).
     Do **not** normalise a word the book sets two ways across leaves; that is done later, by count, across the whole book.
6. **Words run together**: where both readings run two ordinary words together (`ofthe`, `monopolisethe`, `copperandgold`), the word space was lost in conversion, not by the compositor: put it back, with no query. A printer's error is a wrong letter, not a lost space.
7. **Punctuation**: where one reading has a stop the sentence needs and the other has none (`could ensue` / `could ensue.`), take the stop. Where both construe, keep the first reading.

## What these leaves are

- **Running heads and folios** often sit at the front of block 0 rather than in a block of their own — check its first words. They are `THE SECRET DOCTRINE.`, `PROEM.`, `INTRODUCTORY.`, `CONTENTS.`, a section's own head (`THE ABSOLUTE KNOWS ITSELF NOT.`), and a folio (`55`, `xxiii`). Leave them out: cut them from the text, or set a block holding only one to `""`. They are usually already gone; the second reading always has one at its front.
- **Footnote marks** are `*`, `†`, `‡`, `§`, `‖`, `¶`, doubled on a busy leaf. The first reading gives `*` as `•` or `*`, `†` as `t`, `+` or `f`, `‡` as `:!:`, `t` or `I`. A note stands at the foot of the leaf with its mark at its head. A note that **runs over** from the previous leaf has no mark on this leaf — its first block is a `footnote` beginning mid-sentence; do not give it one.
- **Letter-spaced heads** come through as single letters (`S T A N Z A`, `P RO E M`): set them as words.
- **The Stanzas** of the Book of Dzyan are set in capitals, each sloka numbered (`1. THE ETERNAL PARENT WRAPPED IN HER EVER INVISIBLE ROBES HAD SLUMBERED …`). Keep the capitals; each sloka is its own `blockquote`, and the commentary after it is `paragraph`.
- **Small capitals** come through mixed case (`DocTRINE`, `ABsOLUTE`): set them in full capitals.
- **Figures**: the first reading gives `r` for 1, `o` for 0, `s` for 5, `S` for 8, spaced apart (`r o,sSo`); the second reading's numbers are nearly always right. `\V` is `W`; `Y` inside a word is `v`.
- **Italics are lost in both readings**. Do not add `<i>` anywhere; nothing here can say where it went.
- **Line-end hyphens** the layer kept (`pre- Cosmic`, `Ex-istence`, `imperme- able`): the second reading shows whether the page broke a line there (`imperme- able` at a line end) — join a word that is only broken; keep a hyphen in a real compound, and use `lex.py` when unsure (where the book sets both the hyphened and the solid form, keep the one this leaf's second reading gives).
- **The contents pages** (leaves 6–13) are replaced in this edition by one built from the text; read them as they are, but do not spend effort on dotted leaders or page numbers — leave those as the first reading has them.
- The editor's decisions that govern every book here are in `/home/user/Public-Domain-Books-Storage/RULINGS.md`. Read rulings 1–4 once before your first query.

## Block kinds and heading levels

The draft guessed each block's `kind` from where ClearScan put its lines. Where a kind is plainly wrong, give the right one as `"kind"`: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A paragraph's last lines typed `footnote` on a leaf with no notes are `paragraph`; an extract or verse set in small type within the text is `blockquote`; a footnote is only what stands at the foot of the leaf.

**Every heading gets a `"level"`**: `1` for a division of the book (`PREFACE.`, `INTRODUCTORY.`, `PROEM.`, `PART I. COSMIC EVOLUTION.` with its sub-title), `2` for a Stanza (`STANZA I.`) or a numbered section (`§ VI. THE MUNDANE EGG.`), `3` for a sub-head inside one (`SUMMING UP.`, a side-head). A title set on two lines is two heading blocks at the same level.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong", "level": 2, "join": true}, ...],
  "add": [{"after": 3, "kind": "footnote", "text": "only for a block the draft left out altogether", "level": "only on a heading"}],
  "queries": [{"quote": "exact words of the first reading", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error"}]}]
```

**Write `OUT` after each leaf you finish** (the whole array so far), not only at the end.

Every block, corrected or not, with its `i`. `level` on every heading block, whether or not you changed it.

## Rules

1. **The page's words and spelling as 1888 printed them**, as far as the two readings and the book can show it. The words you may write that neither reading has are only: a word the first reading split, joined; a line-end hyphen healed; a note mark's glyph; and the stop of rule 7 above; the letters of rule 5.
2. **No space** before `, . ; : ! ?`, none just inside a quotation mark, curly quotes `“ ” ‘ ’`, `—` for a dash (the readings give `--`, `—`, or `-`).
3. **Before raising anything, read the whole block it sits in and the blocks either side**, and search the book (`lex.py --ctx`). A finding the paragraph or the book settles is not a query.
4. What is genuinely the editor's — the book contradicting itself, a sentence that does not construe in either reading — `inconsistent` or `unclear`, transcribed as the first reading has it, **no fix**.
5. A word broken across two blocks **or two leaves** is set whole in the first and removed from the second.
6. **A paragraph or a note the draft cut at a line** into two or more blocks: give each continuation block `"join": true` (never the first part). It is folded into the block before it on landing. If a block holds two paragraphs run together, do not restructure: say so in your report with the leaf and `i`.
7. A block typed `table` is regenerated from its cells, so prose written into it is lost: if one is really prose, say so in your report.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know about either reading that is not already above.
