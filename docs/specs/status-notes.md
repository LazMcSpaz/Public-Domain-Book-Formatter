# Spec: status notes (step 2 of the owner's order of 19 November 2026)

## What it does (plain English, for the owner)

Every agent leaves a small note on the shelf about the job it is doing: when it starts, as it goes ("20 of 40 leaves read") and when it stops. The note says who is working (which role), on which book, what the job is, where the book has got to, and how the job ended. When an agent needs you, the note says exactly what it needs and links to the file to open: the questions sheet, the readiness report, a draft. When it hands the work on, the note says to whom.

Each job gets its own note, in its own file, so agents working at the same time never write to the same file. Every change is added to the note's own timeline rather than replacing it, so you can see the whole history of a job.

These notes are what the Workroom (step 3, a screen in the app) will read to show you three things: what is waiting on you; each book's stage and its latest work; and each role's work in progress and recently finished. A job that has said nothing for twelve hours while claiming to be "working" is shown as stale (its session probably stopped without saying so), never as working. Until the Workroom exists, a session can show the same three lists in text with one command.

The ledger stays as it is: the ledger is the book's own written record of what was done and what the checks said; the notes are the live board of who is doing what right now.

## Done when (how we'll know it works; how the owner can try it)

- A session can start, update, finish, fail, hand off and ask the owner with `node scripts/work.mjs`, and every note it writes is checked before it is written.
- A note that is wrong (an unknown role, a stage that does not exist, "waiting on you" with no link, a timeline out of order) is refused with a plain reason.
- Two agents starting at the same minute on the same book in the same role get two different files, and a start never overwrites an existing note.
- `node scripts/work.mjs list` shows the three Workroom lists, with stale and handed-off jobs shown as such.
- The process documents tell every role to write a note at the start, at meaningful points and at hand-off, and to commit it with its work.
- **The owner tries it:** asks a session "what is waiting on me, and where does each book stand?" and gets the answer read from the notes (`work.mjs list`), with a link to each file he needs to open.

## The record (for the builder)

One JSON file per run, version 1, parsed strictly by `src/core/work/note.ts` (its words in `vocab.ts`, the checks on each part in `fields.ts`, the changes a run makes in `changes.ts`):

