# PROCESS — a glossary, made or revised

How a glossary for a book on this shelf is written, cut, checked and circled.
It is the method the editor settled on the Hall collection in October 2026
(`books/ManlyPalmerHall-CollectedManuscriptLectures-7qk2m4` on the shelf),
written down so the next glossary starts from it rather than from memory.
PROCESS-edition.md, Stage 13, sends you here.

Two kinds of job use it, and the stages are the same for both:

- **A new glossary.** Start from a list of terms, one per line.
- **A pass over an existing glossary.** Start from the glossary in
  `book.json`. As of this writing three released books have one that
  predates the method: _Clairvoyance and Occult Powers_ (126 entries), _The
  Human Aura and The Astral World_ (73) and _Thought Vibration_ (41). _The
  Human Aura_ and _The Astral World_ are released only as that combined
  volume (the editor, 7 October 2026), so their separate directories on the
  shelf are not books to work on, glossaries included.

Where the rules come from: the voice card (`voice/etsu-t-dhent.json` on the
shelf, sections PLAIN READING and GLOSSARIES) and `.claude/agents/etsu.md`,
which is the card compiled into a writer. This file is the order of work and
the tools; the card is the voice. If they disagree, the card wins and this
file is wrong.

## What a glossary here is for

A reader meets a word, sees the circle after it, turns to the back and finds
what the word means and what it means **in this author**. That is the whole
job. Each entry is written for that reader, not for a reviewer: no comparison
of sources, no spelling debates, no dates of scholarship, no list of who else
used the word. A fact earns its place by helping the reader read the author's
sentence.

For Theosophical and occult terms, **Blavatsky is the tradition's voice.** The
entry rests on her own definition, stated plainly as the teaching, and where
the author departs from her it says so in one sentence, as a difference and
not an error.

## Stage G1 — The cut list

Before anything is written, decide what does not belong. Run the circle check
first, because it lists the entries for words the body never uses:

```bash
npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> /tmp/batch.json
```

Its `absent` lines are entries whose own words the body never prints. They
are not automatically cuts: the editor keeps such an entry for readers who
browse the glossary (Auric egg and Colour healing on _The Human Aura and The
Astral World_), and it simply carries no circle. What it must never get is a
circle on some **other** word ("egg-shaped" for Auric egg), because a reader
who follows that circle to the back does not find the word they left.

Then sort the rest into the categories the editor ruled on for Hall, and put
the list to him with counts. **Never cut silently**: the list is his decision,
and he moved several entries between categories.

| Category                                                                           | Ruling on Hall                                               | Examples                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Everyday words, and period slang that reads clearly in its sentence                | **Cut**                                                      | Tommyrot, Bunkum, Mayhaps, Wastrel, Grifters                 |
| Famous stories, figures and mainstream religious terms used as passing comparisons | **Cut**                                                      | Rip Van Winkle, Dante, Phoenix, Trinity, Purgatory           |
| Steps of a list the author himself does not explain                                | **Cut**, keeping the steps he discusses                      | Calcination, Fixation (cut); Putrefaction, Projection (kept) |
| Old medicine and science a modern reader may not follow                            | **Kept** (except a word no reader needs, like Electron)      | Apoplexy, Protoplasm, Delirium tremens                       |
| A word the author gives an occult sense of his own                                 | **Kept**                                                     | Profane, Neophyte, Daemon                                    |
| An entry whose only use can carry no circle                                        | **Kept, and given a circle where it does occur** (a caption) | Scottish Rite                                                |

A mainstream term stays when the author uses it in a sense of his own; say
that sense, and only that.

Land cuts through the merge script (Stage G5), `--drop "<Head>"` per entry.

## Stage G2 — The evidence: one packet per entry

```bash
npx vite-node --config vitest.config.ts scripts/glossary-packets.ts <book.json> \
  --shelf ~/Public-Domain-Books-Storage --out /tmp/packets [--terms terms.txt]
```

Each packet carries, for one entry (`glossaryPacket`, `@core/annotate`):

- `current`: the entry as it stands (none for a new glossary);
- `definitions`: Blavatsky's _Theosophical Glossary_ entry headed by the
  word. Her spellings are folded in: diacritics (`Mahâtma`), her
  transliteration (`Âkâsa` for akasha), closed compounds (`Mûlaprakriti`), a
  variant in brackets (`Atmâ (or Atman)`), a head that runs past the word
  (`Kundalini Sakti`), and a variant named in an entry's first line
  (`Arahat … also written Arhat`);
- `elsewhere`: up to three passages each from _The Key to Theosophy_, _The
  Secret Doctrine_ I and II, and _Isis Unveiled_ I and II;
- `authorUses`: the author's own sentences, circled uses first.

`index.md` beside the packets lists the entries she defines and the ones she
does not. **The second list is the one to read hardest**: those entries rest
on the author and general knowledge alone.

A spelling no rule can fold (the author learnt the word from a different book
than hers) takes `--alias <Term>=<Spelling>`. Cabbalist→Kabalist,
Aryan→Ârya and Daemon→Daimon are built in.

