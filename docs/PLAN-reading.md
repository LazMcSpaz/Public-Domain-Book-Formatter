# Plan: the reading pass

The editor reads the book before annotating it. That pass is where the
footnotes are chosen and where the introduction gets its material, and it is
the one part of making an edition that this app has never held: it happens in
a reading app on an iPad, and the highlights made there cannot come back out.
So the reading is done twice — once for real, once from memory at the moment a
note has to be written — and the second one is the one the book is built from.

Nothing underneath has to change for this. A highlight is an anchored record in
the edit list that cannot print, which is what a `memo` already is; the galley
already renders the whole book as one scrolling column; the shelf already
carries the edit list in `book.json`. What is missing is a **record** for a
marked passage, a **harvest** that turns an evening's reading into the brief
for the annotation pass, and a **surface** that is comfortable to read three
hundred pages in.

## Why, measured

The editor's complaint is that the notes and the introductions are not good
enough. That is a judgment, but there is a fact underneath it, and it was worth
finding before building anything.

_Clairvoyance and Occult Powers_ carries **23 footnotes across 328 leaves** —
one every fourteen leaves, with a 45-leaf stretch carrying none. They are
evenly spread front to back, so this is not the summarise-the-last-twenty
drift. What they are hung on is the finding:

> Roentgen. Marconi. Crookes. The Society for Psychical Research. The Creery
> sisters. Kant. Leadbeater. Vodou. The pineal gland. The willing game. The
> _Strathmore_. Michelson and Morley. Oliver Lodge. Cazotte. Spencer Perceval.
> The mango trick. Elliott Coues. Dion Fortune. Kahuna. Christian Science.

**Twenty-two of the twenty-three are hung on a proper name.** Every one is a
named entity a model recognises on sight and can write a paragraph about
without being asked twice. The notes are individually good — accurate, in
voice, properly hedged where they should be. They are also, as a set, a list of
the things the annotator already knew.

What is not there is everything a _reader_ stops at: an argument that does not
follow, a term used forty pages before it is defined, an exercise whose
instructions cannot be carried out as written, a claim that contradicts one
three lessons earlier, a passage that is simply hard. None of those is a named
entity, none of them can be found by scanning for hooks, and none of them got
a note.

The introduction has the same shape for the same reason: it is written from the
book's structure plus evenly spaced extracts, because a model handed three
hundred pages summarises the last twenty. Evenly spaced extracts are a
sampling of the book. They are not a reading of it.

**So the deficiency is not in the writing. It is in the selection, and
selection is the editor's to make.** That is the whole argument for this plan,
and it is the thing to score it against: if the next book's notes are still
nine-tenths proper names, the reading pass did not work.

## Why this is not a memo, and not a note

Four anchored things now, and the difference between them is who is waiting.

|               | addressed to             | waits on            | prints |
| ------------- | ------------------------ | ------------------- | ------ |
| **query**     | the editor               | a decision          | no     |
| **memo**      | the assistant            | a resolution        | no     |
| **highlight** | the editor's future self | the annotation pass | no     |
| **note**      | the reader               | nothing             | yes    |

A memo is an _ask_: it is open until somebody answers it, and its resolution is
a ledger. A highlight asks nothing. It is a place the editor thought was worth
coming back to, and its whole value is that there will be two hundred of them
in document order when the notes pass starts. Resolving them one at a time is
the wrong shape; harvesting them all at once is the right one.

