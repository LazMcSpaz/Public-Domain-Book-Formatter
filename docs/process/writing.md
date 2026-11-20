# Writing: the introduction, the notes, the editor's prose

## Purpose

Write what this edition adds to the book in the editor's voice, Etsu T.
Dhent: the introduction, the footnotes, any afterword or preamble. The prose
introduces the author and the book truthfully and warmly, and every draft is
checked by an agent other than the writer before the owner sees it. (The
glossary has its own method: [glossary.md](./glossary.md).)

## Who runs it

- **Etsu**, researcher and writer: the `etsu` agent
  ([.claude/agents/etsu.md](../../.claude/agents/etsu.md)). Builds the
  research brief, the only source of facts; writes every draft; answers
  Etsu's editor's notes.
- **Etsu's editor**: the `etsu-editor` agent
  ([.claude/agents/etsu-editor.md](../../.claude/agents/etsu-editor.md)).
  Runs every checking pass on each draft (the notes check, the fact-check,
  the bias audit, the voice card and the "Never" lists, flatness, plain
  language) and writes round notes. It never edits a draft.
- **The owner** approves the prose and decides every fact-check flag.
- The **managing editor** launches each run with only its files, carries
  drafts and flags to the owner, and writes the ledger.

In this document "the editor" is the owner, whose pen name is Etsu T. Dhent.
The agent that checks the drafts is always called Etsu's editor.

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
- **The `etsu` and `etsu-editor` agents load only at the start of a
  session.** If one was added or changed mid-session, either start a new
  session or point a general-purpose agent at its file and tell it to adopt
  it.
- **Gather what the editor marked while reading**:
  `node scripts/drive.mjs reading --tag intro --json` (and `--tag note`,
  `--tag glossary`). These are the passages he actually stopped at, and they
  are the brief, not evenly spaced extracts.

## Steps

Drafts and notes live in the book's `drafts/` folder on the shelf, one set
per piece (`introduction`, `notes`, `edition-note` and the like):

- `drafts/<piece>-round-<n>.txt`: Etsu's draft for round n, in the notation
  of `etsu.md`. Notes are `drafts/notes-round-<n>.json`, the list
  `voice.mjs check` reads (`{ "blockId", "anchorText", "text" }` each).
- `drafts/<piece>-round-<n>-notes.md`: Etsu's editor's notes on it, ending in
  a verdict.
- `drafts/<piece>-round-<n>-answers.md`: Etsu's answer to each of those
  notes, written with the next round's draft.

1. **Research brief** (Etsu). Write `research-brief.md` in the book's
   folder on the shelf: every fact about the author, the book and the people
   and events it names, each graded (Firm, Likely, Uncertain, Contested) with
   its sources, under the sources rule above. A fact not in the brief does not
   go in the prose.
