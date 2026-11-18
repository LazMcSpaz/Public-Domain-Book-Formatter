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

| Job                                                      | Document                           | Role that runs it                                   |
| -------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Start a session, load and save books, push               | [sessions.md](./sessions.md)       | every session, whatever its role                    |
| Get the text right, leaf by leaf, against the page       | [reading.md](./reading.md)         | reader (OCR cleaner)                                |
| Check the read text against itself, the scan and a second reading | [checking.md](./checking.md) | scan checker                                       |
| Write the introduction, notes and other signed prose     | [writing.md](./writing.md)         | researcher, writer, fact-checker, plain-language reader |
| Make or revise a glossary                                | [glossary.md](./glossary.md)       | writer, plain-language reader                       |
| Cut, place, source, trace and check pictures             | [pictures.md](./pictures.md)       | image tracer, image checker                         |
| Lay the book out and write the PDF and EPUB              | [export.md](./export.md)           | format checker                                      |
| Prove the exact files and prepare the KDP listing        | [upload.md](./upload.md)           | publisher                                           |
| Build one volume out of several separately read works    | [compilation.md](./compilation.md) | compiler                                            |

The roles are not yet separate agents, except the writer, which is the `etsu`
agent ([.claude/agents/etsu.md](../../.claude/agents/etsu.md)). Making each
role an agent definition is planned. Today one session often plays several
roles. Where a document says a check is done by a reader who did not do the
work, that is not optional: give it to a fresh subagent.

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
about those. One command that runs the whole list on the exact files and
writes a dated report is task 1 of the [cleanup plan](../cleanup-plan.md);
until it exists, the lists are run by hand, command by command.

## The rule about reporting

**Never tell the owner a book is checked or ready to upload without the check
results.** This is the owner's biggest frustration so far: books called done
that turned out to have a dictionary check never run, or OCR breaks left at
page turns.

So every report of a book's state lists each check by name with one of three
results:

- **passed**, with the date and the file it ran on;
- **failed**, with what it found and what is being done;
- **NOT CHECKED**, with the reason (it does not apply to this shape, the tool
  for it does not exist yet, it was not run).

A check marked "(proposed check)" in these documents is not automated. It
counts as NOT CHECKED unless someone did it by hand and recorded how; then
report it as "passed, checked by hand". Anything that did not run is named NOT
CHECKED, out loud. A book with any NOT CHECKED item is not called checked or
ready to upload unless the owner, told exactly what was not checked, says to
go ahead.

A report looks like this:

```
The Lost Keys of Masonry: readiness, 2026-11-20
Interior: books/<dir>/The-Lost-Keys-of-Masonry.pdf (commit abc1234)
  C1  damage --check ................. passed
  C3  page turns ..................... passed (2 findings cropped, both as printed)
  C4  coverage ....................... NOT CHECKED: no second reading on the shelf
  R1  spelling on the interior ....... passed: sheet read, 4 words fixed
  R7  cover page count ............... failed: covers made for 212 pages, interior 216
Not ready to upload: R7 failed, C4 not checked.
```

Record the same lines in the book's `ledger.md` under a dated heading. (A
dated check sheet per role, `review/checks/<date>-<role>.md`, is planned once
the shelf is reorganised.)
