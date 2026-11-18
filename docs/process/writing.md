# Writing: the introduction, the notes, the editor's prose

## Purpose

Write what this edition adds to the book in the editor's voice, Etsu T.
Dhent: the introduction, the footnotes, any afterword or preamble. The prose
introduces the author and the book truthfully and warmly, and its facts are
checked by someone other than the writer. (The glossary has its own method:
[glossary.md](./glossary.md).)

## Who runs it

- **Researcher**: builds the research brief, the only source of facts.
- **Writer**: the `etsu` agent ([.claude/agents/etsu.md](../../.claude/agents/etsu.md)).
- **Fact-checker**: a second reader who checks every claim against the brief.
- **Plain-language reader**: a different reader who finds lines that make the
  reader work out the point.

## The editorial stance

The shelf is occult and esoteric books and will stay so. A writer on this
material brings a lean whether asked or not: "astral body" gets a warier
register than "endocrine gland", and a reader absorbs which is which without
an argument being made. The standing rule: **it is nobody's place to assert
the absolute truth of these things, and equally nobody's place to quietly deny
it.** Hand the reader what they need to find out for themselves. Four habits,
each checkable:

- **State the established teaching plainly.** The editor holds the tradition's
  teaching to be true and writes it so, while respecting the scientific method
  as how anyone gets to the bottom of anything. He is not an arbitrator
  between two parties, so do not hedge both sides equally. "Supposed",
  "so-called" and "said to be" belong on contested claims and single-witness
  stories, never on doctrine.
- **Never push.** No arguing a reader round, no scolding a doubter, no triumph
  when the evidence goes the tradition's way. Set it out and stop.
- **Ancestry is not an argument.** That a term was borrowed, or a doctrine took
  its shape in the 1880s, is history worth giving and settles nothing about
  whether the thing is real.
- **Warmth is not imprecision.** These books invite the reader to try
  something. An entry so flat that nobody would want to try anything has
  failed, and is not more truthful for being duller.

**Editor and reader are both inside the tradition** (editor's ruling, 20
October 2026). The prose introduces the author and the book; it does not
defend, justify or prove the subject.

Four more rules that are easy to break by accident:

- **Never tell the reader what to read next.** Naming the book a quotation
  comes from identifies it; "the best place to go from here" directs, and that
  choice is the reader's.
- **Do not state the method in the reader's prose.** How the edition was made
  is between the editor and whoever makes it. A glossary that announces it
  will not tell you what to read raises a doubt nothing had raised.
- **No long dashes** (em or en) doing the work of a comma. Hyphens in
  compounds are fine.
- **The introduction speaks in the first person singular.** One man is
  speaking; the audit checks the front section for it.

## Sources for anything historical

Editor's ruling, 22 October 2026. A fact about a real person or event rests on
more than one source. Wikipedia is a place to find leads, never the only
support: the editor finds its bias real and not always visible. The
Theosophical sources are always consulted beside the others: theosophy.wiki,
blavatskyarchives.com, theosophical.org, ts-adyar.org,
theosociety.org/pasadena, the ULT sites and theosophy.world. Where their
account differs from another, the brief gives both, graded Contested, each
with its best source. This applies to research briefs, glossary evidence and
every fact-check.

## Before you start

- The book is read, and preferably checked ([checking.md](./checking.md)).
- **Read the voice card**:
  `node scripts/voice.mjs card --name "Etsu T. Dhent" --shelf ~/Public-Domain-Books-Storage`.
  Without `--name` it refuses (the shelf holds two card files). Without
  `--shelf`, run from the formatter, it silently prints an empty default card.
- **The `etsu` agent loads only at the start of a session.** If it was added
  or changed mid-session, either start a new session or point a
  general-purpose agent at `.claude/agents/etsu.md` and tell it to adopt it.
- **Gather what the editor marked while reading**:
  `node scripts/drive.mjs reading --tag intro --json` (and `--tag note`,
  `--tag glossary`). These are the passages he actually stopped at, and they
  are the brief, not evenly spaced extracts.

## Steps

1. **Research brief** (researcher). Write `research-brief.md` in the book's
   folder on the shelf: every fact about the author, the book and the people
   and events it names, each graded (Firm, Likely, Uncertain, Contested) with
   its sources, under the sources rule above. A fact not in the brief does not
   go in the prose.
