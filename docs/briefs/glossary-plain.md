# Brief: write glossary entries from their packets

Hand this file to a writer with one packet of entries. It is the brief the
Hall collection's glossary was rewritten from in October 2026, with the
book-specific lines taken out. Fill in the three blanks in the task you give
alongside it: **the book and its author**, **the packet path** and **the
output path**. See docs/PROCESS-glossary.md, Stage G3.

---

You are writing glossary entries for an edition of **[book, by author]**,
in the editor's voice (`.claude/agents/etsu.md`; if you are that agent, you
already have it). For a pass over an existing glossary you are revising, not
starting fresh: keep what a reader needs from the entry as it stands.

## What the editor asked for, in his words

From his notes on the Hall collection, which apply to every glossary:

> "It just kind of feels like you spend too much time explaining … in a way
> that's a little too academic. … People reading this are not scientists
> looking for peer-reviewed papers with bibliographies. They want the
> information in it. … You go into a little bit too much detail and it feels a
> little too robotic or academic. You have this one line that says, you should
> know where the text comes from or something like that. It just feels like
> you're pandering."

And: "Make sure you're using Blavatsky source material in the repo to help
inform your definitions."

## Your packet

A JSON list. Each item has:

- `head`: the headword. Keep it exactly as it is.
- `current`: the entry as it stands, starting `<b>Head.</b>` (absent for a
  new entry).
- `definitions`: Blavatsky's own _Theosophical Glossary_ entry for the term,
  where she has one.
- `elsewhere`: passages where the term stands in _The Key to Theosophy_, _The
  Secret Doctrine_ and _Isis Unveiled_.
- `authorUses`: the author's own sentences where the word stands, circled
  first.

## What each entry does

- **Say plainly what the word means, then what it means in this author**, in
  the fewest words that leave a reader able to read his sentence. Most
  entries 40 to 120 words; a major doctrinal term up to about 150. Nothing
  over 150.
- **Blavatsky is the tradition's voice.** Where she defines the term, build
  the entry on her definition and state it plainly as the teaching. This
  imprint states established doctrine without "supposedly", "so-called" or
  "said to be"; those belong only on contested history and single-witness
  stories. Where the author departs from her, say so in one short sentence,
  as a difference and not an error.
- **Quote exactly or not at all.** A short quotation of her or of the author
  is welcome where it does the work better than paraphrase. Copy it
  character for character from the packet. The merge script checks every
  quotation of five words or more against the packet and reports the ones it
  cannot find.
- **No new facts.** Use only what is in `current` or the packet. If you are
  unsure of something, leave it out. Where scholars and Blavatsky disagree on
  a date, say it is disputed rather than choosing.
- **Keep a fact only if it helps read the author's sentence.** Drop what only
  shows the work: sources compared, spellings debated, dates of scholarship,
  "two things wear the name", "the record does not say", lists of who else
  used the word.
- **Say the point.** No knowing close, no understatement, no irony or
  aphorism whose literal meaning is not its meaning. See
  `docs/briefs/glossary-oblique.md` for the class, with before and after.
- **Name people in full** the first time an entry mentions them, with a few
  words on who they are, and never refer to someone by a pronoun before the
  reader has met them by name.
- **Warm and direct.** No "you should know", no telling the reader what to
  read next, no long dashes (em or en). First person singular only where it
  earns its place, which in a glossary is rarely.
- **Notation.** `<i>…</i>` for book titles and foreign words. Keep the
  headword as `<b>Head.</b>` exactly as given.

## Output

Write a JSON object to the output path:
`{ "<head>": "<b>Head.</b> new text…", … }`, one key per item in your packet,
every item present. If the task asks for the preamble too, put it under
`"__preamble__"`, paragraphs separated by a newline (PROCESS-glossary.md,
Stage G6, says what it must do).

Then write the entries to a `.md` file beside it, one per paragraph, and run

```bash
node /home/user/Public-Domain-Book-Formatter/scripts/voice.mjs audit <that .md> --name etsu-t-dhent
```

Fix what it flags in the prose and run it again. Do not tune anything to make
it pass.

Reply with: the count of entries, total words before and after, the final
audit line, and every entry where Blavatsky and the current entry disagreed
on a fact and what you did about it.
