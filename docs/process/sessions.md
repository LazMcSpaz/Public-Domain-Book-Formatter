# Sessions: starting, working with the shelf, stopping

## Purpose

Every piece of book work happens in a Claude session that drives the app and
the scripts. This document is how a session starts, how it gets a book from
the shelf and puts it back without losing anyone's work, and how it stops.

## Who runs it

Every session, whatever its role.

## Two repositories, and which is the truth

- **The formatter** (`~/Public-Domain-Book-Formatter`, public): the app, the
  scripts, these documents. Never put book text, study-book details, KDP or
  ISBN details, or the owner's personal details here.
- **The shelf** (`~/Public-Domain-Books-Storage`, private): the books. **It is
  the source of truth.** The browser's storage is only a cache of it.

On the shelf, today:

| Path | What it is |
| --- | --- |
| `books/<dir>/book.json` | The book and every decision: transcription, edits, rulings, answers |
| `books/<dir>/about.json` | Its card, which the app's shelf list reads |
| `books/<dir>/*.md` | Readable sheets: ledger, corrections, queries, rulings, glossary, introduction |
| `books/<dir>/*.pdf` | The **exported** edition. Not the scan |
| `scans/<sha256>.pdf` | The **scan**. `book.json` names it in `scan.path` |
| `voice/etsu-t-dhent.json` | The editor's voice card |
| `RULINGS.md` | Standing rulings every book inherits |

## Before you start

1. **Both repositories present.** If the shelf is missing, attach it with the
   `add_repo` tool (repository `Public-Domain-Books-Storage`, same owner as
   the formatter, `access: push`), clone it where the tool says, then call
   `register_repo_root` so its own instructions load.
2. **Sync check.** The cloud container can revert both checkouts without
   warning, even after a push. Run, for the branch you work on:

   ```bash
   for r in ~/Public-Domain-Book-Formatter ~/Public-Domain-Books-Storage; do
     git -C $r fetch origin -q
     echo "$r behind $(git -C $r rev-list --count HEAD..origin/main) ahead $(git -C $r rev-list --count origin/main..HEAD)"
   done
   ```

   Behind and not ahead: the container rolled you back; reset to the remote
   (`git fetch origin main && git reset --hard FETCH_HEAD`), nothing is lost.
   Ahead: work exists only here; push it now. Check which side is stale before
   assuming anything was lost.
3. **Read**, in this order: the root `CLAUDE.md`, [product.md](../product.md),
   [README.md](./README.md), and the document for your job.
4. **Read the book's own record** on the shelf: `ledger.md`, `rulings.md`,
   `queries.md`, and `RULINGS.md` at the shelf root. Read a ruling before
   raising something already settled.
5. **Ask what the book is**: `node scripts/drive.mjs book` reports the open
   book, its shape and route, open comments from the editor, and queries
   without a proposal. [FLOW.md](../FLOW.md) says which stages that route gets.
6. **Answer the editor's comments first.** `node scripts/drive.mjs memos`
   lists them with the text each sits in; `memos resolve <id> "<what was
   done>"` records the outcome. A comment asking for prose gets a proposal in
   its resolution, never a landed edit. Only the editor clears a memo.

## Starting a new book

Ask the owner for these first; guessing any one wastes the run:

1. the scan, and which printing it is;
2. whether the book stands alone or joins others in a volume;
3. the imprint details, if not already banked in a saved look;
4. anything already ruled on that edition.

Then put it on the shelf with
`npx vite-node --config vitest.config.ts scripts/shelf-new-book.ts <shelf> <scan> <Author-TitleCamel> <leaves> <voice-from/book.json> <leaf0.json>`,
and before reading a leaf record its shape:
`node scripts/shape.mjs <book-dir> --write`, or
`--declare '<json>' --because '<reason>'` where nothing can measure it. A book
put on the shelf any other way needs `node scripts/drive.mjs card <book-dir>`
as well as `save`, or the shelf list cannot see it.

## Steps: working on a book

1. **Start the servers**: `npm run dev &` (the app on port 5173), then
   `node scripts/drive.mjs serve &` (the driver on port 7788).
2. **Load the book from the shelf**, with the scan named in `book.json`:
   `node scripts/drive.mjs load <shelf>/books/<dir>/book.json <shelf>/<scan.path>`,
   then `node scripts/drive.mjs use <shelf>/<scan.path>`. The PDF beside
   `book.json` is the export; loading it makes a second, wrong book that
   renders the finished edition every time you ask for a leaf. Confirm with
   `drive.mjs book`; `drive.mjs runs` lists stored runs and `runs drop <n>`
   removes a stray one.
3. **Do not redo a reading the shelf already holds.** If `recon.json.gz` sits
   beside the book, `node scripts/drive.mjs reconimport <shelf>/books/<dir>/recon.json.gz`.
   After a recon of your own, `reconexport` to the same path and commit it.
4. **Work in units, and commit each one**: a batch landed, a pass, a fix.
   Forty tool calls with nothing committed is forty tool calls the container
   can take away.
5. **Save**: `node scripts/drive.mjs save <shelf>/books/<dir>/book.json`. The
   second argument, if given, is the output path and must end in `.json`;
   there is no message argument. `save` refuses when it would drop rulings or
   edits the file holds; `--force` only when the run is meant to replace the
   file.