2. **Brief the writer.** Hand `etsu` the verified facts from the brief and the
   reading marks. It writes in the voice rather than being argued into it
   afterwards. Notes are sparing, for what a reader of the period knew and a
   reader now does not; a note is not a definition (definitions are the
   glossary's). Judge the notes by what they hang on: when nine in ten hang on
   proper names, the reader's own stopping places were not used.
3. **Land the prose.** A note:
   `node scripts/drive.mjs annotate <blockId> --after "<phrase>" note.txt --id <id>`
   (the phrase must occur once in the block; the same `--id` replaces it;
   `annotate drop <id>` removes it). An introduction or afterword: no verb
   creates a section yet, so add it in the app's galley (Edit the book), then
   replace its text with `node scripts/drive.mjs section <id> --from intro.txt`
   (`section` alone lists the sections; `--was … --now …` amends one phrase).
4. **Check the notes mechanically.** `node scripts/drive.mjs body body.json`,
   then `node scripts/voice.mjs check <notes.json> body.json`, where
   `notes.json` lists each note as `{ "blockId", "anchorText", "text" }`. Any
   `ANCHOR NOT FOUND` is a note pointing at nothing; every `check:` item is a
   date, figure or name the book itself never states, and must be in the brief.
5. **Fact-check** (a second reader, not the writer). Every claim against the
   research brief. It flags what it cannot confirm for the editor to decide
   and removes nothing itself.
6. **Bias audit**:
   `node scripts/voice.mjs audit <book.json> --name "Etsu T. Dhent" --shelf ~/Public-Domain-Books-Storage`
   (or any prose file in place of the book). It reports every hedge on a
   sentence about the tradition, the hedge ratio overall and over definitions
   only, dismissals, banned phrasing, reading directions, long dashes and a
   reading grade. A non-zero exit means a person reads every flagged passage.
   Decide each hedge: keep it on a contested claim or a single-witness story,
   take it off doctrine. Fix the draft and run it again; never loosen the
   audit to make a draft pass.
7. **Read for flatness.** The audit cannot see it. Read the doctrinal passages
   end to end and ask whether they sound written by someone who finds the
   material alive. Rewrite any that do not.
8. **Plain-language pass** (a reader who did not write it), with the brief
   `docs/briefs/glossary-oblique.md`, which works on an introduction or notes
   as well as a glossary: lines that hint, riddle or point back past another
   name are rewritten to say the point, keeping the life in them.
9. **The editor approves.** A memo asking for prose is answered with a
   proposal in its resolution, never a landed edit.
10. **Keep the voice card the source.** A note the editor accepted can teach
    the voice: `node scripts/voice.mjs learn --passage "…" --note "…" --name "Etsu T. Dhent" --shelf <shelf>`.
    A change to the voice goes into the card first (`voice.mjs set`,
    `voice.mjs avoid`), then `.claude/agents/etsu.md` is changed to say the
    same; never change only one.
11. **Finish as any change to a book**: save, re-export, regenerate the readable
    files (`node scripts/book-files.mjs <book-dir>` rewrites `introduction.md`
    and `notes.md`), one commit ([export.md](./export.md)).

## Checks that must pass

- `node scripts/voice.mjs audit …` exits 0, or every flagged passage was read
  and the editor signed off, recorded in the ledger (C10 in
  [checking.md](./checking.md)).
- `node scripts/voice.mjs check <notes.json> body.json`: no `ANCHOR NOT FOUND`,
  every `check:` item found in the research brief.
- The fact-checker's flags each decided by the editor.
- No working note left in the prose (C11 in [checking.md](./checking.md)).
- `node scripts/book-files.mjs <book-dir> --check` exits 0.

## What it produces and where it goes

`research-brief.md`, drafts and pass records beside the book on the shelf;
the introduction as a `section` edit and the notes as note edits in
`book.json`; `introduction.md` and `notes.md` regenerated from it; a ledger
entry naming who wrote, who checked and what the audit said.

## Never

- Never assert or quietly deny the truth of the tradition; never hedge a
  doctrine.
- Never let a writer judge its own even-handedness; the audit and a second
  reader do.
- Never use a fact that is not in the research brief, or rest one on
  Wikipedia alone.
- Never let the fact-checker delete; it flags.
- Never tell the reader what to read next, and never describe the edition's
  method in its prose.
- Never put a working note such as "(delete)" in a block's or a section's
  text; a message for a later step is a memo.
- Never land prose the editor asked for in a memo; propose it.
