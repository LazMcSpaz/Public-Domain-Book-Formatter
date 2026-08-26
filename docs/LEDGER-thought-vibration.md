# Reading ledger — _Thought Vibration_

161 leaves of scan, all 161 accounted for. 129 carry text this edition prints:
the Preface, Foreword and My Working Creed (17), the analytical contents (5),
and the sixteen chapters (107). The other 32 are the Google notice, the cover,
eleven blanks, eleven leaves of the publisher's advertisements, the title and
copyright pages read for metadata, and the Stanford library plate.

## The readers

| Reader           | What it is                                                                                       | Independent of                |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| Ours             | Tesseract off the 300-dpi render, shaped by `@core/draft`, corrected leaf by leaf against pixels | —                             |
| Internet Archive | The archive's own OCR of the same scan, one HTML file per leaf, supplied as an EPUB              | our engine, not our pixels    |
| The modern reset | "The Secret Edition", a born-digital PDF of the same text with different line breaks             | our engine **and** our pixels |
| The book itself  | Its own usage elsewhere, wherever a compound or a spelling was in doubt                          | every reading of any one leaf |

archive.org was unreachable: this container's network policy answers 403 to it,
so the scan and both further readings came from the editor.

**What was supplied is not what it looked like.** The PDF handed over as "the
scan" is a modern re-typesetting in Palatino and Papyrus with no page images at
all, and it turned out to be an abridging, altering derivative: it drops "as
well as have the others" from chapter I, sets "bringing" for "bring", and
silently mends four of this printing's compositor's errors. It is a useful
fourth witness and it is not a copy-text. The real scan arrived separately.

## What each check raised, and what survived

| Check                                           | Raised | Real | As printed / theirs | Became a query |
| ----------------------------------------------- | ------ | ---- | ------------------- | -------------- |
| Ours against the Internet Archive, leaf by leaf | ~380   | ~380 | —                   | 5              |
| `consistency` over the assembled book           | 5      | 1    | 4                   | 0 (already up) |
| Ours against the modern reset, 22,184 words     | 73     | 1    | 72                  | 3              |
| `verifyPage` on every landed batch              | 1      | 1    | —                   | 0              |

Agreement with the Internet Archive after correction: every disagreement over
129 leaves was looked at and settled. Agreement with the modern reset over the
sixteen chapters: **0.9869**.

### The consistency pass

Five findings, one real. `workig` was the printer's error already raised from
the pixels; `he teaches`, `fear Fear`, `superior metal` and `all that happens
happens` are all correct as printed. A 1-in-5 hit rate on a free deterministic
check is worth keeping.

### The fourth witness, which earned its place once

Seventy-three disagreements with the modern reset. Seventy-two were its own:
`weighted` for `weighed`, `roads` for `road`, `form` for `from`, `burton` for
`Buxton`, dropped words, and a dozen compounds it normalised that the 1908 book
hyphenates. That is an OCR-grade error rate, and it is how we know the reset is
a derivative rather than a source.

The seventy-third was ours, and it is the reason to run the check at all.
Assembly had joined `thought-` at the foot of page 22 to `habit` at the head of
page 23 and produced **`thoughthabit`**, where the book prints `thought-habit`
with the hyphen four times elsewhere. Every other check was silent: each leaf
read correctly against its own render, both OCR engines agreed with each other,
the per-page cross-check saw nothing, because the two halves are on different
leaves and nothing compared the join to the rest of the book. It is now fixed
in `joinText`, so the next book does not need a fourth witness to catch it.

The reset also corroborated four of the compositor's errors by silently mending
all four, which is evidence that a modern editor read them the same way.

## The queries, and how they were ruled

Ten raised, ten ruled by the editor. Five are compositor's slips read at 600 to
700 dpi: `In` capitalised inside a quotation, `aiong` and `graduaily` with an
`i` sort where an `l` belongs, `ceatures` with the `r` never set, and `workig`
broken across a line with the `n` never set. All five are mended. Two are the
book naming the same chapter differently in its contents and at its head.

**Three are worse, and they are the finding of this book.** Pages 35, 49 and 65
break off in the middle of a sentence, and page 65 in the middle of a word with
the hyphen set and the rest of the page blank. Both machine readings stop at
the same word and the render shows nothing below the line. The copy-text is
defective at three chapter endings. The modern reset supplies the missing words
and is not authority for them.

