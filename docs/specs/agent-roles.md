# Spec: the shelf's agents, one role each

_Proposed 19 November 2026, from the owner's answers the same day. Not yet approved._

## What it does (plain English, for the owner)

The work on each book is split among a small team of agents, each with one job, a written brief, only the tools that job needs, and a clear hand-off on the shelf. You stay publisher and editor-in-chief: you rule on the questions, approve sample pages and the final upload pack, and press the upload button. Nothing else needs you.

The team is kept small on purpose, because every extra agent costs tokens:

1. **Managing editor.** The chat session you talk to. It plans, hands out the work, tracks where every book stands, prepares the KDP listing pack, keeps the shelf tidy (storage, retiring a finished book's working files, backups) and reports to you. It does not do the hands-on work itself.
2. **Scout.** Finds, compares and downloads source material (scans, reference copies, pictures) from the libraries, checks rights, and starts the book's catalogue record.
3. **Reader.** Corrects the text against the page images, a batch of pages at a time. Several readers can work on one book at once.
4. **Typesetter.** Cuts and traces the pictures, lays the book out in the house look, and makes the covers and the EPUB.
5. **Etsu, the writer.** Researches and writes the introduction, the notes and the glossary, in the editor's voice.
6. **Etsu's editor.** Checks every draft of Etsu's against what we aim for and what we avoid: the voice card, the banned phrasing, the bias audit, the "Never" list, the facts against the named sources, and plain language. It sends Etsu specific notes, and the two go round again until the draft passes. Only then does it come to you. To keep the cost in check, after three rounds a draft that still does not pass comes to you with the editor's notes rather than going round forever.
7. **Checker.** The independent gate for everything else: the checks on the text, the checks on the pictures, and the readiness check on the exact files that go to KDP. It never fixes anything, it only reports, and only its report can call a book "checked" or "ready to upload".

When the tools themselves need changing, a **builder** and a separate **reviewer** do it, as on 19 November 2026; they are not part of the standing team.

## The rules the team works by

- **No agent checks its own work.** The checker and Etsu's editor are always different agents from the ones that made the thing, and they report rather than fix.
- **Each role's brief is its process document** (`docs/process/`), so the rules are written once. Each agent definition (`.claude/agents/<role>.md`) points to its brief and lists the tools it may use.
- **Each role gets only the tools it needs.** A reader cannot publish; the checker cannot edit the text; nobody but the managing editor writes to the KDP listing sheet.
- **Every hand-off goes through the shelf:** the book's `ledger.md` (who did what, and what the check said), the questions sheet, the readiness report, the drafts. Any agent can pick up where another stopped, and the owner can see it all.
- **Editorial decisions are the owner's.** Agents raise questions with suggested answers and never decide them (`docs/product.md`, "Never").
- **Tokens are spent where judgment is needed.** The writing and its checking use the strongest model; reading, typesetting and checking use a faster, cheaper one, revisited after the pilot. Each agent is handed only its brief and the files for its task, never a whole history. Readers work at most four at a time; the writing loop stops at three rounds.

## Done when (how we'll know it works; how the owner can try it)

- The owner approves this spec.
- The seven role definitions exist in `.claude/agents/`, each pointing to its process document, and `docs/process/README.md`'s role column names them.
- **The pilot:** _Clairvoyance and Occult Powers_ goes from where it stands to "ready to upload" through the team. The readiness report is the only verdict given. We record, for comparison with how books were done before: how long it took, the rounds in the writing loop, how many questions reached the owner, and what the checker caught.
- **The owner tries it:** asks the managing editor "where does _Clairvoyance_ stand?" and gets each stage, who did it and what the check said; and receives the introduction only after Etsu's editor has passed it.

## Modules touched

- `.claude/agents/`: six new role definitions beside `etsu.md` (the managing editor is the session itself, guided by `docs/process/sessions.md`).
- `docs/process/`: `README.md`'s role table; `writing.md` gains the writer and editor loop; small changes where a document names a role.
- No change to the app, the layout engine or the shelf's layout.

## Rules/decisions that apply

- `docs/product.md`: the "Never" list, above all never calling a book ready without the full readiness check, and never taking a decision that is the editor's.
- Root `CLAUDE.md`: the hard rules; this repository is public, so the agent definitions hold instructions only, never book text.
- `docs/process/README.md`: the three words for a book's state, and "a check done by a reader who did not do the work is not optional".
- `product.md`'s future direction "Other people working on it: roles defined as agents, rules written down, checks automatic", which this begins.

## Out of scope (next, with their own specs)

- **The materials ecosystem.** Tools that let the scout search and download from archive.org, HathiTrust, Google Books and Wikimedia Commons, record where each file came from and its rights statement, and put it in storage. The cloud environment may need those sites allowed first.
- Running roles on a schedule (the weekly backup, a shelf health check).
- Marketing copy, listing images, and tracking sales and reviews.