| Field                                  | What it holds                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`, `version`                    | `"status-note"`, `1`. Any other version is refused, with a reason.                                                                             |
| `id`                                   | Eight lower-case letters and digits, random, made by the command.                                                                              |
| `role`                                 | One of the seven roles, or `builder` or `reviewer` (below).                                                                                    |
| `book`                                 | The book's folder under `books/`, or `null` for tools or shelf work.                                                                           |
| `stage`                                | One of the eight stages (below); `null` exactly when `book` is `null`.                                                                         |
| `job`                                  | The job in plain words, one line.                                                                                                              |
| `state`                                | `working`, `waiting` (on the owner), `done`, `failed` or `handed-off`. The last three are final.                                               |
| `progress`                             | `null`, or `{ done, total, unit }`: "20 of 40 leaves".                                                                                         |
| `startedAt`, `updatedAt`, `finishedAt` | UTC times. `finishedAt` is set exactly when the state is final.                                                                                |
| `result`                               | One line: what came of it. Required when done, failed or handed off.                                                                           |
| `owner`                                | While `waiting` only: `{ what, links: [{ label, path }] }`, at least one link, each a path on the shelf.                                       |
| `files`                                | Paths on the shelf the run left.                                                                                                               |
| `from`                                 | The run this one took over from, or `null`.                                                                                                    |
| `handoff`                              | When handed off: `{ role, run, note }`, the role it goes to and, if known, the run.                                                            |
| `history`                              | Every change, oldest first: `{ at, state, note, progress, owner }`. The first is the start; the last matches the note's state and `updatedAt`. |

**Roles:** `managing-editor`, `scout`, `reader`, `typesetter`, `etsu` (Etsu, the writer), `etsu-editor` (Etsu's editor), `checker`, from [agent-roles.md](agent-roles.md), and `builder` and `reviewer` for tools work. `etsu` matches the existing `.claude/agents/etsu.md`; the writer's editor is `etsu-editor`, not `editor`, because the process documents call the owner "the editor".

**Stages, in order:** `sourcing`, `reading`, `checking`, `writing`, `pictures`, `layout`, `upload`, `published`. Why these eight: they are the jobs in [process/README.md](../process/README.md), each with its own process document (reading, checking, writing and glossary, pictures, export, upload), plus the scout's sourcing before them and `published` after the upload, when the working files are retired ([decision 0052](../decisions/0052-what-a-finished-book-keeps.md)). The stages in [FLOW.md](../FLOW.md) are steps inside reading and checking, too fine for a board; a compilation is assembled at `layout`. The order is the usual order of the work, though writing and pictures often run beside reading.

**A book's current stage**, as the Workroom shows it: the earliest stage that still has a live run (working, waiting or stale), because a book is not past a stage still being worked; when nothing is live, the furthest stage with any run, with that run's outcome. Each stage that has runs is listed with its latest run, so "where does it stand?" is answered stage by stage, as [agent-roles.md](agent-roles.md) asks.

## Where the notes live on the shelf

`work/runs/<yyyy-mm>/<yyyy-mm-dd>-<book>-<role>-<id>.json`, with `no-book` for a run with no book; the month and day are the run's start, in UTC. The rule is in `src/core/sync/work-paths.ts`, beside the rest of the shelf map. One file per run means no two agents ever write the same file; the random id makes the name unique even for two runs that start in the same second on the same book in the same role, and `start` refuses to write over an existing file. Sharding by month keeps each folder well under the 1,000 entries GitHub's contents listing returns.

The command checks the file name against the note inside it when reading, so a note copied or renamed by hand is reported, not believed.

**Proposed lines for the shelf's `CLAUDE.md`**, for the main session to add under "What is where" (this branch does not edit the shelf):

```markdown
- `work/runs/<yyyy-mm>/`: the status notes, one JSON file per run of an agent: who, which book, what stage, how far, what it needs from the owner, whom it handed to. Written only by the tools' `node scripts/work.mjs`, never by hand; committed with the work they describe. The Workroom screen reads them.
```

and under "Working files": "`work/runs/`: the status notes (written by `work.mjs`)."

## The command

`node scripts/work.mjs <verb>` with `--shelf <dir>` (default: `$SHELF`, then the shelf checked out beside the tools, then `~/Public-Domain-Books-Storage`). It writes only into a shelf (a folder with `books/`), refuses any folder inside the tools repository, checks every note with the core parser before writing it, and never commits or pushes: the session commits its notes with its work.

- `start --role <role> --book <folder> --stage <stage> --job "<words>"` (`--from <run>`, `--of <n> --unit <word>`, `--note`): prints the new run's id.
- `progress <id>` (`--done <n> --of <m> --unit <word>`, `--note`): also returns a waiting run to working.
- `ask <id> --what "<what the owner must do>" --where <shelf path>` (repeatable; `"Label=path"` to name it).
- `done <id> --result "<one line>"` (`--file <shelf path>`, repeatable).
- `fail <id> --result "<why>"`.
- `handoff <id> --to <role> --result "<one line>"` (`--run <id>`, `--note`, `--file`).
- `list` (`--book`, `--role`, `--json`): the three Workroom lists. `show <id>` (`--json`): one run and its timeline.

## The reader

`workroom(notes, now)` in `src/core/work/workroom.ts` gives:

1. **Waiting on you:** every waiting run, longest waiting first, with what is needed and the links.
2. **Books:** each book's current stage and how it stands, each stage's latest run, its latest runs, and how many of its runs wait on the owner.
3. **Roles:** every role in order, with its runs in progress (stale ones marked), its runs finished in the last seven days, and work handed to it that no run has picked up yet. A hand-off counts as picked up when a later run names it as `from`, or when it named its next run.

`readNotes(files)` parses many files at once, checks each name against its note, and reports unreadable notes and repeated ids separately, so one bad file does not hide the rest.

## Modules touched

- `src/core/work/` (new): the note, its parser and changes, the Workroom reader.
- `src/core/sync/work-paths.ts` (new), exported from `src/core/sync/index.ts`; `shelf.ts` is not touched.
- `scripts/work.mjs` (new), with `scripts/lib/work-shelf.mjs` (the shelf side: finding it, reading and writing notes) and `scripts/lib/work-print.mjs` (the wording); `scripts/lib/tools-guard.mjs` (new), the "inside the tools repository" refusal, now shared with `scripts/storage.mjs`.
- `docs/process/sessions.md`, `docs/process/README.md`, `docs/reference/commands.md`, `docs/architecture.md`, the root and folder `CLAUDE.md` files.
- No change to the app, the layout engine, any export or any book.

## Rules/decisions that apply

- Root `CLAUDE.md`: this repository is public; notes go on the shelf only, and the examples here use made-up books. The core stays pure: times and random ids are handed in by the command.
- [agent-roles.md](agent-roles.md): the roles, and "every hand-off goes through the shelf".
- [process/README.md](../process/README.md): a note never says a book is checked or ready to upload; only the readiness report does. A checker's note links to that report.
- `docs/product.md`, "Never": an agent asks the owner, it never decides for him; the `ask` verb is that question, with the link to the sheet.

## Out of scope

- **The Workroom screen itself** (step 3): reading the notes over GitHub, the light and the dark-and-gilded look, links that open a sheet in the app.
- Clearing a waiting note from the app when the owner answers: today the agent or the managing editor moves it on with `progress` or `done`.
- Committing and pushing the notes: the session does that with its work.
- Writing notes automatically from the other commands (`drive.mjs`, `readiness.mjs`).

## What the Workroom (step 3) will still need

- **Reading the notes over GitHub.** The app lists `work/runs/`, then each month folder, then fetches each note: one request per note. For speed it should take the whole tree in one request (GitHub's trees API) and fetch only the notes it shows. A waiting note can be months old, so it cannot simply read the last month or two.
- **Opening a link.** A link is a path on the shelf; the app decides how to open each kind (the questions sheet in the query screen, a Markdown sheet as text, a PDF in its viewer).
- **The owner's answer.** When he rules in the app, the run stays waiting until its agent or the managing editor moves it on. The Workroom may want to show "answered, not yet picked up" by comparing the ask's time with the sheet's last change.
- **Who is "you".** The views are written for one owner; other people working on it later would need the ask to name whom it waits on.
