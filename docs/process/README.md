# How book work is done

One document per job. Each says who runs it, what must be true before it
starts, the steps, the checks that must pass with their exact commands, what it
produces, and the rules that prevent the mistakes already made.

Read [sessions.md](./sessions.md) first, every session. Then the document for
the job in hand.

Three other places this folder leans on rather than repeats:

- [FLOW.md](../FLOW.md) says which stages a book of a given shape goes through
  (a scan, a scan with an OCR layer, somebody's OCR with no pixels, typeset
  text). `node scripts/drive.mjs book` reports the shape and route of the book
  that is open.
- [commands.md](../reference/commands.md) is the full command reference.
- [product.md](../product.md) holds the short "Never" list that every job here
  obeys, and [still-works.md](../still-works.md) is the owner's checklist.

## The jobs

| Job                                                               | Document                           | Role that runs it                                                                            |
| ----------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Start a session, load and save books, push                        | [sessions.md](./sessions.md)       | every session, whatever its role                                                             |
| Find, compare and fetch sources; start a new book                 | [sourcing.md](./sourcing.md)       | scout                                                                                        |
| Get the text right, leaf by leaf, against the page                | [reading.md](./reading.md)         | reader                                                                                       |
| Check the read text against itself, the scan and a second reading | [checking.md](./checking.md)       | checker (a reader makes the corrections its findings call for)                               |
| Write the introduction, notes and other signed prose              | [writing.md](./writing.md)         | Etsu (research and drafts) and Etsu's editor (every check)                                   |
| Make or revise a glossary                                         | [glossary.md](./glossary.md)       | Etsu and Etsu's editor                                                                       |
| Cut, place, source, trace and check pictures                      | [pictures.md](./pictures.md)       | typesetter, and checker for the picture checks (scout finds added pictures)                  |
| Lay the book out and write the PDF and EPUB                       | [export.md](./export.md)           | typesetter lays out, checker checks                                                          |
| Prove the exact files and prepare the KDP listing                 | [upload.md](./upload.md)           | managing editor (files, listing pack) and checker (readiness); the owner presses the buttons |
| Build one volume out of several separately read works             | [compilation.md](./compilation.md) | typesetter assembles; reader and checker for each part, checker for the whole                |

A compilation is assembled by the typesetter because putting the parts
together is making the book file and its pages, the stage the status notes
call `layout`; its checks stay with the checker, so nobody checks their own
work.

## The team

Each role is an agent, defined in [.claude/agents/](../../.claude/agents/)
under its own name, every one on Opus ([the spec](../specs/agent-roles.md)).
A role's brief is the document named above, read after this folder's
[sessions.md](./sessions.md). The managing editor is the chat session itself
and has no file: it launches a role with the Agent tool and the role's name
(`scout`, `reader`, `typesetter`, `etsu`, `etsu-editor`, `checker`, and
`builder` and `reviewer` for changes to the tools). Claude Code loads the
definitions when a session starts, so a definition added or changed during a
session is used by name only from the next session; until then, point a
general-purpose agent at the file and tell it to adopt it.

Hand each run only its brief and the files of its task, never the book's
whole history: tokens are saved there, not by a smaller model. Run at most
four readers at once. No agent checks its own work: what a role makes is
checked by the checker, Etsu's drafts by Etsu's editor, and a change to the
tools by a reviewer that did not write it. Where a document says a check is
done by a reader who did not do the work, that is the checker, or Etsu's
editor for prose, and it is not optional. The managing editor writes each
book's `ledger.md` from the runs' reports; the roles do not edit it, so runs
working at the same time never write the same file. How the managing editor
runs the team: [sessions.md](./sessions.md#running-the-team-the-managing-editor).

## Status notes: every role, every job

Whatever the job, the role doing it writes a status note on the shelf with
`node scripts/work.mjs`: when it starts, at meaningful points as it goes, and
when it stops (done, failed, handed to another role, or waiting on the owner
with the file he must open). A session playing several roles writes a note
for each, under each role's name. The notes are how the owner sees, in the
app's Workroom, what waits on him, where each book stands and what each role
is doing; they are committed with the work and
never replace the ledger. How and when: [sessions.md](./sessions.md#status-notes-what-you-are-doing-on-the-shelf).
A note never calls a book checked or ready to upload; the readiness report
below is the only verdict, and the checker's note links to it.

## Three words for a book's state

Use only these three words when telling the owner where a book stands. Do not
say "done", "finished" or "ready" on their own.

- **read**: every leaf is transcribed and corrected against the page (or, for
  a book with no page images, against the book's own counted evidence), every
  query raised is with the editor, and the reading is marked complete.
- **checked**: every check that applies to the book's shape has run and
  passed, and the results are recorded in the book's `ledger.md`. The list is
  in [checking.md](./checking.md), items C1 to C12.
- **ready to upload**: the book is checked, and the readiness checks have run
  on the exact files that go to KDP (the interior PDF, the covers, the EPUB)
  and passed. The list is in [upload.md](./upload.md), items R1 to R11.

`node scripts/drive.mjs finish <book-dir>` and
`node scripts/book-files.mjs <book-dir> --finish` are not the readiness check.
They cover the reading, the ledger, the shape, the queries, the readable files,
glossary marks and conversion damage. They do not run page turns, coverage,
the apparatus checks, the spelling check on the exported file, the unprintable
characters report or any check on the covers. A green `finish` says nothing
about those. The command that runs the whole list on the exact files and
writes a dated report is `node scripts/readiness.mjs <book-dir>`
([checking.md](./checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload));
its verdict is the only one to give the owner.

## The rule about reporting

**Never tell the owner a book is checked or ready to upload without the check
results.** This is the owner's biggest frustration so far: books called done
that turned out to have a dictionary check never run, or OCR breaks left at
page turns.

So every report of a book's state lists each check by name with one of four
results, as the readiness command writes them:

- **passed**, with the date and the file it ran on;
- **failed**, with what it found and what is being done;
- **needs a person**, with the sheet or the instructions, and whether it is
  signed off;
- **NOT CHECKED**, with the reason (it does not apply to this shape, the tool
  for it does not exist yet, it was not run).

A check marked "(proposed check)" in these documents is not automated. The
readiness command reports it, with every check a person must do, as NEEDS A
PERSON; it counts only once the person has done it and it is signed off in
`ledger.md` by the line [checking.md](./checking.md) gives. Anything that did
not run is NOT CHECKED, out loud, and blocks the stage. A book with any NOT
CHECKED or FAILED item is not called checked or ready to upload unless the
owner, told exactly what was not checked, says to go ahead.

The report is `readiness.md`, written beside the book by the command: the
files and their fingerprints, one row per check with its result and what it
found, the details, and the verdict. The managing editor notes the verdict
and the date in the book's `ledger.md` under a dated heading, from the
checker's report.

The stories behind these rules, the faults that cost real time on real books,
are kept in `docs/archive/CLAUDE-pre-harness.md`. They are history, not
instructions: where they and these documents differ, these documents and the
code win.
