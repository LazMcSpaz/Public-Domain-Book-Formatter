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

## Stage 1 — the record and the harvest, with no UI at all — **done**

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

## Stage 2 — the reading surface — **done**

A third view beside "Edit the book" and "Check against the scan":
**"Read the book"**. The same scrolling column `BookEditor` already builds —
divisions, body, divisions, set in a book face with italics as italics — but:

- **read-only**, with "Edit this passage" as the deliberate way out, above.
- **select with a finger, which is the whole of the gesture.** The editor reads
  by dragging on text, not with a Pencil, so this is the platform's own
  selection and nothing else: no custom hit-testing, no canvas overlay, no
  handwriting layer. What the surface adds is a popover on `selectionchange`
  offering the four buttons of the table and a field for the editor's words.
  Pencil annotation is not built and is not planned — see Stage 3.
- **the DOM range mapped back to plain-text offsets**, which is the one piece of
  real work in this stage and the one the coordinates section above is about.
  The block renders through `htmlOfMarkup`, so a range's own offsets are the
  HTML's; walking the block's text nodes and summing their lengths up to the
  range gives the offset in the plain text, which is where `quote`, `from` and
  `to` live.
- **existing highlights as background tints**, split at every boundary so two
  overlapping ones are both visible rather than one silently winning.
- **wider leading, a measure that reads, no toolbar.** The outline stays,
  because navigating a book you are reading is the one control that earns its
  place. Where you left off is remembered per book, as the chosen view already
  is.
- **Ctrl+H does nothing here, and neither does Ctrl+I.** A reading mode that
  can change the text is an editing mode with the buttons hidden.

The harvest is reachable from the head of the column: how many highlights, by
tag, and a jump to each.

## Stage 3 — the iPad: the shelf as the only durable place — **done**

`.github/workflows/deploy.yml` already publishes the app to GitHub Pages on
every push to `main`, and Pages is enabled, so it already runs in Safari at a
URL. The editor has settled what the storage model should be, and it is not the
one the app has: **the repository is where the reading lives, and the device
only holds what has not got there yet.**

### The front page, and reading without the scan

Two halves of one thing, and both were late: this was written into the stage as
"a reading route that never fetches the scan… enforced rather than hoped for",
and the stage was marked done with only the manifest, the worker and the outbox
built. Until it existed, every door into a book fetched the scan and started
recon — tens of megabytes over cellular and ten minutes of Tesseract before a
word could be marked, for pixels the reading pass never looks at.

`readFromShelf` fetches `book.json` and the editor's own pictures and stops. It
marks the recovery half of the flow done — every question it asks was answered
when the book was read, and none of them can be answered again without the
paper — and lands in the reading view.

The shelf is the front page it is reached from. The intake screen used to lead
with "drop a scanned PDF" and list the shelf below it, which is the order the
app was built in rather than the order it is used in: after the first session
the book already exists, and on a tablet a new scan is the one thing nobody
opens. Books first, as cards; the device's own next; the intake last.

What this gives up is **said on the surface**, not discovered: the scan tab
reads "Scan not on this device" and is disabled. A view that shows no pixels
and says nothing would be the one shape this app must not take, given that
every gate in it promises never to decide without the paper.

### The outbox, and why it can be a simple queue

A highlight is written to a local queue the instant it is made, and the queue is
flushed to the shelf whenever the app is open and online. What makes that safe
is a property that falls out of the edit list rather than one anyone designed
for: **highlights commute.** Each is an independent record keyed by its own
`highlightId`, changes nothing else, and is collapsed by `withEdit` on that id.
So two devices adding highlights to one book cannot conflict, and re-sending a
batch whose response was lost is a no-op rather than a duplicate.

That is why the queue holds **edits, never the book**. A flush fetches the
current `book.json` off the shelf, appends the queued records to its edit list
and writes it back once — so a reading session is _one_ commit, and anything
done to the book from another session in the meantime survives. A queue holding
a snapshot of the whole book would instead overwrite whatever else had happened,
which on this shelf means silently discarding an afternoon's annotation.

