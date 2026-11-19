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

On the shelf, today: `books/<dir>/book.json` is the book and every decision;
`about.json` beside it is its card; the `*.md` beside it are readable sheets
(ledger, corrections, queries, rulings, glossary, introduction); the `*.pdf`
beside it is the **exported** edition, not the scan. The scan is
`scans/<sha256>.pdf`, named in `book.json` under `scan.path`. The voice card
is `voice/etsu-t-dhent.json`; `RULINGS.md` holds the standing rulings every
book inherits. `work/runs/` holds the status notes, one file per run of an
agent ([below](#status-notes-what-you-are-doing-on-the-shelf)).

## Before you start

1. **Both repositories present.** If the shelf is missing, attach it with the
   `add_repo` tool (repository `Public-Domain-Books-Storage`, same owner as
   the formatter, `access: push`), clone it where the tool says, then call
   `register_repo_root` so its own instructions load.
2. **Sync check.** The cloud container can revert both checkouts without
   warning, even after a push. Run this (with your branch in place of `main`
   if you work on one):

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
   lists them with the text each sits in, and
   `memos resolve <id> "<what was done>"` records the outcome. A comment
   asking for prose gets a proposal in its resolution, never a landed edit.
   Only the editor clears a memo.

## Starting a new book

Ask the owner first, because guessing any of these wastes the run: the scan
and which printing it is; whether the book stands alone or joins others in a
volume; the imprint details, if not banked in a saved look; anything already
ruled on that edition. Then put it on the shelf with
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
3. **Take the free reading**: `node scripts/drive.mjs recon`. `load` says
   whether one is here already. `recon` loads `recon.json.gz` from beside the
   book when it is a reading of this scan, so a reading the shelf holds is
   never redone; otherwise it reads the scan (most of an hour on a long book:
   run it in the background). After a reading of your own,
   `node scripts/drive.mjs reconexport <shelf>/books/<dir>/recon.json.gz` and
   commit it. Without a reading, `transcribe` refuses to land leaves.
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

## Status notes: what you are doing, on the shelf

Every role leaves a status note on the shelf for each job it does, so the
owner, and the Workroom screen once it is built, can see what is waiting on
him, where each book stands and what each role is doing. The note sits beside
the book's `ledger.md`; it does not replace it. Each run has its own file, so
agents working at the same time never write the same one
([the spec](../specs/status-notes.md)).

- **At the start of a job:**
  `node scripts/work.mjs start --role <role> --book <folder> --stage <stage> --job "<plain words>"`.
  It prints the run's id; use it for every later step. A run that takes over
  from another names it with `--from <id>`. Tools work has no `--book` and no
  `--stage`.
- **At meaningful points**, not every leaf: a batch landed, a pass finished,
  a round of the writing loop.
  `work.mjs progress <id> --done <n> --of <m> --unit <leaves, plates, checks>`,
  or `--note "<what happened>"`. A run that says nothing for twelve hours
  while working is shown as stale.
- **When the owner must act:**
  `work.mjs ask <id> --what "<what he must do>" --where <the file on the shelf>`
  (the questions sheet, the readiness report, a draft). Once he has answered,
  `progress` or `done` moves the run on.
- **At the end:** `done <id> --result "<one line>"`,
  `fail <id> --result "<why>"`, or
  `handoff <id> --to <role> --result "<one line>"`. A finished run is never
  reopened; the next piece of work is a new run with `--from`.
- **Commit the notes with your work.** `work.mjs` writes into the shelf
  checkout and never commits or pushes; a note left uncommitted is as
  invisible as any other work.
- **A note never says a book is checked or ready to upload.** Only the
  readiness report does ([README.md](./README.md)); the checker's note links
  to it.

Roles: `managing-editor`, `scout`, `reader`, `typesetter`, `etsu` (the
writer), `etsu-editor` (Etsu's editor), `checker`, and `builder` and
`reviewer` for tools work. Stages, in order: `sourcing`, `reading`,
`checking`, `writing`, `pictures`, `layout`, `upload`, `published`.
`work.mjs list` shows what waits on the owner, each book's stage and each
role's work; `work.mjs show <id>` shows one run's timeline. Every option is in
[commands.md](../reference/commands.md#status-notes).

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
  `npm run format:check`, `npm run lint` and `python3 harness/check.py`, all
  five.

## Setting up a machine

**Node 22.18 or newer.** Several scripts (the readiness check, storage, the
shelf helpers) load the core's TypeScript straight into Node, which Node does
by itself from 22.18 on; `package.json` says so under `engines`, and CI runs
Node 22. Check with `node --version`.

Windows: WSL2 (`wsl --install`, one reboot), repositories inside WSL, not
under `/mnt/`; then `bash scripts/setup-worker.sh` (Node 22 through nvm, both
repositories, packages, Chromium, the tests). If `which npm` answers from
`/mnt/c/`, install Node inside WSL (`nvm install` reads `.nvmrc`). Clone the
shelf blobless and sparse (`git clone --filter=blob:none --no-checkout`, then
`git sparse-checkout set --no-cone <paths>`). On native Windows, install
Chromium with `node node_modules/playwright/cli.js install chromium`; an old
CRLF checkout fails `format:check` everywhere, so check the files you changed
and say so. On native Windows, run `npm run dev`, `npm` scripts and
`npx vite-node …` from PowerShell, not Git Bash: under Git Bash they stop
with `'"node"' is not recognized`.

## Storage key on your own computer

The storage command (`scripts/storage.mjs`, in
[commands.md](../reference/commands.md#storage)) needs a Cloudflare key. In a
cloud session the network adds it. On the owner's computer it is read from
the `CLOUDFLARE_API_TOKEN` environment variable; it is never written into a
file, a prompt or the chat.

- **The key:** a Cloudflare API token with the permission "Workers R2
  Storage: Edit" on the account (Cloudflare dashboard, My Profile, API
  Tokens, Create Token, custom token).
- **For one PowerShell window:** `$env:CLOUDFLARE_API_TOKEN = "<the token>"`.
- **For good** (every new window after this one):
  `[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "<the token>", "User")`,
  then open a new PowerShell window.
- **On Windows, run node from PowerShell, not Git Bash.** Git Bash rewrites
  arguments that look like paths before node sees them, which can change a
  storage key or a file name.
- **Prove it works:** `node scripts/storage.mjs selftest` puts a small
  made-up file in the bucket, fetches it back, checks it and deletes it.
- If it says the key can see no account, or more than one, also set
  `CLOUDFLARE_ACCOUNT_ID` the same way (the account id is kept on the shelf,
  never in this repository).

## Before you stop

1. Everything committed and pushed; `rev-list` prints 0 in both repositories.
2. `main` brought level (step 8).
3. The ledger says what was done, by which role, and what is NOT CHECKED.
4. Your status note says how the run ended (done, failed, handed off, or
   waiting on the owner with the file to open), and it is committed with the
   work.
5. Tell the owner the book's state in the three words of [README.md](./README.md),
   with the check results.

## What it produces and where it goes

Commits on both repositories, pushed and level with `main`, the book's
`ledger.md` saying what was done and every check result, and a status note
for each run in `work/runs/` on the shelf.

## Checks that must pass

`git rev-list --count origin/<branch>..HEAD` prints 0 in both repositories;
`node scripts/drive.mjs book` names the book you meant; `drive.mjs runs` shows
no stray run.

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