6. **A change to a book is four things in one commit**: `book.json`, the
   re-exported PDF, the regenerated readable files, then commit and push all
   of it together ([export.md](./export.md)).
7. **Push, and check it landed**: `git rev-list --count origin/<branch>..HEAD`
   must print 0 in both repositories.
8. **Bring `main` level at every natural stopping point.** The app reads the
   shelf's `main`, and the deployed app is built from the formatter's `main`,
   so work left on a branch is work the editor cannot see. The owner's
   standing instruction:

   ```bash
   git checkout main && git merge --ff-only origin/<branch> && git push -u origin main
   ```

   On the shelf, do not check out another branch: it rewrites the scan's
   modification time, which is part of the run's key. Fast-forward without a
   checkout: `git push origin refs/remotes/origin/<branch>:refs/heads/main`.
   If the fast-forward is refused, `main` has moved (the app writes the
   editor's rulings straight to it). **Never force and never rewind**: those
   rulings exist nowhere else. Compare what each side touched:

   ```bash
   BASE=$(git merge-base origin/main origin/<branch>)
   comm -12 <(git diff --name-only $BASE origin/main | sort) \
            <(git diff --name-only $BASE origin/<branch> | sort)
   ```

   Empty: merge into `main`, push, then fast-forward the branch to `main`.
   Not empty: a book was written from two places; stop and tell the owner
   which file. (Changes reaching `main` through a pull request that merges
   when the checks pass is planned, task 7 of the [cleanup plan](../cleanup-plan.md).)

## Two sessions at once

One book is worked by one session at a time: a correction does not merge with
another session's correction, and one is lost at the next save. A second
session on the same machine needs its own clones of both repositories and its
own ports and profile:
`DRIVE_PORT=7789 DRIVE_PROFILE=.drive-2 DRIVE_OUT=out-2 node scripts/drive.mjs serve &`
and `npm run dev -- --port 5183`.

## Working practice

- **After editing anything in `src/core` or `scripts/drive.mjs`, restart both
  servers**, and check what is served, not what is on disk. A running `serve`
  holds every verb in memory, and Vite keeps a transform cache. Kill vite by
  its process id (`pkill -f vite` also kills your own shell). Then `curl`
  the module through `/@fs/<absolute path>` and look for your change
  (`/src/...` returns `index.html` and confirms anything). If the plain URL and
  the same URL with `?v=<timestamp>` disagree, the server is stale. The first
  command after a restart often fails with "Target page, context or browser
  has been closed": run it again.
- **Before hand-editing a `book.json`**, prove the round trip on that file
  (the app writes two-space JSON), and anchor a text match inside the object
  you mean (`"author"` occurs in two places).
- **Merging a browser run into a shelf book file by hand**: match text edits
  on `blockId` and every other edit kind by exact equality, and check the
  non-text edits of the two files agree as a set before writing.
- **A script written for book work is committed to `scripts/`** before the
  session ends. Glossary tools, the cover flattener and the corrections sheet
  were each lost once by living only in a scratchpad.
- **List a path before writing a new file there.** A new test once replaced
  an existing one of the same name.
- **Measure, do not reason, about a fault.** Every fault reasoned about in one
  review was diagnosed wrongly; every one measured was right first time.
- **Before committing code**: `npm run typecheck`, `npm test`,
  `npm run format:check` and `npm run lint`, all four.

## Setting up a machine

Windows: use WSL2 (`wsl --install` in an administrator PowerShell, one reboot)
and keep the repositories inside WSL, not under `/mnt/`. Then
`bash scripts/setup-worker.sh` installs Node 22 through nvm, both
repositories, the packages and Playwright's Chromium, and runs the tests. If
`which npm` answers from `/mnt/c/`, the Windows Node is in the way: install
Node inside WSL (`nvm install` reads `.nvmrc`). The shelf is large: clone it
blobless and sparse (`git clone --filter=blob:none --no-checkout`, then
`git sparse-checkout set --no-cone` with the paths you need). On native
Windows, install Chromium with `node node_modules/playwright/cli.js install chromium`;
an old checkout with CRLF line endings fails `format:check` on hundreds of
untouched files, so check the files you changed and say so.

## What it produces

Commits on both repositories, pushed and level with `main`; the book's
`ledger.md` updated with what was done and every check result.

## Before you stop

1. Everything committed and pushed; `rev-list` prints 0 in both repositories.
2. `main` brought level (step 8).
3. The ledger says what was done, by which role, and what is NOT CHECKED.
4. Tell the owner the book's state in the three words of [README.md](./README.md),
   with the check results.

## Never

- Never `save` a book you did not `load` in this session.
- Never `save` while the editor is working in the app; the shelf has moved
  under you. `corrections`, `querycrops`, `second`, `witness` and
  `book-files.mjs` leave `book.json` alone and are safe beside him.
- Never load the export where the scan is wanted.
- Never force-push `main` or rewind it.
- Never leave work only in this container: push at every stopping point.
- Never run `drive.mjs card` or `drive.mjs queries` over a book whose sheets
  are hand-written without reading the head of `rulings.md` and
  `git log -1 -- <dir>/rulings.md` first; both verbs rewrite `queries.md`,
  `rulings.md` and `proposals.md`. Restore hand-written sheets from git after.