2. **Draft** (Etsu). The managing editor hands Etsu the brief and the reading
   marks, nothing more. It writes in the voice rather than being argued into
   it afterwards, and writes round 1. Notes are sparing, for what a reader of
   the period knew and a reader now does not; a note is not a definition
   (definitions are the glossary's). Judge the notes by what they hang on:
   when nine in ten hang on proper names, the reader's own stopping places
   were not used. Etsu may run steps 3 and 5 on its own draft before handing
   it in, to save a round; only Etsu's editor's run counts.
3. **Check the notes mechanically** (Etsu's editor). Make the body with
   `node scripts/drive.mjs body` (its result names the `body.json` it wrote),
   or with no driver
   `npx vite-node --config vitest.config.ts scripts/body-of.ts <book.json> <body.json>`,
   then `node scripts/voice.mjs check <notes.json> <body.json>`. Any
   `ANCHOR NOT FOUND` is a note pointing at nothing; every `check:` item is a
   date, figure or name the book itself never states, and must be in the brief.
4. **Fact-check** (Etsu's editor). Every claim against the research brief and
   the sources it names. It flags what it cannot confirm, with the choices
   (cut, soften, or keep as a joke), for the owner to decide, and removes
   nothing itself.
5. **Bias audit** (Etsu's editor):
   `node scripts/voice.mjs audit <book.json> --name "Etsu T. Dhent" --shelf ~/Public-Domain-Books-Storage`
   (or any prose file in place of the book). It reports every hedge on a
   sentence about the tradition, the hedge ratio overall and over definitions
   only, dismissals, banned phrasing, reading directions, long dashes and a
   reading grade. A non-zero exit means every flagged passage is read. Each
   hedge is decided: kept on a contested claim or a single-witness story,
   taken off doctrine. Etsu fixes the draft in the next round and the audit is
   run again; never loosen the audit to make a draft pass.
6. **The voice card and the "Never" lists** (Etsu's editor). The draft
   against the voice card (`voice.mjs card`, as in "Before you start"), the
   "Never" list of [product.md](../product.md) and the one at the end of this
   document.
7. **Read for flatness** (Etsu's editor). The audit cannot see it. Read the
   doctrinal passages end to end and ask whether they sound written by someone
   who finds the material alive. Any that do not are noted for Etsu to
   rewrite.
8. **Plain-language pass** (Etsu's editor), with the brief
   `docs/briefs/glossary-oblique.md`, which works on an introduction or notes
   as well as a glossary: every line that hints, riddles or points back past
   another name is noted, for Etsu to rewrite so it says the point, keeping
   the life in it.
9. **Round notes and verdict** (Etsu's editor), in
   `drafts/<piece>-round-<n>-notes.md`. Each note gives the sentence, the
   problem and the rule it breaks; the fact-check flags stand in a section of
   their own, for the owner; the checks run are listed with what each said.
   The verdict is **passes** (no note left for Etsu) or **goes round again**.
10. **Revise** (Etsu). Answer every note in `drafts/<piece>-round-<n>-answers.md`
    (what changed, or why the sentence was kept) and write round n+1. Back
    to step 3.
11. **At most three rounds.** A draft that passes goes to the owner through
    the managing editor. One that has not passed after round 3 goes to him
    too, with every round's notes and answers, rather than going round again.
    The fact-check flags always go to him, whatever the verdict.
12. **The owner approves**, and decides each flag. A memo asking for prose is
    answered with a proposal in its resolution, never a landed edit.
13. **Land the prose** (Etsu, once approved). A note:
    `node scripts/drive.mjs annotate <blockId> --after "<phrase>" note.txt --id <id>`
    (the phrase must occur once in the block; the same `--id` replaces it;
    `annotate drop <id>` removes it). An introduction or afterword: no verb
    creates a section yet, so add it in the app's galley (Edit the book), then
    replace its text with `node scripts/drive.mjs section <id> --from intro.txt`
    (`section` alone lists the sections; `--was … --now …` amends one phrase).
14. **Keep the voice card the source** (the managing editor, on the owner's
    word). A note the editor accepted can teach the voice:
    `node scripts/voice.mjs learn --passage "…" --note "…" --name "Etsu T. Dhent" --shelf <shelf>`.
    A change to the voice goes into the card first (`voice.mjs set`,
    `voice.mjs avoid`), then `.claude/agents/etsu.md` is changed to say the
    same; never change only one.
15. **Finish as any change to a book**: save, re-export, regenerate the readable
    files (`node scripts/book-files.mjs <book-dir>` rewrites `introduction.md`
    and `notes.md`), one commit ([export.md](./export.md)). Etsu saves and
    regenerates; the re-export is the typesetter's.

## Checks that must pass

- `node scripts/voice.mjs audit …` exits 0, or every flagged passage was read
  and the editor signed off, recorded in the ledger (C10 in
  [checking.md](./checking.md)).
- `node scripts/voice.mjs check <notes.json> body.json`: no `ANCHOR NOT FOUND`,
  every `check:` item found in the research brief.
- Etsu's editor's last round notes say the draft passes, or it went to the
  owner after round 3 with every round's notes.
- Etsu's editor's fact-check flags each decided by the owner.
- No working note left in the prose (C11 in [checking.md](./checking.md)).
- `node scripts/book-files.mjs <book-dir> --check` exits 0.

## What it produces and where it goes

`research-brief.md` beside the book, and the drafts, round notes and answers
in its `drafts/` folder, on the shelf;
the introduction as a `section` edit and the notes as note edits in
`book.json`; `introduction.md` and `notes.md` regenerated from it; a ledger
entry, written by the managing editor, naming who wrote, who checked, how
many rounds it took and what the audit said.

## Never

- Never assert or quietly deny the truth of the tradition; never hedge a
  doctrine.
- Never let a writer judge its own even-handedness; the audit and Etsu's
  editor do.
- Never use a fact that is not in the research brief, or rest one on
  Wikipedia alone.
- Never let Etsu's editor edit a draft or delete; it notes and flags, and
  Etsu rewrites.
- Never go round a fourth time; after round 3 the draft goes to the owner.
- Never tell the reader what to read next, and never describe the edition's
  method in its prose.
- Never put a working note such as "(delete)" in a block's or a section's
  text; a message for a later step is a memo.
- Never land prose the editor asked for in a memo; propose it.