On Hall the packets found her own entry for 66 of 133 terms. The other 67 are
mostly people, places, medicine and Masonry, which her glossary does not
cover.

## Stage G3 — The writing pass

One writer per packet, about thirty entries each, given
`docs/briefs/glossary-plain.md`. Use the `etsu` agent where the session has it
(it is loaded at session start; otherwise point a general-purpose agent at
`.claude/agents/etsu.md` and tell it to adopt it). The brief carries the rules
the editor gave on Hall, in his words.

Each writer returns `{ "<Head>": "<b>Head.</b> …" }` for every entry in its
packet, plus `"__preamble__"` from one of them.

## Stage G4 — The plain-language pass, separately

A **different** reader, over the whole glossary at once, given
`docs/briefs/glossary-oblique.md`. It hunts one class only: lines that make
the reader work out the point instead of stating it. It changes nothing else.

This pass is separate on purpose. The writer of a line cannot see that it is
oblique: it reads as wit to the person who meant it. On Hall it changed 24 of
133 entries **after** the writing pass had been audited clean. The old and
new form of each is on the shelf in `glossary-plain-pass.md`, and those pairs
are the best description of the class there is.

**No lexical check stands in for this pass, and none was built.** Measured on
Hall: a word list made from the 24 old lines would find those 24 and nothing
new, and a rule flagging a pronoun before a name in its paragraph flagged
three paragraphs of the introduction the editor had approved. Both would be
tests of their own training data. The class needs a reader.

## Stage G5 — Merge, and the deterministic checks

```bash
npx vite-node --config vitest.config.ts scripts/glossary-merge.ts <book.json> \
  --out /tmp/glossary.txt --packets /tmp/packets [--drop "<Head>" …] out-1.json out-2.json …
node scripts/voice.mjs audit /tmp/glossary.txt --name etsu-t-dhent
```

The merge refuses a rewritten entry for a head the glossary does not have, or
one not opening on its own `<b>Head.</b>`. It reports, for reading:

- **every quotation of five words or more that no packet carries**
  (`quotesNotInPacket`). Quote Blavatsky or the author exactly or not at all;
  a quotation written from memory reads right and is in neither book;
- entries over 150 words;
- long dashes;
- a preamble whose stated count no longer matches the entries.

The audit catches hedges on doctrine, dismissals, banned phrasing and dashes.
Then **read the doctrinal entries end to end** for flatness, which nothing
mechanical sees: an entry so dry that nobody who read it would want to try
anything has failed.

## Stage G6 — The preamble

Two short paragraphs:

- what the circle means, and how many entries there are;
- that the author's usage is his own, and that where he parts from Blavatsky
  the entry says so.

Name her in full, and say in a few words who she is, the first time: "Helena
Petrovna Blavatsky, a founder of the Theosophical Society, whose books lie
behind much of what Hall teaches". Then "Blavatsky" and "Blavatsky's", never
"her" or "hers" for someone the reader met a paragraph ago or not at all. The
same rule holds for anyone an entry names.

## Stage G7 — Land the text, then the circles

```bash
node scripts/drive.mjs section glossary --from /tmp/glossary.txt
node scripts/drive.mjs save <book.json>        # the circle script reads the file
npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> /tmp/circles.json
node scripts/drive.mjs correct --batch /tmp/circles.json
node scripts/drive.mjs save <book.json>
```

`load` the book from the shelf first, as for any edit, and never `save` a book
you did not load this session.

Every entry the book uses gets one circle, on its first use in prose
(`placeMissingMarks`). **Crowded is allowed**: the editor ruled that a circle
beside another is better than an entry nothing points at. A circle is never
put on a heading, because it would travel into the running head and the
contents, and never on a word that is not the headword's own (see Stage G1).

**A cut leaves circles behind.** The same run takes out every circle in prose
no entry claims (`withoutStrayMarks`) and lists each as `REMOVED`; on _The
Human Aura and The Astral World_ it found `red-light°` still standing after
Red-light district had been cut. Run it after every cut.

**Read every `placed` line before the batch lands.** A word with two senses
takes the circle on whichever comes first: on _Clairvoyance_ the spiritualist
Medium was placed on "a fair medium sample". Take a wrong one out of the batch
and place it by hand. People are matched as names (`isPersonHeadword`): the
headword `Surname, Given (dates)` is looked for by surname, capitalised, and
not as another man's first name (Balfour Stewart is not Arthur Balfour).

## Stage G8 — Finish

As for any change to a book (CLAUDE.md, _The order that keeps them
together_): write `book.json`, re-export the PDF, regenerate the readable
files (`book-files.mjs`, which rewrites `glossary.md`), and push it all in one
commit. `node scripts/drive.mjs finish <book-dir>` checks the circles
(`glossary mark missing`) with the rest.

Record in the book's `ledger.md` what the cut list removed, how many entries
were rewritten, how many quotations the merge flagged and what was done about
each, and how many circles were placed.
