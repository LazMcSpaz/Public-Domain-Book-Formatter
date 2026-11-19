# Spec: one readiness check (cleanup task 1)

_The owner approved this task in the cleanup plan (18 November 2026) as his first priority; this plan was written while he was away (19 November) and is his to confirm or change on return._

## What it does (plain English, for the owner)

One command answers "is this book checked?" and "is it ready to upload?" by running every check in the list ([process/checking.md](../process/checking.md), C1 to C12 and R1 to R11) and writing one report. Each check is marked **PASSED**, **FAILED**, **NEEDS A PERSON** (a sheet someone must read and sign off, such as the spelling sheet) or **NOT CHECKED** with the reason (for example: no second reading exists yet, or the driver was not running). The report ends with one verdict: _checked_, _ready to upload_, or _not ready_, and it can only say _ready to upload_ when every check for that stage passed or was signed off. A session reads the verdict out with the report; it never says "ready" on its own.

The "ready to upload" checks run on the exact files that go to KDP: the interior PDF, the cover PDFs and the EPUB, named by the session, fetched from the storage bucket when they are there, and recorded in the report by fingerprint.

## Done when (how we'll know it works; how the owner can try it)

- On _The Lost Keys of Masonry_ and _Thought Vibration_, the command writes a report with every check accounted for (none silently missing), and the verdict follows the rule above.
- A deliberately planted fault (a "(delete)" working note in a section, a word split in two) makes the report say FAILED for the right check and the verdict _not ready_.
- A check that cannot run is reported NOT CHECKED with its reason, never as passed, and the verdict is then not _ready_.
- The owner can ask a session "is _Thought Vibration_ ready to upload?" and get the report back.

## Modules touched

- `scripts/`: the command, calling the existing checks; the two checks that are only proposed today and need no browser (C11 working notes, R5 markup and stale PDF, R7 cover page count) are built into it.
- `src/core/`: the pure part (the list of checks, how results become a report and a verdict), with tests.
- `scripts/book-files.mjs --finish` and `scripts/drive.mjs finish`: say plainly that they are not the readiness check and point to it.
- `docs/process/checking.md`, `docs/process/upload.md`, `docs/reference/commands.md`, the root CLAUDE.md rule.

## Rules/decisions that apply

- The root CLAUDE.md rule: never tell the owner a book is checked or ready without the results; anything not run is NOT CHECKED.
- Decisions 0051 and 0052: files come from the storage bucket by fingerprint; the latest readiness report is what a finished book keeps (it goes beside the book as `readiness.md`, its date inside).
- No new package. No book text in tests: synthetic data only.

## Out of scope

- Building the other "(proposed check)" items that need the browser or a person (R4, R6, R8, R9, R10); they appear in the report as NEEDS A PERSON or NOT CHECKED until they are built.
- Fixing anything the checks find in a book.
