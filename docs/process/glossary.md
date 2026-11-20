# Glossary: making or revising one

## Purpose

Write, cut, check and circle a glossary, the method the editor settled on the
Hall collection in October 2026. A reader meets a word, sees the small circle
after it, turns to the back and finds what the word means and what it means
**in this author**. That is the whole job. Two kinds of work use the same
stages: a new glossary (start from a list of terms, one per line) and a pass
over an existing one (start from the glossary in `book.json`).

## Who runs it

- **Etsu**, researcher and writer: the `etsu` agent
  ([.claude/agents/etsu.md](../../.claude/agents/etsu.md)). Drafts the cut
  list, builds the evidence packets, writes the entries (one run per packet
  of about thirty), merges them into each round's draft, answers Etsu's
  editor's notes, and lands the text and circles once approved. The packets
  and the entries written from them are kept in the book's `drafts/` folder,
  so that Etsu's editor works from the same evidence.
- **Etsu's editor**: the `etsu-editor` agent
  ([.claude/agents/etsu-editor.md](../../.claude/agents/etsu-editor.md)).
  Runs every checking pass on each round's draft of the whole glossary (the
  merge check, the audit, flatness, plain language, the quotations and facts
  against the packets, the entry rules) and writes round notes. It never
  edits the draft.
- **The owner** decides the cut list, approves the glossary and decides every
  fact-check flag.
- The **typesetter** re-exports the book once the glossary is landed
  ([.claude/agents/typesetter.md](../../.claude/agents/typesetter.md)).
- The **managing editor** launches each run with only its files and carries
  the cut list, drafts and flags to the owner.

In this document "the editor" is the owner; the agent that checks the drafts
is always called Etsu's editor. The rounds follow [writing.md](./writing.md):
drafts, notes and answers in the book's `drafts/` folder, at most three
rounds.

## Rules for every entry

- **Blavatsky is the tradition's voice** for Theosophical and occult terms.
  The entry rests on her own definition, stated plainly as the teaching; where
  the author departs from her, one sentence says so, as a difference and not
  an error.
- **Written for the reader, not a reviewer**: no comparison of sources, no
  spelling debates, no dates of scholarship, no list of who else used the
  word. A fact earns its place by helping the reader read the author's
  sentence. Most entries 40 to 120 words; nothing over 150.
- **Quote exactly or not at all**, character for character from the packet.
- **Name people in full** the first time, with a few words on who they are;
  never a pronoun before the reader has met the name.
- The editorial stance and the "never tell the reader what to read next" rule
  of [writing.md](./writing.md) apply in full. Where this document and the
  voice card (`voice/etsu-t-dhent.json` on the shelf, sections PLAIN READING
  and GLOSSARIES) disagree, the card wins.

## Before you start

