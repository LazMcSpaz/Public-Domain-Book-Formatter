# Plan: the reading pass

The editor reads the book before annotating it. That pass is where the
footnotes are chosen and where the introduction gets its material, and it is
the one part of making an edition that this app has never held: it happens in
a reading app on an iPad, and the highlights made there cannot come back out.
So the reading is done twice — once for real, once from memory at the moment a
note has to be written — and the second one is the one the book is built from.

Nothing underneath has to change for this either. A highlight is an anchored
record in the edit list that cannot print, which is what a `memo` already is;
the galley already renders the whole book as one scrolling column; the shelf
already carries the edit list in `book.json`. What is missing is a **record**
for a marked passage, a **harvest** that turns an evening's reading into the
brief for the annotation pass, and a **surface** that is comfortable to read
three hundred pages in.

## Why this is not a memo, and not a note

Three anchored things now, and the difference between them is who is waiting.

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

It is also a **range** where a memo is a point. `PLAN-editor.md` Stage 4 parked
that ("memos on regions rather than points — still waiting on a real book to
prove points too coarse"), and this is the real book proving it. A footnote
hangs off a point, so `note` stays a point. A highlight is the words, because
without the words the harvest is a list of offsets nobody can read.

## The line, restated once

**A highlight can never print.** Structural, not filtered: `applyEdits` skips
the kind entirely, the way it skips a memo, so there is no path from a
highlight to the layout engine at all. A reader's marginal note appearing in a
book for sale is the failure this feature must make impossible, and "we filter
it at export" is not impossible.

**A highlight is not a note, and promotion is an act.** It is tempting to make
a `note`-tagged highlight simply _become_ a footnote — one less step, and the
tag already says so. That would be wrong. A place worth marking at reading
speed is not the same as a place worth annotating, the marked passage is not
the note's prose, and everything that makes an annotation trustworthy here —
the voice card, `checkProposals` against the book's own text, `auditProse` —
sits in the annotation pass that a promoted highlight would walk straight past.
So the harvest _briefs_ the notes pass. It does not seed it.

**The same rule about text, again.** The reading pass has no pixels in front
of it. So a highlight tagged `check` says _this looks wrong_ and records the
words as the book currently has them; it never carries a proposed correction,
for the same reason a query has no field for one. Propose from sense, accept
from pixels, and the accepting happens later with the crop.

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
    tag: 'note' | 'intro' | 'glossary' | 'check'
    /** The editor's words about it. Optional: a bare highlight is legitimate. */
    text?: string
    /** ISO date, so a reading session can be seen as a session. */
    madeAt: string
  }