A `text` edit made through "Edit this passage" does **not** commute: two devices
retyping one block genuinely conflict. So a queued text edit carries the block's
text as it stood when it was made, and a flush that finds the shelf's copy
changed underneath **reports it** rather than resolving it. Same rule as
everywhere: the editor decides, and silence is the failure mode.

### What must be said out loud rather than implied

- **The push happens when the app is next open with a connection.** iOS does not
  run a closed web app's code, and Safari has no Background Sync, so a promise
  of "it will go up later on its own" would be a lie the editor only discovers
  when a reading is gone. The indicator says how many passages are still only on
  this device, and says it in those words.
- **`navigator.storage.persist()`, and the Home Screen.** The queue is the one
  thing here whose loss cannot be repaired by running something again, and
  Safari evicts script-writable storage for sites without recent interaction —
  installed web apps being exempt. So installation is not a nicety in this
  design; it is what protects the queue. To be **measured on the device**, not
  taken from documentation.
- **The queue is written before the highlight is acknowledged on screen.** The
  batch ticket's rule, for the same reason: a mark the editor saw appear and
  that no store ever accepted is worse than one that visibly failed.

### The size problem this exposed, which is not the reading's fault

_Clairvoyance_'s `book.json` is **29.8 MB, of which 28.9 MB is one inline
base64 advertisement plate**; the book itself is 788 KB. Pictures are supposed
to go to `images/<digest>.png` and be named by the book file, written once —
that rule exists precisely because git keeps every version — and this book
predates it or slipped past it.

It matters here because a flush rewrites the book file, and forty times 29.8 MB
of history for a fortnight's reading is a repository nobody wants. With the
plate externalised the same flush is 788 KB and one commit a session, which is
ordinary. **So re-saving that book through the current image path is a
prerequisite for reading it on a tablet**, and it is worth doing regardless: it
is a live defect on the shelf today, making every save of that book forty times
larger than it needs to be.

### What is deliberately not done: a native shell

Capacitor or Tauri around this same web app, an Apple developer account and a
release pipeline buys App Store presence, Files-app integration and Pencil
input, and costs a second build to keep working. The editor reads by dragging a
finger on text, so Pencil input — the only one of the three the reading pass
could use — is not wanted. A Home Screen install gives the icon, the app
switcher, Spotlight, offline and the storage exemption, which is the rest of
what "an actual app" means. Reopen this only if handwriting turns out to be how
the reading actually wants to be done.

Two things to measure rather than assume, both Safari-specific: whether the
native selection callout (Copy / Look Up) can be lived with beside the popover,
and whether a three-hundred-page column scrolls acceptably on the actual device.
Both are answers, not opinions, and both change the design if they come back
wrong.

## What measuring turned up that reasoning had not

Both faults in stage 3 were invisible to inspection and obvious the moment
something was actually run, which is the standing lesson of this repository
holding for the fourth and fifth time.

- **The service worker opened offline as a blank page.** It registered cleanly,
  reported an active worker and a correct scope, and cached the shell. On a
  first visit the page fetches its modules _before_ the worker takes control, so
  the worker never saw them; a second online visit would have papered over it,
  which is the kind of failure that looks like the feature working. The index is
  now read at install time and the assets it names are cached with it — the page
  states its own dependencies, so there is no list to drift out of step with the
  build. `scripts/check-install.mjs` is that measurement, kept.
- **Two overlapping flushes wrote the book file three times for two flushes.**
  The automatic flush after a change and a press of "Send to the shelf" both
  read a non-empty queue. Two identical writes are a commit that says nothing on
  a shelf whose point is that git keeps every version; two different ones are a
  lost update, since each reads the blob sha before the other has written.
  Flushes are chained per book, and `scripts/check-outbox.mjs` asserts one write
  per flush.

Both checks were fault-injected against the bug that prompted them: each fails
with its fault reinstated and passes without it.

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
