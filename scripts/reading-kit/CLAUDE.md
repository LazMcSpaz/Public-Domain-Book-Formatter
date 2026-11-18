# scripts/reading-kit/

The second, older reading pipeline: a scanned book read without an API, thirty leaves a stretch, as `draft`, then subagent readers with the pixels, then `transcribe`. Plain Node and shell around `drive.mjs`, with one folder of reader briefs per book. How to run it is in [README.md](README.md).

Heading: to be merged into the main reading pipeline (`drive.mjs` and the reading process document); add nothing here that the main pipeline could hold.

## May use

- `../drive.mjs` (through its command line, with the book open via `drive.mjs use`), Node built-ins, Python 3 for the `.py` helpers, Playwright's Chromium (`sheet.mjs`).

## Must not

- Import `src/core/` or reimplement its rules; a rule worth keeping goes into core or `drive.mjs` as part of the merge.
- Hand a reader a hypothesis about what the text ought to say: a reader is given an image and a text and asked where they differ.

## Key files

- `stretch.sh`: prepares one stretch: drafts, rules, 400-DPI renders, briefs, prompts.
- `brief.mjs`: one reading brief per batch of leaves.
- `land.mjs`: turns the readers' output into a batch for `transcribe`, dropping fields it does not know.
- `apply.mjs`: the sweeps and rulings after landing; prints `CHECK` and exits non-zero on anything not exact.
- `balance.mjs`: marks against notes, leaf by leaf, before a batch lands.
- `variants.mjs`: terms a book spells two ways; prints `SWEEP UNSAFE` for a match inside a longer word.
- `<book>/PROMPT.md` (`glossary/`, `isis/`, `sd/`, …): what each OCR engine gets wrong on that book, and its rulings.

## Folder-specific rules and lessons

- Run `balance.mjs` on every batch before `transcribe`: three stretches of _The Secret Doctrine_ landed without it, with 143 of 237 notes misplaced.
- A sweep in `apply.mjs` must replace exactly one match; a pair whose `now` drops words is held back (`ALLOW_WORD_LOSS=1` only for a doubled word).
- A reader changes text, never a block's kind: fix a mistyped `footnote` or a `table` holding prose in `ruled-<tag>.json` before `land.mjs`.
- Checking out another branch in the shelf changes the scan's modification time, which keys the run: fast-forward `main` without a checkout (README, "A driver trap").
- Run `drive.mjs use <scan>` after `open` and before the first `save`, or `save` names a run that does not exist.
