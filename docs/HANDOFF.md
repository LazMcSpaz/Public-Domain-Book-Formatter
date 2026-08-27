# Handoff: picking up any book on this shelf

For a session starting cold on a book it has never seen. It says where things
are, what is yours to decide and what is not, and what to do first. It does
**not** restate the process: that is
[`PROCESS-reading.md`](./PROCESS-reading.md) for getting the text right and
[`PROCESS-edition.md`](./PROCESS-edition.md) for turning a read book into a
printed one. Two documents saying the same thing is how they start disagreeing.

[`HANDOFF-astral-world.md`](./HANDOFF-astral-world.md) is the same thing
written for one particular book, and is worth reading as a worked example.

---

## 1. The first five minutes, before anything else

**Do not trust what is on disk.** This container reverts both checkouts without
warning, including after a successful push. Run this first, every session:

```bash
for r in ~/Public-Domain-Book-Formatter ~/public-domain-books-storage; do
  git -C $r fetch origin -q
  echo "$r behind $(git -C $r rev-list --count HEAD..origin/main) ahead $(git -C $r rev-list --count origin/main..HEAD)"
done
```

Behind and not ahead: the container rolled you back, `git reset --hard
origin/main`, nothing is lost. Ahead: work exists only here, push it now. This
is not a rare event — it happened seven times in the session that wrote this
document, twice after a successful push, and once while the sync check itself
was running.

**Both repositories have to be present.** The formatter is the session's own
checkout. The shelf is private and may not be attached: if
`~/public-domain-books-storage` is missing, attach it with the `add_repo` tool
(`owner: LazMcSpaz`, `repo: Public-Domain-Books-Storage`, `access: push`),
clone it to that path if the tool says to, and then call `register_repo_root`
so its own instructions load. Nothing else in this document works without it,
because the books live there.

Then read [`CLAUDE.md`](../CLAUDE.md), and in particular **"What has actually
gone wrong"**. Every item in it cost real time on a real book.

## 2. Two repositories, and which is the truth

- **The formatter** (`~/Public-Domain-Book-Formatter`, public) is the app and
  the tooling. Code, tests, `scripts/`, these docs.
- **The shelf** (`~/public-domain-books-storage`, private) is the books. It is
  **the source of truth**; the browser's IndexedDB is a cache of it.

On the shelf:

| Path                        | What it is                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| `books/<Book-id>/book.json` | The book. Transcription, edits, apparatus, answers, voice.                        |
| `books/<Book-id>/*.pdf`     | The **exported** edition. Not the scan.                                           |
| `books/<Book-id>/*.md`      | The readable files: corrections, notes, glossary, introduction, queries, rulings. |
| `scans/<sha256>.pdf`        | The **scan**. `book.json` names it in `scan.path`.                                |
| `voice/<pen-name>.json`     | The editor's persona, guidance and avoid list.                                    |

The commonest expensive mistake on this shelf is loading a book's exported PDF
where its scan was wanted. It does not fail; it quietly gives you a second run
and renders the finished edition every time you ask for a leaf.

## 3. The two rules

**A model may propose a reading; only pixels may accept one.** The line is at
the artefact, not the activity. A finding is allowed; a step whose output is
text is not.

**The shelf must describe the book it holds.** `book.json` is the source and
everything else is derived from it. A change is four edits — the book file, the
export, the readable files, one commit — and doing three of them is how the
shelf ends up describing a book it no longer holds.

## 4. What is the editor's, and never yours

- **A printer's error, a self-contradiction, a place where "faithful" and
  "correct" pull apart.** Transcribe as printed, raise a `query`. Never
  silently fix, never silently keep. There is deliberately no field for a
  proposed fix: a suggestion beside a question is an answer in all but name.
- **What the book is called, how it is designed, whether an error is mended.**
  Rulings live in `rulings.md` with the date they were decided. Read it before
  raising something already settled.
- **The voice.** `voice/<pen-name>.json` carries the persona, the guidance and
  the avoid list. Read it before writing a word of introduction, note or
  glossary — or better, hand the facts to the `etsu` subagent
  (`.claude/agents/etsu.md` in the formatter repo), which is the same card as a
  system prompt and writes in the voice rather than being checked against it.
  It is available from the start of a session and not before: an agent
  definition added mid-session cannot be used until the next one. Two rules in it are easy to break by accident: never hedge an
  established teaching, and never tell the reader what to read next. Naming the
  book a quotation comes from identifies it; "the best place to go from here"
  directs, and that choice is the reader's.
- **Do not state the method in the reader's prose.** How the edition was made
  is between the editor and whoever makes it. A glossary that announces it will
  not tell you what to read raises a doubt nothing on the page had raised.

## 5. Before you start a new book, ask for these

A new book cannot begin without them, and guessing any one wastes the whole
run:

1. **The scan**, and confirmation of which printing it is.
2. **Whether this book stands alone or joins others in a volume.**
3. **The imprint details**, if they are not already banked in a saved look.
4. **Anything already ruled** on that edition.

Everything else — trim, face, ornaments, whether chapters open recto — has a
sensible default and can be shown rather than asked.

## 6. Getting a second reader, which is most of the value

A conversation that has read three hundred pages of one author is exactly the
condition under which fluent invention appears. The design answer is to stage
the reading so that every stage after the first is a check on the one before,
and to batch leaves into subagents that see the images, return a transcription
and die, so the parent never holds a page image. `PROCESS-reading.md` has the
detail; the point to carry is that **a reader who never writes unprompted
cannot confabulate a paragraph**, and every arrangement here exists to keep
that true.

## 7. Keep the ledger

Findings raised, confirmed, refuted, per book. A check nobody can score is
worse than no check, because it manufactures confidence. If a sense pass
proposes a hundred and sixty survive the pixels it is earning its place; if
fifteen survive it is noise and should be tightened or dropped.
`LEDGER-astral-world.md` is the shape.

## 8. Before you stop

```bash
npm run typecheck && npm test && npm run lint && npm run format:check
node scripts/book-files.mjs <book-dir> --check
node scripts/voice.mjs audit <book-dir>/book.json
git -C ~/Public-Domain-Book-Formatter rev-list --count origin/main..HEAD   # 0
git -C ~/public-domain-books-storage  rev-list --count origin/main..HEAD   # 0
```

And commit per unit of work rather than per session. Forty tool calls with
nothing committed is forty tool calls this container can take away.

## 9. If you remember one thing

The checks are not there because the tooling is unreliable. They are there
because the failure modes of this particular job are **quiet**: a contents with
no page numbers, a footnote that was never placed, a glossary nothing points
at, a readable file still describing last week's book. Nothing errors. The
report is green. The person who finds it is holding the printed copy.