- The book is read and loaded from the shelf ([sessions.md](./sessions.md)).
- Work in a scratch directory, not `/tmp` paths someone else might share.
- The `etsu` and `etsu-editor` agents were loaded at session start
  (otherwise see the fallback in
  [README.md](./README.md#what-a-definition-locks-and-what-it-does-not)).
- Three released books carry glossaries older than this method:
  _Clairvoyance and Occult Powers_, _The Human Aura and The Astral World_ and
  _Thought Vibration_. _The Human Aura_ and _The Astral World_ are released
  only as the combined volume, so their separate folders are not worked on.

## Steps

1. **G1, the cut list** (Etsu). First run the circle check, which lists
   entries whose words the body never prints:
   `npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> <work>/batch.json`.
   Its `absent` lines are not automatically cuts: an entry kept for browsing
   carries no circle, and must never get one on some other word. Then sort the
   rest into the editor's categories (on Hall: everyday words and period slang
   cut; passing references to famous stories and mainstream religion cut;
   unexplained steps of a list cut; old medicine and science kept; a word the
   author gives an occult sense kept) and **put the list to the editor with
   counts. Never cut silently.**
2. **G2, the evidence** (Etsu), one packet per entry:
   `npx vite-node --config vitest.config.ts scripts/glossary-packets.ts <book.json> --shelf ~/Public-Domain-Books-Storage --out <book-dir>/drafts/glossary-packets [--terms terms.txt]`.
   Each packet holds the current entry, Blavatsky's _Theosophical Glossary_
   entry (her spellings folded in), passages from her other books, and the
   author's own uses. `index.md` lists the entries she does not define: read
   those hardest, since they rest on the author and general knowledge alone.
   A spelling no rule folds takes `--alias <Term>=<Spelling>`. A dateless
   person entry reads as two words; give people dates.
3. **G3, the writing pass** (Etsu). One run per packet, each given
   `docs/briefs/glossary-plain.md` (the editor's Hall notes in his words, and
   the entry rules). Each returns `{ "<Head>": "<b>Head.</b> …" }` for every
   entry in its packet; one also writes `"__preamble__"` (G6). Each reply is
   kept as `drafts/glossary-replies/out-<k>.json`, `<k>` being its packet's
   number.
4. **G4, merge into the round's draft** (Etsu):
   `npx vite-node --config vitest.config.ts scripts/glossary-merge.ts <book.json> --out <book-dir>/drafts/glossary-round-<n>.txt --packets <book-dir>/drafts/glossary-packets [--drop "<Head>" …] <book-dir>/drafts/glossary-replies/out-*.json`,
   with a `--drop` for each cut on the owner's cut list.
   It refuses an entry for a head the glossary lacks or one not opening on its
   own `<b>Head.</b>`, and reports every quotation of five words or more no
   packet carries, entries over 150 words, long dashes and a preamble whose
   count is wrong. Etsu fixes what it reports by changing the replies (the
   preamble included, under `__preamble__`) and merging again, never by
   editing the draft. Etsu may run the audit below before handing the draft
   in; only Etsu's editor's run counts. Commit the draft with the packets and
   the replies it was merged from.
5. **G5, Etsu's editor's checks and notes**, over the whole glossary at once:
   - the merge again, from the same packets, replies and cut list, written
     to its own scratch folder so Etsu's draft is never overwritten:
     `glossary-merge.ts` as in G4 with `--out <scratch>/glossary-merge.txt`,
     then `diff <scratch>/glossary-merge.txt <book-dir>/drafts/glossary-round-<n>.txt`.
     Read its report; any difference from the draft means the draft was
     changed after the merge, and is a note;
   - the audit:
     `node scripts/voice.mjs audit <book-dir>/drafts/glossary-round-<n>.txt --name "Etsu T. Dhent" --shelf ~/Public-Domain-Books-Storage`;
   - **read the doctrinal entries end to end for flatness**;
   - **the plain-language pass**, given `docs/briefs/glossary-oblique.md`. It
     hunts one class only: lines that make the reader work out the point (the
     knowing close, irony, a hinted judgement, a metaphor for a claim, a
     pronoun reaching back past another name). No word list stands in for
     this pass; the class needs a reader;
   - every quotation and fact against the packets, and the rules for every
     entry above.

   It writes `drafts/glossary-round-<n>-notes.md`, as
   [writing.md](./writing.md) step 9 says: each note the entry, the sentence,
   the problem and the rule; the fact-check flags for the owner; the checks
   run; and one of its three verdicts (passes, goes round again, does not
   pass after three rounds).

   **Revise and go round** (Etsu): answer every note in
   `drafts/glossary-round-<n>-answers.md`, giving the old sentence and the
   new for each plain-language note (the record of the pass for the shelf),
   change the replies in `drafts/glossary-replies/`, merge again as round
   n+1, and back to G5. **At most three rounds**: a draft that passes, or one
   whose round 3 verdict is "does not pass after three rounds", goes to the
   owner through the managing editor with the notes.

6. **G6, the preamble**, two short paragraphs: what the circle means and how
   many entries there are; that the author's usage is his own and the entry
   says where he parts from Blavatsky. Name her in full the first time
   ("Helena Petrovna Blavatsky, a founder of the Theosophical Society"), then
   "Blavatsky", never "her".
7. **G7, land the text, then the circles** (Etsu, once the owner has
   approved the glossary):

   ```bash
   node scripts/drive.mjs section glossary --from <book-dir>/drafts/glossary-round-<n>.txt
   node scripts/drive.mjs save <book.json>
   npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> <work>/circles.json
   node scripts/drive.mjs correct --batch <work>/circles.json
   node scripts/drive.mjs save <book.json>
   ```

   For a new glossary, add the section in the app's galley first: no verb
   creates a section. Every entry the book uses gets one circle, on its first
   use in prose.
   Crowded is allowed: a circle beside another is better than an entry nothing
   points at (editor's ruling). Never a circle on a heading (it would travel
   into the running head and the contents) or on a word that is not the
   headword's own. **Read every `placed` line before the batch lands**: a word
   with two senses takes the circle on whichever comes first ("a fair medium
   sample"), so take a wrong one out and place it by hand. People are matched
   as names, by surname. **A cut leaves circles behind**: the same run removes
   every circle no entry claims and lists each as `REMOVED`; run it after
   every cut.

8. **G8, finish** as for any change to a book: save, regenerate the readable
   files (`node scripts/book-files.mjs <book-dir>` rewrites `glossary.md`), and
   make one commit of `book.json` and the readable files. The re-export is the
   typesetter's and is never committed ([export.md](./export.md), step 8).
   The managing editor records in `ledger.md` what the cut list removed, how
   many entries were rewritten, how many quotations the merge flagged and what
   was done about each, and how many circles were placed.

## Checks that must pass

- `glossary-merge.ts` reports no unexplained quotation, no entry over 150
  words, no long dash, a correct preamble count.
- Etsu's editor's last round notes say the glossary passes, or it went to the
  owner after round 3 with every round's notes; every fact-check flag decided
  by the owner.
- `voice.mjs audit` on the glossary exits 0, or every flag was read and
  decided (C10 in [checking.md](./checking.md)).
- `node scripts/drive.mjs finish <book-dir>` reports no `glossary mark missing`
  (C7).
- `node scripts/book-files.mjs --shelf <shelf>/books/` shows the book has the
  apparatus the last comparable one got (C9).
- Asked out loud and answered in Etsu's report, for the ledger: does every
  entry for a word the book uses have a mark on that word? Does any entry
  tell the reader where to go next? Has this book got the apparatus the last
  one got?

## What it produces and where it goes

The glossary as a `section` edit and its circles as text edits in `book.json`;
`glossary.md` regenerated; the cut list beside the book; the packets, the
replies, the drafts, round notes and answers (with the plain-language pass's
old and new sentences) in its `drafts/` folder; a ledger entry with the
numbers above.

## Never

- Never cut an entry without the editor's decision.
- Never put a circle on a heading or on a word that is not the headword's.
- Never quote from memory; a remembered quotation reads right and is in
  neither book.
- Never add a fact the packet does not carry.
- Never let the writer do the plain-language pass on its own lines; Etsu's
  editor does, and notes them for Etsu to rewrite.
- Never build a word list in place of the plain-language pass.
- Never let Etsu's editor edit the draft, and never go round a fourth time.