```

The places it has to be handled are known exactly, because `memo` maps them:

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

Offsets alone rot. Every `text`, `split` or `merge` edit made after a reading
session slides every offset in that block, silently, and a highlight then names
words nobody marked. Quotes alone are ambiguous: a word highlighted twice in one
paragraph has two homes and the search finds the first.

So **both**, with a stated precedence: the quote locates the highlight, the
offset picks the occurrence when the quote appears more than once, and when the
two disagree the quote wins and the disagreement is _reported_ in the harvest.
That is `findAnchor`'s existing posture (`src/core/annotate/schema.ts:167`) —
collapse whitespace, one case-insensitive retry, and no fuzzier than that,
because a loose match landing on the wrong sentence is the failure the function
exists to avoid.

`findAnchor` returns only the far end, because a note hangs after its words.
A highlight needs both ends. **One implementation:** generalise it to
`findQuote(blockText, quote, near?) → { from, to } | null`, and let
`findAnchor` be its `.to`. Two searchers that can disagree about where a quote
is, is exactly the class of drift this repository keeps closing.

### The coordinates, which mean three different things

The trap named in CLAUDE.md — _check what the coordinates mean before comparing
them_ — is live here, and it has three coordinate systems in one gesture:

1. the **notation** string (`withMarkup`), which is what `body` hands back and
   what a `text` edit must be written in, and which contains `<i>` and `<b>`;
2. the **plain text** (`parseInlineMarkup(raw).text`), which is what a reader
   sees and what `note`, `split` and `memo` offsets are already measured in;
3. the **rendered DOM** from `htmlOfMarkup`, where the selection actually
   happens and whose character offsets are the HTML's, tags included.

A highlight's `quote`, `from` and `to` are all in (2), and the surface's job is
to map a DOM range in (3) back to (2). Storing a quote with `<i>` in it would
make `findAnchor` fail on exactly the passages worth marking, since an
italicised book title is what a glossary highlight most often is.

## Stage 1 — the record and the harvest, with no UI at all

Deliberately first, and deliberately complete without a browser. It is pure
core plus a driver verb, so it is fully unit-testable, and it means a reading
session can be conducted from the conversation before there is anywhere to
click. It is also the half that makes an iPad session _recoverable_, which
matters more than the half that makes it pleasant.

- The edit kind and its ten touch points, above.
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

- **read-only.** Not "editable but you probably won't"; a passage cannot be
  entered. Two hundred pages of reading on a touch screen with a caret in it is
  an evening of accidental edits, and the whole point is a mode where the only
  gesture is marking.
- **select, then choose a tag.** Four buttons, and a field for the note.
  Existing highlights render as background tints, split at every boundary so
  overlapping ones are both visible rather than one silently winning.
- **wider leading, a measure that reads, no toolbar** — the outline stays,
  because navigating a book you are reading is the one control that earns its
  place. Progress is where you left off, remembered per book like the view is.
- **Ctrl+H does nothing here, and neither does Ctrl+I.** A reading mode that
  can change the text is an editing mode with the buttons hidden.

The harvest is reachable from the head of the column: how many highlights, by
tag, and a jump to each.

## Stage 3 — the iPad

Less than it looks, because `.github/workflows/deploy.yml` already publishes
the app to GitHub Pages on every push to `main`. It is a static client-side SPA
with no server and no Electron, so it already runs in Safari at a URL. What is
missing is three things, none of them a second codebase:

- **A web app manifest and an icon**, so "Add to Home Screen" gives a standalone
  app rather than a browser tab. This is not cosmetic: Safari deletes
  script-writable storage for sites without recent interaction, and home-screen
  apps are exempt. To be _measured_ on the device, not taken from
  documentation — the same posture as the batch-endpoint probe.
- **A reading route that never fetches the scan.** The reading pass needs
  `book.json` and nothing else: no PDF render, no Tesseract, no layout. That is
  what makes this the cheapest pass to put on a tablet, and it should be
  enforced rather than hoped for.
- **A shelf push at the end of a session, offered rather than assumed.** Given
  the eviction rule above, an evening of reading notes living only in Safari's
  IndexedDB is precisely the laborious-and-unrecoverable thing the shelf exists
  to protect. The device protects against a crashed tab; only git protects
  against a browser that quietly cleaned itself up.

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

Score it, as everything here is scored: highlights raised, notes written from
them, notes written from nothing. If the intro is written from the harvest the
pass is earning its place; if it is written from the text anyway, the tags are
wrong and should be changed or dropped.

## What is deliberately not built

- **Promotion of a highlight into a note in one click.** Above: the annotation
  pass has checks that a promoted highlight would bypass.
- **Highlight colours as a second vocabulary.** The tag is the meaning. A
  colour is a rendering of the tag, not an independent axis, or in six months
  nobody remembers what yellow meant.
- **Free-text tags.** Four, closed, refused by the parser if unknown. The fact
  bank's accreting vocabulary is right for a corpus nobody has seen yet; this
  is four known jobs.
- **Highlights spanning blocks.** Same reasoning as the retired cross-block
  selection: the unit is the passage, and two highlights are two highlights.
- **A separate reading app, or reading store.** The edit list is the whole of
  it, as it is for everything else here.
- **Reading the scan on the tablet.** The reading pass reads the text. Checking
  a passage against paper is the other view's job, on a machine with the scan.
