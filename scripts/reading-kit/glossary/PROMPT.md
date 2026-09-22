You are correcting a machine reading of five leaves of H. P. Blavatsky's _The Theosophical Glossary_ (1892), against photographs of those leaves.

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG, 3028×4423 — read it with the Read tool; it is sharp enough to read every accent directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

## What each engine is bad at on this book (confirmed against crops)

- **Ours** drops every circumflex (`Purdnas` for `Purânas`) and every `æ`/`œ` ligature (`Ather` for `Æther`, `Judzus` for `Judæus`); mangles the language tag (`(S%.)` for `(Sk.)`); reads a leading `Â` as `K`.
- **The other** doubles `m` (`nanme`, `tenmple`), reads `0` as `o` (`48oo`), and puts an acute on nearly every capital A (`Ánanda`) — wrong every time. The book's accent is always a **circumflex**, never acute or grave.
- **Both** read an italic capital `J` as `F` or `Z`. Check every one.
- Ours reads a bold leading `A` as `K` whether or not it carries a circumflex (`Krani` = `Arani`, `Kditi` = `Âditi`) — a `K` headword is not evidence either way; read the image.
- The circumflex rule is for Sanskrit, Persian and Hebrew transliterations. **French, Egyptian and Norse words carry their own printed accents** — `Lévi`, `Ré`, `Thmé`, `Örgelmir`, `Bör`, `Müller` — do not "correct" a plainly printed acute or umlaut. A worn circumflex sort prints as a short grave-like tick; on a Sanskrit word that is a circumflex.
- Both engines drop Greek letters (`Ω`, `βαφη`) and read small capitals badly; check any entry with either against the image.
- The book uses old-style figures: a zero looks like a small `o`. In a number it is a zero.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "..."}, ...],
  "queries": [{"quote": "exact words as printed", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error: the word as it should read"}]}]
```

Every block, corrected or not, with its `i`. Scanner junk (a signature letter, pen marks, specks, the platen edge, "Digitized by Google") — set the block's text to `""`; do not query it.

## Rules

1. **Transcribe as printed.** Spelling, punctuation, capitalisation as the page has them. **Keep the compositor's spacing inside quotation marks and before `;` `:` `!` `?` exactly as printed** (`“ Karma ”`, `bird ;`) — it is not uniform, so per occurrence. Curly `“ ” ‘ ’` as printed.
2. **Accents and ligatures are the main prize.** Read them off the image. Where the image genuinely cannot settle an accent, set the letter bare and raise a query (`unclear`).
3. **Mark emphasis**: `<b>headword</b>`, `<i>…</i>` for italic runs (the whole language tag `(Sk.)` is italic). Small capitals: plain capitals.
4. **Leave out** the running head and folio.
5. **Clear typos and damaged type** (a misspelling the page plainly makes, a tag missing its full stop, an unpaired quotation mark, a broken sort): transcribe **as printed** in the block, and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. The editor has ruled this class is corrected; the record still has to show what the page printed.
6. **Do not query** pointing that merely varies between entries (a stop inside one bracket and outside another, a comma inside a quotation), or a headword out of alphabetical order — the editor has ruled those stay as printed.
7. Anything that is genuinely the editor's — the book contradicting itself about a word, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
8. If a block holds two entries run together, or an entry is split across two blocks, do not restructure — correct the text and note it in your report.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know that is not already above.
