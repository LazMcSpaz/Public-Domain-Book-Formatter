# Glossary: making or revising one

## Purpose

Write, cut, check and circle a glossary, the method the editor settled on the
Hall collection in October 2026. A reader meets a word, sees the small circle
after it, turns to the back and finds what the word means and what it means
**in this author**. That is the whole job. Two kinds of work use the same
stages: a new glossary (start from a list of terms, one per line) and a pass
over an existing one (start from the glossary in `book.json`).

## Who runs it

- **Researcher**: builds the evidence packets.
- **Writer**: the `etsu` agent, one per packet of about thirty entries.
- **Plain-language reader**: a different reader, over the whole glossary.
- The coordinating session merges, lands and circles; the **editor** decides
  the cut list.

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
- The `etsu` agent was loaded at session start (otherwise point a
  general-purpose agent at `.claude/agents/etsu.md`).
- Three released books carry glossaries older than this method:
  _Clairvoyance and Occult Powers_, _The Human Aura and The Astral World_ and
  _Thought Vibration_. _The Human Aura_ and _The Astral World_ are released
  only as the combined volume, so their separate folders are not worked on.

## Steps

1. **G1, the cut list.** First run the circle check, which lists entries whose
   words the body never prints:
   `npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> <work>/batch.json`.
   Its `absent` lines are not automatically cuts: an entry kept for browsing
   carries no circle, and must never get one on some other word. Then sort the
   rest into the editor's categories (on Hall: everyday words and period slang
   cut; passing references to famous stories and mainstream religion cut;
   unexplained steps of a list cut; old medicine and science kept; a word the
   author gives an occult sense kept) and **put the list to the editor with
   counts. Never cut silently.**
2. **G2, the evidence**, one packet per entry:
   `npx vite-node --config vitest.config.ts scripts/glossary-packets.ts <book.json> --shelf ~/Public-Domain-Books-Storage --out <work>/packets [--terms terms.txt]`.
   Each packet holds the current entry, Blavatsky's _Theosophical Glossary_
   entry (her spellings folded in), passages from her other books, and the
   author's own uses. `index.md` lists the entries she does not define: read
   those hardest, since they rest on the author and general knowledge alone.
   A spelling no rule folds takes `--alias <Term>=<Spelling>`. A dateless
   person entry reads as two words; give people dates.
3. **G3, the writing pass.** One writer per packet, each given
   `docs/briefs/glossary-plain.md` (the editor's Hall notes in his words, and
   the entry rules). Each returns `{ "<Head>": "<b>Head.</b> …" }` for every
   entry in its packet; one also writes `"__preamble__"`.
4. **G4, the plain-language pass, separately**, by a reader that did not write
   the glossary, over the whole of it, given `docs/briefs/glossary-oblique.md`.
   It hunts one class only: lines that make the reader work out the point (the
   knowing close, irony, a hinted judgement, a metaphor for a claim, a pronoun
   reaching back past another name). It returns only the entries it changed,
   and a `changes.md` of old and new sentences for the shelf. No word list
   stands in for this pass; the class needs a reader.
5. **G5, merge and check**:
   `npx vite-node --config vitest.config.ts scripts/glossary-merge.ts <book.json> --out <work>/glossary.txt --packets <work>/packets [--drop "<Head>" …] out-1.json out-2.json …`.
   It refuses an entry for a head the glossary lacks or one not opening on its
   own `<b>Head.</b>`, and reports every quotation of five words or more no
   packet carries, entries over 150 words, long dashes and a preamble whose
   count is wrong. Then audit:
   `node scripts/voice.mjs audit <work>/glossary.txt --name "Etsu T. Dhent" --shelf ~/Public-Domain-Books-Storage`,
   and **read the doctrinal entries end to end for flatness**.
6. **G6, the preamble**, two short paragraphs: what the circle means and how
   many entries there are; that the author's usage is his own and the entry
   says where he parts from Blavatsky. Name her in full the first time
   ("Helena Petrovna Blavatsky, a founder of the Theosophical Society"), then
   "Blavatsky", never "her".
7. **G7, land the text, then the circles**:

   ```bash
   node scripts/drive.mjs section glossary --from <work>/glossary.txt
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

8. **G8, finish** as for any change to a book: save, re-export, regenerate the
   readable files (`node scripts/book-files.mjs <book-dir>` rewrites
   `glossary.md`), one commit. Record in `ledger.md` what the cut list removed,
   how many entries were rewritten, how many quotations the merge flagged and
   what was done about each, and how many circles were placed.

## Checks that must pass

- `glossary-merge.ts` reports no unexplained quotation, no entry over 150
  words, no long dash, a correct preamble count.
- `voice.mjs audit` on the glossary exits 0, or every flag was read and
  decided (C10 in [checking.md](./checking.md)).
- `node scripts/drive.mjs finish <book-dir>` reports no `glossary mark missing`
  (C7).
- `node scripts/book-files.mjs --shelf <shelf>/books/` shows the book has the
  apparatus the last comparable one got (C9).
- Asked out loud and answered in the ledger: does every entry for a word the
  book uses have a mark on that word? Does any entry tell the reader where to
  go next? Has this book got the apparatus the last one got?

## What it produces and where it goes

The glossary as a `section` edit and its circles as text edits in `book.json`;
`glossary.md` regenerated; `changes.md` from the plain-language pass and the
cut list beside the book; a ledger entry with the numbers above.

## Never

- Never cut an entry without the editor's decision.
- Never put a circle on a heading or on a word that is not the headword's.
- Never quote from memory; a remembered quotation reads right and is in
  neither book.
- Never add a fact the packet does not carry.
- Never let the writer do the plain-language pass on its own lines.
- Never build a word list in place of the plain-language reader.