The rulings on those five, and on the two disagreeing chapter names, are in
`rulings.md` on the shelf. Four were answered by telling the reader rather than
by mending the page: the three defective endings keep their gaps and carry a
footnote naming what the reset supplies, and chapter II keeps both of its names,
`Power` in the contents and `Process` at its head, with a footnote on the
chapter's first page. Chapter XI's head was brought into line with its contents
entry instead, a difference of one word and one letter, and is the only place in
the book where two disagreeing readings were made to agree rather than both
kept.

**The first drafts of those four notes were written for the wrong reader.** They
explained the reasoning: that choosing one of chapter II's two names "would put a
word into the book that is not in it", that a modern resetting "is evidence of a
reading and not authority for one", that both machine readings of a defective
page stopped at the same word. Every sentence of that is true and none of it is
a reader's business. A note is read by somebody who has just opened the book and
wants to know what happened to the page; the argument for the decision belongs
in `rulings.md`, where an editor will look for it. The notes were rewritten to
say what happened and stop, and the rule is now on the voice card so the next
book does not have to learn it.

**What is claimed for the three gaps, and what is not.** The notes say the fault
is in the printing this edition follows, that it is not the scan's and not this
reading's, and that the same fault falls at the end of three chapters, which
points at the making-up of the edition rather than at damage to one copy. They
do **not** claim that other printings share it, because only one physical
copy was available here: the Internet Archive's reading is of these same pixels,
and the modern reset has the text. Anyone who can reach a second printing should
check it and strengthen or withdraw the wording.

## The apparatus

|                                            |                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Glossary entries                           | 41                                                                               |
| Entries carrying a mark                    | 40 (the forty-first is a name the book never uses)                               |
| Entries the book uses and left unmarked    | **0**                                                                            |
| Editor's footnotes                         | 24                                                                               |
| Notes unplaced                             | 0                                                                                |
| Notes asserting something outside the book | 16, listed in `notes.md`                                                         |
| Author's own footnotes preserved           | 1                                                                                |
| Prose audit                                | clean: no hedge on the tradition, no dismissal, no banned phrasing, no long dash |

## What this book cost the tooling

Six faults, all found by doing the work rather than by review, all fixed with a
test that fails first:

1. **A controller could not answer the term grid at all.** `validAnswer` took
   `Record<string, string>` and a verdict is an object. Refusing the answer is
   not refusing the question: an unanswered grid accepts every row, so plate
   noise went into the book's confirmed vocabulary in silence.
2. **The parser kept its own copy of the page-role list**, and it had drifted:
   `digitization-notice` was in the type and not in the parser, so the one role
   written for the leaf every archive.org scan carries was the one role a batch
   could not use. One list now, derived from the dispositions.
3. **No role described a publisher's advertisement**, and this book binds eleven
   leaves of them. Added, discarding.
4. **`synopsisLooksSound` refused a contents that prints no page numbers**,
   which is what this one is, so Berry's analytical contents was parsed, judged
   unsound and dropped without a word.
5. **The seam hyphen**, above.
6. **A run-in subhead became a chapter** in an analytical contents, taking a
   centred line and a folio between chapters that had descriptions.

And two verbs that had no way to be reached at all: an editor could correct an
introduction they could not write, and could not attach a note. Both books read
before this one carry no notes, and nothing reported it, because the export
counts what it was given.

**A seventh, found only by counting.** One word carried two glossary marks:
`Passive effort°°`, from the mark pass running twice over the same block. Every
check was happy with it. `checkGlossaryMarks` asks whether each entry reaches a
marked occurrence and a doubled circle answers yes; `book-files.mjs` counts the
circles in the edits and had nothing to compare the number against. It surfaced
only when the entry count and the circle count were put side by side: 41 entries,
40 of them reachable, 41 circles. That comparison is not yet a check anywhere,
and it should be — a circle in the running text that no entry accounts for is
exactly the kind of fault a reader finds and a suite does not.

## What is not demonstrated

The reading was done in one session rather than by subagents, so Stage 5's
batching is still unexercised at book scale. What replaced it is the thing that
made it safe: every leaf was corrected against a machine reading of its own
pixels rather than typed from the render, and the parent held one leaf at a
time. The model sense pass of Stage 7 was not run separately; the four-way
witness comparison did its work and can be scored, which a sense pass on this
book could not have been.