A highlight is also a **range** where a memo is a point. `PLAN-editor.md`
Stage 4 parked that ("memos on regions rather than points — still waiting on a
real book to prove points too coarse"), and this is the real book proving it —
so **memos gain an optional range here too**, on the same machinery, rather
than two anchoring schemes existing side by side. A footnote hangs off a point,
so `note` stays a point. A highlight is the words, because without the words
the harvest is a list of numbers nobody can read.

### The fourth button is a comment, not a fourth tag

An earlier draft had a `check` tag. It was wrong, and the table above is why.
"There is an errant full stop in the middle of this sentence" is mechanical,
checkable work addressed to the assistant and waiting on a resolution — which
is the definition of a memo, a channel that already exists, is already swept by
`drive.mjs memos`, and already records what was done. A fourth tag would have
been a second inbox to sweep, and CLAUDE.md is explicit about what happens to
an apparatus with two of anything: it gets done for one book and skipped for
the next.

So the reading surface offers four buttons over three record types, and the
editor need not care which is which:

| button                   | record                    |
| ------------------------ | ------------------------- |
| **Needs a note**         | highlight, tag `note`     |
| **For the introduction** | highlight, tag `intro`    |
| **A term to define**     | highlight, tag `glossary` |
| **Comment**              | memo, with a range        |

"Comment" is the word the galley already uses for a memo, chosen in Stage 1½
for being the word a Google Docs user already has. The reading surface uses it
for the same reason.

## The line, restated once

**A highlight can never print.** Structural, not filtered: `applyEdits` skips
the kind entirely, the way it skips a memo, so there is no path from a
highlight to the layout engine at all. A reader's marginal note appearing in a
book for sale is the failure this feature must make impossible, and "we filter
it at export" is not impossible.

**A highlight is not a note, and promotion is an act.** It is tempting to make
a `note`-tagged highlight simply _become_ a footnote — one less step, and the
tag already says so. That would be wrong, and the editor confirmed the reading
that makes it wrong: a highlight is _a place needing more attention_, not a
verdict. The marked passage is not the note's prose, and everything that makes
an annotation trustworthy here — the voice card, `checkProposals` against the
book's own text, `auditProse` — sits in the annotation pass that a promoted
highlight would walk straight past. So the harvest _briefs_ the notes pass. It
does not seed it.

**Reading mode cannot edit, and the way out is deliberate.** Two hundred pages
of reading on a touch screen with a caret in the text is an evening of
accidental edits. But an errant full stop is a five-second fix and making the
editor file a comment about it would be silly, so the passage carries an
explicit **"Edit this passage"** that leaves reading mode and opens it in the
galley. Deliberate, reachable, and impossible to trigger by resting a thumb on
the page — which is exactly the property asked for.

**The same rule about text, again.** The reading pass has no pixels in front of
it. So a comment left while reading records the words as the book currently has
them and never carries a proposed correction as though it were settled: propose
from sense, accept from pixels, and the accepting happens later with the crop.

## The record

A new kind in `BookEdit` (`src/core/edits/book-edits.ts`), beside `memo`:

```ts
| {
    kind: 'highlight'
    highlightId: string
    blockId: string
    /** The marked words, as plain text — no notation. See "coordinates", below. */
    quote: string
    /** Where in the block's plain text they were, when marked. A hint. */
    from: number
    to: number
    /** What the highlight is for. Closed set; the parser refuses anything else. */
    tag: 'note' | 'intro' | 'glossary'
    /** The editor's words about it. Optional: a bare highlight is legitimate. */
    text?: string
    /** ISO date, so a reading session can be seen as a session. */
    madeAt: string
  }
```

and `memo` gains `quote`, `to` — all three optional, so every memo already on
the shelf stays valid and a memo left at a caret in the galley is unchanged.

The places these have to be handled are known exactly, because `memo` maps
them:

- `applyEdits` — `continue`, with the reason in a comment (`book-edits.ts:265`).
- `countEdited` — skipped; a highlight corrects nothing (`:645`).
- `withEdit` collapsible, `targetOf` returns `highlightId` (`:695`, `:722`).
- `parseEdits` in `saved-run.ts:684` — a new case, **schema v16**, refusing an
  unknown `tag` rather than dropping the field. `parsePageTranscription`'s
  lesson: an agent that does the right thing and gets a green report with no
  record is worse than an error.
- `ProofSheet.tsx:236` and `:400` — the two places that ask "is this block
  edited?" and already exclude memos.

### Anchored by the quote, disambiguated by the offset

An **offset** is just a character count: "this note hangs 721 characters into
that paragraph". It is how `note`, `split` and `memo` all say where they are
today, and on its own it rots. Every `text`, `split` or `merge` edit made after
a reading session shifts the characters in that block, so a highlight recorded
at 721 silently comes to name whatever now sits at 721 — which may be the
middle of a different sentence. Nothing warns.

Storing only the marked words fixes that but introduces the opposite fault: a
word highlighted twice in one paragraph has two homes and the search finds the
first.

So **both**, with a stated precedence: the quote locates the highlight, the
offset only picks the occurrence when the quote appears more than once, and
when the two disagree the quote wins and the disagreement is _reported_ in the
harvest. That is `findAnchor`'s existing posture
(`src/core/annotate/schema.ts:167`) — collapse whitespace, one
case-insensitive retry, and no fuzzier than that, because a loose match landing
on the wrong sentence is the failure the function exists to avoid.

`findAnchor` returns only the far end, because a note hangs after its words.
A range needs both. **One implementation:** generalise it to
`findQuote(blockText, quote, near?) → { from, to } | null`, and let
`findAnchor` be its `.to`. Two searchers that can disagree about where a quote
is, is exactly the class of drift this repository keeps closing.

### The coordinates, which mean three different things

The trap named in CLAUDE.md — _check what the coordinates mean before comparing
them_ — is live here, and there are three coordinate systems in one gesture:

1. the **notation** string (`withMarkup`), which is what `body` hands back and
   what a `text` edit must be written in, and which contains `<i>` and `<b>`;
2. the **plain text** (`parseInlineMarkup(raw).text`), which is what a reader
   sees and what `note`, `split` and `memo` offsets are already measured in;
3. the **rendered DOM** from `htmlOfMarkup`, where the selection actually
   happens and whose character offsets are the HTML's, tags included.

A highlight's `quote`, `from` and `to` are all in (2), and the surface's job is
to map a DOM range in (3) back to (2). Storing a quote with `<i>` in it would
make `findQuote` fail on exactly the passages worth marking, since an
italicised book title is what a glossary highlight most often is.

## Stage 1 — the record and the harvest, with no UI at all

Deliberately first, and deliberately complete without a browser. It is pure
core plus a driver verb, so it is fully unit-testable, and it means a reading
session can be conducted from the conversation before there is anywhere to
click. It is also the half that makes an iPad session _recoverable_, which
matters more than the half that makes it pleasant.

- The edit kind, the memo range, and their touch points, above.
- `findQuote`, with `findAnchor` reduced to a call of it.
- `src/core/edits/highlights.ts`, modelled on `memos.ts`:
  `highlightsOf`, `highlightSheet(doc, edits)` returning each highlight in
  document order with the passage it sits in, its source leaves, and its
  **anchor state** — `found` (quote and offset agree), `moved` (quote found
  elsewhere; the offset is stale), or `lost` (quote gone). A lost highlight
  keeps its place in the sheet with the words still readable, never dropped:
  same rule as a lost memo, and for a stronger reason, since the editor's
  reading is the thing that cannot be re-derived.
- `drive.mjs reading` — the sheet as Markdown, `--tag intro` to filter,
  `--json` for briefing an agent. Named `reading`, not `marks`: a _mark_ in
  this codebase is the glossary circle (`withGlossaryMark`,
  `book-files.mjs --marks`), and two meanings of one word in one tool is how
  the apparatus checks got skipped a book at a time.
- `reading.md` on the shelf, written by `book-files.mjs` beside
  `corrections.md` — the readable file, per the rule that a repository is a
  shelf. It makes counted claims, so `--check` covers it and reports drift.

## Stage 2 — the reading surface

A third view beside "Edit the book" and "Check against the scan":
**"Read the book"**. The same scrolling column `BookEditor` already builds —
divisions, body, divisions, set in a book face with italics as italics — but:

- **read-only**, with "Edit this passage" as the deliberate way out, above.
- **select, then choose**: the four buttons of the table, and a field for the
  editor's words. Existing highlights render as background tints, split at
  every boundary so overlapping ones are both visible rather than one silently
  winning.
- **wider leading, a measure that reads, no toolbar.** The outline stays,
  because navigating a book you are reading is the one control that earns its
  place. Where you left off is remembered per book, as the chosen view already
  is.
- **Ctrl+H does nothing here, and neither does Ctrl+I.** A reading mode that
  can change the text is an editing mode with the buttons hidden.

The harvest is reachable from the head of the column: how many highlights, by
tag, and a jump to each.

## Stage 3 — the iPad, and what "an actual app" means

`.github/workflows/deploy.yml` already publishes the app to GitHub Pages on
every push to `main`, and Pages is enabled, so it already runs in Safari at a
URL. Three things stand between that and an app:

- **A web app manifest and an icon.** Added to the Home Screen, the app then
  launches from an icon with no browser chrome, holds its own place in the app
  switcher, and appears in Spotlight — which is what "an actual app" means to
  everyone except the App Store. It also matters for a harder reason: Safari
  deletes script-writable storage for sites without recent interaction, and
  installed web apps are exempt. To be **measured on the device**, not taken
  from documentation — the same posture as the batch-endpoint probe.
- **A reading route that never fetches the scan.** The reading pass needs
  `book.json` and nothing else: no PDF render, no Tesseract, no layout. That is
  what makes this the cheapest pass to put on a tablet, and it should be
  enforced rather than hoped for.
- **A service worker,** so a book opens on a train. Reading is the one pass
  with no reason to need the network once the book is down.

**What is deliberately not done is a native shell.** Capacitor or Tauri around
this same web app, an Apple developer account and a release pipeline buys App
Store presence, Files-app integration and Pencil input, and costs a second
build to keep working. Nothing in the reading pass needs any of the three. If
Pencil annotation turns out to be the thing that makes reading on the iPad
pleasant, that is the argument for reopening it, and it should be reopened on
that evidence rather than on the wish for an icon.

Two things to measure rather than assume, both Safari-specific: whether the
native selection callout (Copy / Look Up) can be lived with beside a custom
popover, and whether a three-hundred-page column scrolls acceptably on the
actual device. Both are answers, not opinions, and both change the design if
they come back wrong.

## Stage 4 — the payoff

The reason for all of it: `drive.mjs reading --tag intro --json` becomes the
brief handed to `.claude/agents/etsu.md`, in place of evenly spaced extracts.
A model handed three hundred pages summarises the last twenty; a model handed
the forty passages the editor actually stopped at is being told what the book
is about by someone who read it. Same for `--tag note` and the footnote pass,
and `--tag glossary` and the headword list.

Score it against the finding at the top of this plan. Not "are the notes good"
— they were already good, one at a time — but **what are they hung on**. If the
next book's notes are again nine-tenths proper names, the harvest was not used
and the pass has not earned its place.

## What is deliberately not built

- **Promotion of a highlight into a note in one click.** Above: the annotation
  pass has checks that a promoted highlight would bypass, and a highlight is a
  place needing attention rather than a verdict.
- **Highlight colours as a second vocabulary.** The tag is the meaning. A
  colour is a rendering of the tag, not an independent axis, or in six months
  nobody remembers what yellow meant.
- **Free-text tags.** Three, closed, refused by the parser if unknown. The fact
  bank's accreting vocabulary is right for a corpus nobody has seen yet; this
  is three known jobs, and the fourth button is a channel that already exists.
- **Highlights spanning blocks.** Same reasoning as the retired cross-block
  selection: the unit is the passage, and two highlights are two highlights.
- **A separate reading app, or reading store.** The edit list is the whole of
  it, as it is for everything else here.
- **Reading the scan on the tablet.** The reading pass reads the text. Checking
  a passage against paper is the other view's job, on a machine with the scan.
