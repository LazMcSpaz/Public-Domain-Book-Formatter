# Brief: say it plainly — a pass over a glossary for oblique lines

Hand this file to a reader that did **not** write the glossary, with the whole
glossary at once. See docs/PROCESS-glossary.md, Stage G4. Fill in **the input
path** and **the output path** in the task you give alongside it.

The same pass works on an introduction or a set of notes: give it the text,
and ask for the changed paragraphs instead of entries.

---

## The editor's note, in his words

> "At the end of your first entry for Adept, you have a line that says someone
> who told you that he is an Adept has told you what he is, or something along
> those lines. It's making the implication that they're telling you what they
> truly are, and that's not an Adept. But I don't like your style of writing
> when you do that. Those implications sometimes come off as confusing rather
> than actually informative. So we could just plainly say something like,
> someone who has said he is an adept has just revealed to you that he is not.
> It doesn't need to be super simple and boring, but it also doesn't need to
> be confusing. Treat that as a class of issue that I want addressed
> throughout the whole glossary."

## The class

Any sentence that makes the reader work out the point instead of stating it:

- **the wry, knowing close**: "…has told you what he is", "…and that is the
  whole of it", "…which says something", "…and leaves it there", "…gives it
  an address";
- **understatement or irony** that relies on the reader catching a tone;
- **a hinted judgement**: "sits badly with", "is worth noticing", "readers may
  draw their own conclusion";
- **a riddle or aphorism** whose literal meaning is not its meaning;
- **a metaphor standing in for a claim**: "rides that tide", "the tradition
  gave it work to do";
- **a pointer that sends the reader hunting**: a pronoun, "the same", "that
  sense" or "his" reaching back past another name, or naming someone by
  pronoun before the reader has met them.

Rewrite each one so it says the point directly, **keeping the life in it**.
Plain is not flat: lose the riddle, keep the warmth.

## Before and after, from the Hall glossary

All 24 are in `glossary-plain-pass.md` in the Hall collection's directory on
the shelf. These are the ones that show the class best.

| Entry                    | Before                                                                                                             | After                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adept                    | a man who announces himself as one has told you what he is.                                                        | a man who announces himself as an adept has shown, by announcing it, that he is not one.                                                                          |
| Devachan                 | He takes Blavatsky's gloss, the dwelling of the gods, and gives it an address.                                     | He takes Blavatsky's gloss, the dwelling of the gods, literally: where her Devachan is a state, his is a region of the astral plane where the gods actually live. |
| St. Germaine             | which sits badly with Hall's story of his demanding respect from Napoleon.                                         | and if that entry is right, Hall's story of his demanding respect from Napoleon cannot be true.                                                                   |
| Dweller on the Threshold | and the tradition gave it work to do.                                                                              | and occultists then took the novelist's phrase into their own teaching as the name of a real stage of the path.                                                   |
| Ductless glands          | His account of the pineal and the pituitary rides that tide, and he was far from the only one riding it.           | His account of the pineal and the pituitary belongs to that enthusiasm, which he shared with a great many other writers of the time.                              |
| Blavatsky                | Neither settles what she taught.                                                                                   | Neither report settles whether what she taught is true.                                                                                                           |
| Scottish Rite            | In this book it is mostly an address.                                                                              | In this book it appears mostly as a place.                                                                                                                        |
| Ingersoll                | Hall's quarrel, like his, is with                                                                                  | Hall's quarrel, like Ingersoll's, is with                                                                                                                         |
| Shriner                  | The Shrine's own meetings are a good deal more festive. He reads them as Mysteries anyway, as he reads everything. | The Shrine's own meetings are convivial rather than mystical, but Hall reads its imagery as a Mystery all the same, as he does with every tradition he touches.   |
| Root race                | The scheme ranks as well as dates                                                                                  | The scheme does not only place the races in time, it ranks them                                                                                                   |

Notice what the "after" column does: it names the subject ("Blavatsky's",
"Ingersoll's" instead of "her", "his"), states the consequence the "before"
only hinted at, and replaces the figure of speech with what it stood for. It
is usually a little longer. That is the right trade.

## What not to touch

Anything outside this class. No other rewording, no shortening, no new facts,
quotations unchanged. Read every entry; this is a whole-glossary pass, not a
sample. Err toward fixing: if a line made you pause to work out what it meant,
it is in the class.

## Input and output

- Input: the glossary, paragraphs separated by blank lines, the preamble
  first and then entries each starting `<b>Head.</b>`.
- Output: a JSON object `{ "<Head>": "<the whole revised entry, starting
<b>Head.</b>>" }` with **only** the entries you changed, and
  `"__preamble__"` if you changed the preamble. It goes straight to
  `scripts/glossary-merge.ts`.
- Beside it, a `changes.md`: for each changed entry, the old sentence and the
  new one, in the shape of the table above. It goes on the shelf as the
  record of the pass.
- Run `node /home/user/Public-Domain-Book-Formatter/scripts/voice.mjs audit
<a .md of your changed entries> --name etsu-t-dhent` and fix what it flags.

Reply with the number of entries changed and the audit line.
