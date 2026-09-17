# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## What this is

**Starting cold on a book?** Read [`docs/HANDOFF.md`](./docs/HANDOFF.md)
first, then the process it points at:
[`PROCESS-reading.md`](./docs/PROCESS-reading.md) for getting the text right
and [`PROCESS-edition.md`](./docs/PROCESS-edition.md) for turning a read book
into a printed one.

A **browser** app (React + TypeScript + Vite) that turns public-domain books —
scanned PDFs, or EPUBs that are already text — into print-ready **KDP**
interiors. It renders and OCRs
pages locally, harvests the book's own vocabulary, then (Phase 2) runs a
vision-grounded model pass that reads each page against the scan and recovers
its structure. The full design is in [`SPEC.md`](./SPEC.md); the module map is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

Everything runs client-side. There is no server and no Electron shell.

## How the work is actually done

**The books are made in a conversation, not in the wizard.** The editor works
through a Claude Code session — mobile, desktop or web — and the assistant
drives the app. That is the primary interface now, and it is the one to design
for. If you are an assistant reading this: this means you.

The division of labour follows from what each side is actually good at.

- **The app is the engine and the viewer.** Rendering a leaf, OCR, assembly,
  layout, writing the PDF: all of it needs a browser and none of it needs
  judgement. It also holds the pixels, which is what every gate here promises
  never to decide without.
- **The conversation is the interview.** Reading the book, weighing a
  discrepancy against the scan, deciding what a passage says, writing the
  introduction and the notes — these are prose problems, and the wizard was
  only ever a way of getting a person to answer them one radio button at a
  time.

So **a change to this app is worth making if it improves what the assistant can
see, check or write.** That is the standing brief. In practice it means one of
four shapes:

- **A verb on `scripts/drive.mjs`.** Anything the assistant needs from the
  browser goes through the driver rather than through a one-off `page.evaluate`
  buried in a shell command. `ocr` and `body` were both added this way, and both
  because a job turned out to be impossible without them.
- **Evidence that comes back as an image.** A crop, a leaf, a contact sheet.
  The rule is unchanged and the assistant is not exempt from it: propose a
  reading from sense if you like, but only pixels accept one.
- **A pure function that runs without a browser at all.** `checkProposals` and
  `findAnchor` are the model — deterministic, no network, and they do not care
  whether a person, a model or the API wrote the thing they are checking. Work
  written in conversation gets checked by the same machinery as work bought
  from the API. Prefer this shape; it is the cheapest and the most honest.
- **A file on the shelf a person can read.** `corrections.md`, `glossary.md`.
  A repository is a shelf rather than a blob store precisely so its owner can
  look at it, and JSON is not looking.

Two things this does **not** license.

**The wizard is not deprecated and must not rot.** It is the app a person
without an assistant uses, and the bridge was built as a second door onto the
same surface (`useAgentSurface`) rather than as a replacement, so that a driver
and a person cannot disagree about what the flow is. Keep it that way: a
feature reachable only from a chat session is a feature the app does not have.

**No second renderer, still.** The temptation from this working model is a Node
platform so the assistant can lay a book out without Chromium. Resist it until
something actually blocks: `layout()` is pure and the browser is driven
headlessly by the driver already, and the reason the design gate's approval
means anything is that one engine draws the page. See **The preview is the
PDF**, below.

### The subject matter, and the thumb on the scale

The shelf is **occult and esoteric books**, and it will stay that way. That is
not incidental to how this work is done, because an assistant writing about
this material brings a lean to it whether or not anyone asked for one — the
default register for "astral body" is a shade more guarded than the default
register for "endocrine gland", and a reader going down a page absorbs which is
which without a single argument being made.

So the standing rule, for every book here: **it is nobody's place to assert the
absolute truth of these things, and equally nobody's place to quietly deny
it.** Much of what these books describe is held to be real by the people who
publish these editions and by a great many people who have worked at it. The
job is to hand a reader what they need to find out for themselves.

In practice that comes down to four habits, and they are checkable:

- **State the established teaching plainly.** Not "hedge both sides equally";
  that was the first version of this rule and it was wrong. The editor is not an
  arbitrator between two parties. He holds the tradition's teaching to be true
  and writes it as such, while respecting the scientific method as how anyone
  gets to the bottom of anything. So "supposed", "so-called" and "said to be"
  belong on contested claims and single-witness stories, never on doctrine. Say
  separately what is known, what is disputed, and what rests on one witness.
- **Never push.** No arguing a reader round, no scolding a doubter, no triumph
  when the evidence goes the tradition's way. Set the thing out, give the reader
  what they need to weigh it, and stop there.
- **Ancestry is not an argument.** That a term was borrowed, or that a doctrine
  took its present shape in the 1880s, is history worth having and settles
  nothing about whether the thing is real. Give the history; don't let it do the
  work of a conclusion it has not earned.
- **Warmth is not imprecision.** These books are an invitation to try
  something. An entry so flat that nobody who read it would want to try anything
  has failed, and it has not been made more truthful by being made duller.

### The bias pass, which runs after the writing

Getting it right while writing is not enough, and must not be the only place it
has to be right. The writer is the one party who cannot judge this: asked
whether they were even-handed they will say yes, and mean it. Every other check
in this app exists for that reason — OCR against the vision pass, `verifyBook`
across leaves, `checkProposals` against the book's own text — and SPEC §4 states
it as a rule: escalation is decided by deterministic cross-checks, never by a
model's opinion of its own output.

So **the introduction, the notes and any glossary get an audit pass of their
own, after they are written and before they are pushed**:

```bash
node scripts/voice.mjs audit <book.json>   # or any file of prose
```

`auditProse` (`src/core/annotate/audit.ts`, pure and unit-tested) reports:

- **Every hedge sitting on a sentence about the tradition**, listed for
  reading. This is the list that matters. No lexicon can tell an established
  teaching from a contested claim, so none of them is a fault on its own and
  each one is a decision for a person.
- **The hedge ratio**, over the whole text and again over _definitions only_.
  Secondary, and kept only because it catches a lean in either direction.
  Definitions are measured separately because over a long document the effect
  washes out: the first glossary written here hedged its doctrinal definitions
  three times over and still scored 0.72 overall, diluted by hundreds of
  sentences about people and dates. Both ratios stay silent below a floor of
  hedges, since a rate built from one event flags good prose and a check that
  does that gets switched off.
- **Dismissals and banned phrasing**, as plain lexical scans. These catch less
  and what they catch is unambiguous.
- **Long dashes**, which are out of this editor's prose by request and are the
  most recognisable habit of machine-written English. Hyphens inside compounds
  are untouched; only a dash doing the work of a comma is caught.
- **A Flesch-Kincaid grade**, reported and not enforced, with the average
  sentence length beside it. There is no correct grade for an introduction, but
  the number moves when prose gets tangled, and long sentences are the writer's
  fault where long words are usually the subject's.

A non-zero exit means a person reads the flagged passages. Do not tune the
limits to make a draft pass; fix the draft, and re-run.

**What the audit cannot see is flatness** — whether an entry is so dry nobody
who read it would want to try anything. That needs a reader, and it is the
other half of the pass. Read the doctrinal entries end to end and ask whether
they sound like they were written by someone who finds the material alive.
Pretending a word list could stand in for that would be the same error the
module exists to catch.

The editor's voice card (`voice/<pen-name>.json` on the shelf, and
`scripts/voice.mjs` to read it) carries the same rules in the form the writing
is actually done against. Read it before writing anything that goes in a book.

**Better than reading it: write as him.** `.claude/agents/etsu.md` is the same
card compiled into a subagent — the stance, the construction rules, the avoid
list and a passage of the editor's own prose, in a system prompt. Brief it with
the book's verified facts and it returns front matter written in the voice
rather than checked against it afterwards, which is a different and better
thing: a writer who has the rules cannot produce a draft that has to be argued
back into them. The card and the agent say the same things on purpose, and the
card stays the source — it is the file the app reads, and the one that travels
with a shelf that has no formatter checkout beside it. The agent is how the
writing gets done.

It lives in the formatter repo rather than on the shelf because that is where a
session that can run the checks is already standing, and because an agent
definition is only loaded at the _start_ of a session: a card fetched mid-job
can be read, but an agent added mid-job cannot be used until the next one.

### How a book gets read, and what checks it

No API. Transcription and annotation both happen in a session, which changes
what the safeguards have to catch: the vision pass saw one leaf at a time and
could not drift because it could not see far, and a conversation that has read
three hundred pages of one author is the exact condition under which fluent
invention appears. So the reading is staged, and every stage after the first is
a check on the one before it.

1. **Take the free reading first.** Recon renders, OCRs and harvests every
   leaf, and caches it. A born-digital PDF has its own words read straight out.
   No model, no spend. This is the step that matters most, because it turns the
   job from _"read this image and produce text"_ — the generative act, where
   invention lives — into _"here is an image and here is a text, where do they
   differ"_. A reader that never writes unprompted cannot confabulate a
   paragraph.
2. **Triage deterministically.** OCR confidences are real probabilities and
   `assessText` measures damage. Clean, consistent leaves keep their OCR.
   Damaged or structurally ambiguous ones get eyes. Escalation is measured,
   never a model saying it feels unsure — SPEC §4, applied to spend.
3. **Batch the leaves that need eyes into subagents.** One agent per handful of
   leaves, given the images, their OCR, and the tail of the previous batch for
   the seam. It returns transcription and dies; the parent never holds a page
   image. That rebuilds on purpose the property that made the vision pass safe.
4. **Checkpoint every batch**, the way the notes pass and recon already do. A
   session that dies or hits a limit loses one batch, not a book.
5. **Check the book against itself, for free** (`@core/coherence`). A name
   spelled two ways, a doubled word, a cross-reference to a chapter that is not
   there, a quotation that never closes. Pure, deterministic, no spend, and
   whatever it catches never needs adjudicating.
6. **Read for sense** — the one check with _meaning_ available. A chapter at a
   time, output **findings and never text**. See the propose/accept rule below.
7. **Adjudicate every finding against the crop**, with a reader that has not
   seen the hypothesis. Shown both, a model confirms; shown the crop, it reads.
8. **A person decides.** The verdicts are a sheet to read, not a queue to
   approve. Nothing reaches the book until the editor has looked, and the sheet
   is built so that looking is cheap: the crop, what the paper says, what was
   proposed, and what the deterministic checks made of it, in one place.

Keep the ledger. Findings raised, confirmed, refuted, per book. A check nobody
can score is worse than no check, because it manufactures confidence: if the
sense pass proposes a hundred and sixty survive the pixels it is earning its
place, and if fifteen survive it is noise and should be tightened or dropped.

### What a session looks like

The **shelf repository is the source of truth**; the browser's IndexedDB is a
cache of it. Load the book from the shelf before touching it (`drive.mjs load`),
and push what you change. A session that edits the local copy and forgets to
push has done the work into a container that is about to be reclaimed.

Corrections and notes are **edits keyed to assembled blocks**, carrying each
block's whole text with emphasis rendered back as `<i>` tags. `drive.mjs body`
hands back exactly those strings. Writing one against a raw page silently
truncates every paragraph the page seam joined — see `applyEdits`.

### What has actually gone wrong

Every item here cost real time on a real book. They are not hypotheticals, and
each one is followed by the thing that catches it next time.

**The remote is the source of truth, not the working copy.** This container
reverts both checkouts without warning — it did it four times in one session,
once _after_ the work had been pushed, leaving a local tree that looked like
a week-old commit while the remote held everything. So push at every natural
stopping point, and when something looks wrong, check which side is stale
before assuming work was lost:

```bash
git rev-list --count origin/main..HEAD    # unpushed commits, 0 is good
git merge-base --is-ancestor HEAD origin/main && echo "local is behind"
git fetch origin main && git reset --hard FETCH_HEAD
```

**A read of a file can answer for the write that follows it.** Every ruling
the editor made at the query gate on _Isis Unveiled_ failed with
`422: Invalid request. "sha" wasn't supplied.` — a message about a field in a
request nobody wrote. GitHub's `ETag` for a path is the **blob sha**, and the
same one is handed out whatever media type was asked for: measured, a
conditional request for `application/vnd.github+json` carrying the ETag the
`raw` representation issued comes back `304 Not Modified`, `Vary: Accept`
notwithstanding. A flush reads the book file raw and asks the JSON envelope for
its sha a moment later, so a cache lenient about `Vary` served the **book file**
as the answer to "what is this path's sha" — it parses, being JSON, and has no
`sha` in it. The write then went up as a _create_ of a file that already exists.

Three rules now, in the order of how much they can be relied on: the sha is
asked for at a URL carrying a unique parameter, so nothing can hold an answer
for it; every shelf read is `cache: 'no-store'`; and `shaOf` checks that the
answer is a file record rather than treating anything it does not recognise as
"not there". `npm run check:cache` is the measurement, and **Chromium cannot be
made to show this fault** — it honours `Vary: Accept` properly, which was tried
against a real origin with GitHub's exact headers. The device it happened on was
an iPad. So the check asserts the property that does not need a browser to be
sloppy, with the stub playing the lenient cache; fault-injected, it reproduces
the editor's error verbatim.

**And the same cache took a ruling off the shelf, three hours later.** The fix
above was applied to `shaOf` alone, under a comment arguing that a unique URL
is the rule that does not depend on anybody's cache being correct — while
`getText` and `getBytes` kept `cache: 'no-store'`, which governs the
**browser's** cache and not a shared one. `s-maxage=60` invites a shared cache
by name.

A flush reads the book file, folds the queue into _its_ list and writes the
whole list back, so a read a minute out of date does not miss a ruling, it
**deletes** it. Measured off the shelf's own history: over fourteen commits to
one book, the two flushes that came **44 seconds** after the one before them
each dropped a ruling — leaf 196, which survived only because the editor
happened to rule it again, and leaf 209, which was gone — while all nine gaps
longer than a minute were clean. Two for two under the window, none above it.
The commit message still said "1 query ruled on".

Three things, and the order is the lesson. **Every read** now goes through one
`readUrl`, so the property holds for the reads as a class rather than for
whichever one somebody last thought about — that distinction _is_ the second
fault. The unique parameter is `Date.now()` **and a counter**, because
milliseconds are not fine enough to separate two reads of one path in the same
tick. And the flush keeps a net under all of it: the device remembers which
rulings it has seen the shelf accept (`rulingsMissingFrom`, `landed.ts`), and a
file that comes back missing one is **refused, not written over** — refusing
costs a minute, writing costs work the editor will never know is gone. Losing
that record is safe by construction: an empty one makes the guard silent, which
is the behaviour that shipped before it.

`npm run check:cache` measures both halves against a real origin whose stub
answers any URL it has already answered with what it said then. Its first
version put `answered.set` **after** the `return` that sent the reply — dead
code, so the new assertion never ran and the check passed for a reason that had
nothing to do with what it asserts. That is this file's own rule about tests,
found in the check written to enforce it.

**One block can carry the same marker twice, and the engine could only see
one.** `prepareFootnotes` asked each note for its _first_ match in a block —
and assembly joins a paragraph across a page seam, so a paragraph running from
one leaf onto the next brings both leaves' `*` into a single block. Both notes
were handed the same position, one was kept and the other dropped; the dropped
one then claimed the next `*` **anywhere in the book**, the note that one
belonged to took the one after, and every note of that marker from the seam on
was set under the wrong reference. On _Isis Unveiled_ Vol. I that was **638 of
857 notes** — page 155 citing Cooke's "New Chemistry" where Josephus belongs —
with a literal asterisk left in the text at every seam, because a marker nobody
claims is never stripped. Nothing reported it: `orphaned` was 0, since every
note was claimed by _something_.

Occurrences are now walked positionally and the k-th takes the k-th waiting
note of that marker, and a doubled marker beats a single at the same position
(`**` in the text is one marker, not a `*` with another beside it).

**The counts the printed page makes equal are worth checking.** A footnote sits
at the foot of the leaf its mark is on, so per leaf and per marker the two
balance; `checkFootnotePairing` (`@core/coherence`) names every leaf where they
do not and carries the **running drift**, because the first non-zero entry is
where a reader first meets the wrong note. Eight leaves in six hundred, on this
book. It takes the _transcriptions_ rather than the assembled document on
purpose: assembly joins across seams, so an assembled block belongs to two
leaves at once and "does this leaf balance?" stops having an answer.

**Two numbers name one place, and the gate gave only one.** A query was headed
`Leaf 228` while its own reason cited `page 170` — the scan leaf and the folio
the book prints, the same place twice, with nothing on screen to say so. The
editor reasonably read it as a question about a different passage. A
`RaisedQuery` now carries the leaf's `folio` and `whereItIs` names both. Two
things came with it, from the same screenshot: a query's quote cut **mid-word**
stopped before the fault it was raised about, and **1,400 characters of help
above the passage** put the thing being decided past the fold on a phone —
`HELP_TRAILS_AT` now sets long help below the evidence and the options, where
it reads as the reference it is.

**The PDF in a book's directory is the _export_. The scan is
`scans/<sha256>.pdf`, and `book.json` names it in `scan.path`.** Handing
`drive.mjs load` the exported book instead of the scan does not fail: it
stores a run under a second key, and `leaf`, `ocr` and every crop then render
the finished edition rather than the paper. Read the path out of the book file
rather than reaching for the PDF sitting next to it, and check `drive.mjs
runs` for keys that should not be there. `runs drop <n>` removes one.

**A leaf's text is not a block's text.** Assembly joins paragraphs across page
seams, so the raw transcription of leaf 120 ends mid-word and the block
carries the whole paragraph. Diffing an edit against a transcription therefore
reports changes that were never made and misses the ones that were.
`drive.mjs body` hands back `pristine` and `edited` for exactly this. Block
ids (`p120b3`) are _derived_ at assembly; the stored blocks have no id at all.

**Editing a book file by hand.** Prove the round trip before rewriting one:
`json.dumps(d, indent=1, ensure_ascii=False) + "\n"` is byte-identical for
these files, and confirming that costs one command. If instead you are
inserting a line by text match, anchor the search inside the object you mean —
`"author"` occurs in `identityAnswers` and in `answers.export`, and the first
match is not the one you want.

**Restart both servers after any `src/core` edit, and verify what is
_served_.** Vite's watcher is unreliable here and the driver's Chromium keeps
its own HTTP cache. `curl` the module through `/@fs/...` and grep for a token
from the change; `/src/...` returns `index.html` and will "confirm" anything.
The first driver command after a restart often dies with `Target page,
context or browser has been closed` — retry it. And `pkill -f vite` matches
the shell running it, so kill from a detached script or by pid.

**"Restart" means kill vite, not check whether the port answers.** A restart
script that starts vite only when :5173 is silent never restarts it at all, so
the process that came up at the start of a session is still serving hours
later — with an **in-memory transform cache** holding every module as it was
before each `src/core` edit since. Measured: `curl` on the canonical
`/@fs/…/draft/index.ts` came back without a function that had been on disk,
committed, and green under `npm test` for an hour, while the same URL with
`?v=<timestamp>` came back with it. A whole chapter was drafted by the old
code and looked entirely fine, because a draft is only ever an input to a
reader who checks it against the render. The cache-busting parameter is also
the cheap way to tell this apart from a real bug: **if the plain URL and the
busted URL disagree, the code is right and the server is stale.**

**A book file with no answers proofs as a finished book.** _Isis Unveiled_
Vol. I was proofed for a week with `answers` empty: the running head on every
recto said UNTITLED, the title page was one word, and the whole volume was set
in a face the editor had ruled against — the ruling lived in `rulings.md`,
which the export never reads. Nothing reported any of it, because the export
takes `'Untitled'` for a missing title and the period default for a missing
face and prints both as though somebody had chosen them. `drive.mjs proof`
now leads its report with `cautions`: no export answers, a title of
`Untitled`, no author, no design answers, no face chosen, and **a face named
in a ruling that the book is not set in** — lexical, over the faces the
design gate offers, which are the only ones a ruling can mean. `book-files
--check` asks the same of the file on the shelf: `UNSET` for a missing title,
author or face, and `MISNAMED` when the export title disagrees with the title
the reading found on the original's title page. Swept over the shelf, that
found a book carrying **another book's title** in its export answers, a month
old. Read the cautions before the page count.

**A ruling filed under the wrong words settles nothing.** A query quotes a
passage; a ruling is matched to it by that quote, exactly. The ruling on leaf
530 was filed under the words that were _changed_ rather than the words the
query quoted, so the query stayed waiting with a ruling beside it and the gate
asked the editor again for a decision already made. `rule` now refuses when
the leaf has queries waiting and the quote is none of them, lists them, and
names the nearest; `force` files the ruling anyway, for the rare decision
about something on the leaf nobody raised.

**The same book has a different key on every machine.** A run key is
`name\0size\0modified`, and `load` reads the modified time off _this_
checkout, so a book fetched from the shelf is filed here under a key that
slugs to a directory the shelf has not got: the shelf holds
`books/isis-vol1-vjj34f/` and this container's key slugged to
`isis-vol1-1bkyqpa`, which is where `queries` said the sheet was and where
`shelf push` would have put a second copy of the book. `load` now records the
shelf's key against the device's (`__pdbfShelfKey`), every shelf path in the
driver derives from it, `book` reports `shelfDir` and says when the keys
differ, and `shelf push` **refuses** rather than create the second directory.
`save` was already right: it keeps the shelf's key.

**Two smaller traps, both about what a check can see.** `grep "'verse'"` on a
module served by vite found nothing and the code was there — esbuild emits
double quotes, so grep for an identifier rather than a quoted string. And a
fault-injection script whose restore step copies a snapshot taken _before_
the fix silently reverts the fix; an export made afterwards then tests
nothing. Read the diff on disk before re-exporting, every time. The restart
script that the section above describes is committed now as
`scripts/restart-servers.sh`, so it does not have to be rebuilt from memory
in every container, wrongly.

**A second hand-written list of a union's members drifts, and the compiler
says nothing.** `PAGE_ROLES` in `@core/transcribe/schema` was a copy of the
`PageRole` union written out by hand, typed `readonly PageRole[]` — which
rejects a name that is not a role and is silent about a role that is not in the
array. It had gone one short. `digitization-notice`, the role that exists so a
scanning library's inserted leaf does not print as a colophon, was in the union,
in the disposition table and refused by the parser, so a leaf could not be
landed under the only role that describes it. It typechecked and the whole suite
passed. Found reading the front matter of _Isis Unveiled_ Vol. I, where five
leaves of HathiTrust and Cornell apparatus wanted exactly that role.

`ALL_PAGE_ROLES` is now derived from `DISPOSITIONS`, a `Record<PageRole, …>`
the compiler will not let miss a member, and the parser takes that list rather
than a copy. The test asserts the property over the roles **as a class** — every
role the disposition table knows parses, and what comes back has a disposition —
because a test naming one role is the same hand-written list again. Reinstating
the drift fails it; the version before the fix passed.

**A table could not be landed as a table, and notation inside a cell printed
as angle brackets.** Two faults in the same place, both found reading the
analytical contents of _Isis Unveiled_ Vol. I — 156 entries in 17 `table`
blocks, the first batch here made of them.

`parsePageTranscription` demanded `text` on every block, so a table handed its
`cells` and no text was refused — although the doc comment on `cells` says the
text is _derived from_ the rows and `normalizeTable`, four lines further down
the same map, derives it. "One canonical structure and one derived view" cannot
hold while the derived view is required input. And `normalizeTable` recomputes
`text` from `cells` **after** `parseInlineMarkup` has run over the block's own
text, so an `<i>` written inside a cell survived into the derived text verbatim
while the emphasis indices taken off the pre-normalized text went on describing
a string that no longer existed: the page would have printed the tags. The
marks are now read out of each cell and then **dropped**, which is the honest
answer rather than a shortcut — the engine sets a table one cell at a time,
each in a single font, so there is no path by which a run inside a cell could
be set in italic. Where the original italicises inside a table, that is worth
telling the editor, not worth storing as a mark the page cannot make.

`scripts/batch.mjs --check` had the same blind spot from the other side: every
check reached for `block.text` and threw `Cannot read properties of undefined`
on the first table, taking the whole run down. A crash there reads as "this
file is broken" rather than "this checker cannot see a table", which is worse
than not checking, because `--check` is the gate a batch passes before it is
landed. It now reads a table's words off its rows and validates that the rows
are rows.

**And a word-drift warning was right when the first measurement said it was
noise.** All five contents leaves came back about half the length of their
draft. The explanation offered — OCR reads a row of leader dots as words — was
correct, and the measurement written to confirm it counted only tokens that are
mostly full stops and put the debris at 3%, which appeared to refute it. The
dots come off Tesseract as word-shaped junk with two dots in twenty-seven
characters (`cu.vereunsnessessosssenessss`), so the filter measured the wrong
thing. What settled it was counting the entries on the render against the
entries in the file: 31 and 31. **A measurement that contradicts a sound
hypothesis is a measurement to check**, and the render is what either of them
has to answer to.

**The original's analytical contents, renumbered to this edition**
(`src/core/pages/analytical.ts`). `synopsis.ts` recovers one shape of original
contents — a paragraph under each chapter; this recovers the commoner one, a
list of the topics a chapter covers with the page each begins on. Vol. I of
_Isis Unveiled_ lists **156** of them, and they were being discarded with the
numbers beside them, which is the wrong half again.

The renumbering does **no arithmetic between the two paginations**, because
none is possible. An entry names a page of the 1877 printing; the leaf that
printed that folio is in the reading; the blocks off that leaf are in the
document; the engine reports which page each block opens on. So a topic travels
as a **block id** and its folio is measured by the machinery that numbers the
chapters. 155 of the 156 are placed — the odd one is `PREFACE`, which prints as
an entry in its own right.

Five things it took to get there, four of them faults:

- **A chapter opening prints no folio**, so the page an analytical contents
  names most often is the page no leaf claims. The first topic of all fifteen
  chapters was dropped. `folioToLeaf` **votes** the leaf-to-folio offset from
  the leaves that do print one and fills only the gaps, with the roman series
  voted apart from the arabic one and a series whose leaves disagree
  contributing nothing. Measured on this volume: 613 leaves print an arabic
  folio and all 613 agree on 58.
- **A chapter heading's flowable carries no `blockId`**, so it is not in
  `blockPages` and a topic pointing at one came back with no page at all. The
  topic points at the leaf's first passage of prose instead, which is the same
  page and where a reader following the entry starts.
- **The body prints `CHAPTER I.` and nothing else** — the name
  `OLD THINGS WITH NEW NAMES.` is in the contents alone — so the chapter's
  _title_ is the number and the contents group's _label_ is. Matching title to
  title and label to label found **0 of 15**; matching the body's title against
  the group's label finds 15.
- **`applyEdits` threw the whole thing away on the first correction**, which is
  the fault CLAUDE.md already records for the synopsis, recurring with a new
  field. `chaptersOf` carried `synopsis` by name and knew nothing of `topics`.
  It now names the keys `deriveChapters` _computes_ in a `Record` the compiler
  holds to the union, and carries everything else by default: a new recovered
  field is kept without anyone remembering, and a new derived one fails to
  compile until it is listed.
- And **a comment claimed more than the code did.** The folio's reserved lane
  was described as what keeps the two contents passes the same length. It is
  not: both passes measure to the same width either way, and what actually
  keeps them equal is that a topic line is emitted with its folio blank. The
  lane is tidiness. The fault injection is what said so — removing it changed
  nothing any test could see.

**And the two-pass guard can be blind.** Emitting a topic line only when it had
a number left pass one with no topics at all and pass two with 48, and
`layoutWithToc` did not notice: its guard compares the whole book's page count,
and in a book whose chapters open recto a contents one leaf shorter is absorbed
by the blanks that pad each opening to a right-hand page. The invariant is now
asserted where it lives — the same contents laid out with the folios blank and
with them filled, compared directly.

### A test that passes before and after the fix is not a test

This is the one that cost the most, because a green suite is exactly what
stops you looking. Four separate times this session a new test passed against
the _reinstated bug_. The habit that fixes it is cheap: reintroduce the fault,
watch the test fail, put the fault back. Anything less is a test of your
reasoning rather than of the code.

The specific shapes it took, all worth recognising:

- **A round trip is blind to a reader that ignores its input.** Answering
  every question with its own default and applying it to the profile it came
  from passes whether or not the answer is read, because the fallback _is_ the
  value being described. `frontTitleBorder` shipped as a `choice` answering
  `'yes'` into a reader that takes booleans, passed that test, and drew no
  border on any book. The property that catches it is **transfer**: build the
  questions from profile A, answer them with their defaults, apply them to
  profile B, and require B to become A.
- **The fixture has to be big enough to trip the fault.** Two chapters, then
  fourteen, both passed with the contents bug still in; forty spilled onto
  another leaf and failed. If the fault needs scale, build scale.
- **Assert the invariant, not a proxy for it.** Counting laid-out items looked
  like measuring length and was not: a blank reserved line advances the slot
  and emits no item. The invariant was the page count, which is what the guard
  itself compares.
- **Check what the coordinates mean before comparing them.** A positioned
  run's `xPt` is already absolute on the leaf, so adding the frame origin to
  it produced a confident assertion about the wrong number.

### Measuring, rather than looking

Eyeballing a rendered crop gave three different answers about the same ratio,
and one of them went into a comment and a test as though it were measured.
There is no image library here, but a PNG is `zlib` plus five filter types and
a scanline loop, which is about sixty lines of Node: decode the crop, sum the
dark pixels per row, and read the ink bands off the numbers. Do that before
writing a ratio down. The same rule the app applies to readings applies to
proportions: propose from sense, accept from pixels.

### The layout engine, where it surprises

- **The slot grid is one _body_ leading.** Anything set larger occupies
  several slots, so a subtitle at 1.1× the body silently doubled its own line
  spacing. Sizes just above the body size are the dangerous ones.
- **A rule hung on the grid falls a whole line from the type it underlines.**
  Hang it from the baseline instead, at a fraction of the _type's_ size. And
  hang it from the title's **last** line: on a title that wrapped, the first
  line is in the middle of the words.
- **Frame or trim, and never both.** The text frame is offset by the gutter.
  The folio is centred on the frame, so anything meant to line up with it must
  be too; the title-page border is struck from the trim, so the type inside it
  must be. Every misalignment on a finished page this session was two things
  measured from different origins.
- **A breaker centres inside the width you hand it.** `balancedLines`
  re-breaks at a _narrower_ width to even the lines out, so its output is
  centred in a box that is not the measure. Re-centre each laid line explicitly
  and the result stops depending on which breaker produced it.
- **A two-pass scheme must reserve in pass one everything pass two emits.**
  The contents printed its folio line only once the number was known, so pass
  two ran a line per entry longer, the guard caught the length change, and the
  safe fallback was pass one — which has no page numbers in it at all.
- **A guard's fallback has to report.** That contents shipped with no numbers
  and `warnings: 0` beside it. Silence is the failure mode, not the error.

### The apparatus, book by book

Two things that are supposed to be standing rules turned out to be habits, and
habits skip.

**A step done for one book is not done for the next.** _Clairvoyance_ carried
85 glossary marks; the combined volume carried a 74-entry glossary and not one
mark, and had no footnotes, and nothing anywhere said so. The book file, the
export report and the KDP checks were all perfectly happy.

**An editorial ruling leaks back in.** "Never tell the reader what to read
next" was settled, applied once by hand, and then four fresh directions
appeared across the two glossaries — one of them in the preamble, announcing
the practice as a feature.

Both are deterministic and neither is fully checked yet. Until they are, a
book is not finished until someone has asked, in these words: does every
glossary entry that names a word the book uses have a mark on that word? does
any entry tell the reader where to go next? has this book got the apparatus
the last one got?

**And the readable files are not the book.** `glossary.md` and
`introduction.md` are views of `book.json`; `corrections.md` and `notes.md`
make counted claims about it. All four are written once and then drift, which
is not hypothetical: the reading directions were taken out of two glossaries
and both books re-exported, and every one of them stayed in `glossary.md` for
a reader to find, along with a mark count five short of the truth.
`scripts/book-files.mjs <book-dir> --check` compares the four against the book
and exits non-zero on drift, so it belongs beside the tests rather than in
somebody's memory. Without `--check` it rewrites what is derivable, keeping
the title and the one-line description a person wrote at the top of each file:
those are the editor's sentences about this edition and no amount of reading
`book.json` would recover them.

**The order that keeps them together.** A change to a book is not one edit but
four, and doing three of them is how the shelf ends up describing a book it no
longer holds: write `book.json`, re-export the PDF, regenerate the readable
files, then commit and push _all_ of it in one commit. A commit that carries a
book file without its exports is a commit that has to be remembered later.

## Commands

```bash
npm install
npm run dev          # vite dev server on :5173
npm run typecheck    # tsc --noEmit
npm test             # vitest (the gating check — pure logic, no browser needed)
npm run lint
npm run format:check # prettier --check  (npm run format to fix)
npm run build        # typecheck + vite build → dist/

node scripts/make-test-book.mjs      # regenerate the 8-page test fixture
node scripts/make-test-epub.mjs      # regenerate the EPUB fixture
node scripts/make-test-digital.mjs   # regenerate the born-digital PDF fixture
node scripts/make-icons.mjs          # the app's icons, from the house fleuron
npm run check:install                # build under the Pages sub-path, then ask the
                                     #   one question a service worker cannot be read
                                     #   for: does it open with the network gone?
npm run check:outbox                 # with the dev server up: does a mark made
                                     #   offline reach the shelf when the connection
                                     #   comes back? The shelf is stubbed in the page.
npm run check:crop                   # with the dev server up: for a book whose scan
                                     #   is too large for the shelf, does the query
                                     #   gate draw the crop cut for it in advance?
npm run check:cache                  # with the dev server up: can a read of a book
                                     #   file answer the sha lookup for the write that
                                     #   follows it, or a later read of the book itself?
                                     #   (it could, and did — twice, one ruling lost)
node scripts/screenshot-flow.mjs     # drive the wizard headlessly, screenshot each screen
```

Working _on a book_ (see **How the work is actually done**, above):

```bash
node scripts/drive.mjs serve &       # hold a browser open, take commands on :7788
sh scripts/restart-servers.sh        # kill vite, chromium and the driver by pid and
                                     #   start them again; wait ~20s, retry the first verb
node scripts/drive.mjs load <book.json> <scan.pdf>   # from the shelf, not from the device
node scripts/drive.mjs body out.json # the assembled book: block ids and the exact
                                     #   strings an edit must be written in terms of
node scripts/drive.mjs ocr 12 16 19  # what OCR reads off named leaves, as plain text
node scripts/drive.mjs draft b.json 12 13 14   # those leaves as blocks, from the cached
                                     #   OCR — the free reading, to be corrected not trusted
node scripts/drive.mjs transcribe <scan.pdf> b.json   # land a checked batch; merges by
                                     #   `pageIndex`, never replaces, cross-checked against OCR
node scripts/drive.mjs sheet typos 28:occulist   # words cut from the leaves they sit on
node scripts/drive.mjs leaf 133      # any leaf, rendered
node scripts/drive.mjs leaf 133 tight 600 0.3,0.24,0.2,0.03   # a crop of it, at any DPI
node scripts/drive.mjs use <scan.pdf> # which book every later verb means
node scripts/drive.mjs book          # what that is now; `book clear` forgets it
node scripts/drive.mjs link review   # a URL that opens this book where decisions wait
node scripts/drive.mjs queries q.md  # decisions waiting on the editor, as a sheet
node scripts/drive.mjs memos         # notes the editor left for the assistant, with
                                     #   the text each sits in; `memos resolve <id>
                                     #   "<what was done>"` answers one — the memo
                                     #   stays, outcome attached, until the editor
                                     #   clears it
node scripts/drive.mjs select p12b3 "a candle flame"   # drag over words in the
                                     #   reading view, as a finger would — the one
                                     #   gesture no other verb could reach
node scripts/drive.mjs reading       # every passage the editor marked while reading,
                                     #   located by its words against the book as it
                                     #   stands; `--tag intro` is one pass's brief,
                                     #   `--json` hands it to a writing agent
node scripts/drive.mjs sweep --was "belleves"   # find across the whole book; free
node scripts/drive.mjs sweep --was "belleves" --now "believes"   # fix them all,
                                     #   emphasis kept, every change reported
node scripts/drive.mjs note p234b3 --after "committee of 1824" --text "…"
                                     #   an editor's footnote, set after those words;
                                     #   the prose is written in the voice and audited
                                     #   first — this only places it. `note list`,
                                     #   `note drop <id>`
node scripts/drive.mjs runs          # readings held here; `runs drop <n>` removes one
node scripts/drive.mjs state         # the gate as JSON; `answer` and `advance` work it

node scripts/drive.mjs figures f.md   # every picture the reading already found,
                                     #   leaf by leaf — a shortlist, not a check
node scripts/drive.mjs figure cut 193 0.527,0.532,0.389,0.175 --beside p193b1 --at "various kinds" --side right
                                     #   cut a figure out of the scan at 300 DPI and set it
                                     #   where the original set it: `--after <block>` at its
                                     #   printed size, `--in <block> --at "<phrase>"` mid-
                                     #   paragraph, `--beside … --side left|right` with the
                                     #   text run past it; `figure list`, `figure drop <id>`
node scripts/contact-sheets.mjs <renders> <out>  # the whole book, small, many to
                                     #   a sheet: the only thing that answers
                                     #   "is there a picture we have missed?"

node scripts/drive.mjs sweep --was "NA2CO3" --now "Na<sub>2</sub>CO<sub>3</sub>"
                                     #   `<sub>` is notation like `<i>` and `<b>`: a
                                     #   chemical formula's figures, set below the line

node scripts/book-files.mjs <book-dir> --check   # do the readable files still
                                     #   describe the book? regenerates them
                                     #   without --check
```

**Ask a book whether it has pictures, once, rather than hoping a reader looks
up.** `detectIllustrations` runs over every leaf during recon and its candidates
sit in the recon cache; until `figures` existed nothing could read them, so on
_Isis Unveiled_ Vol. I a plate reached the book only when a reader happened to
notice one, and five hundred leaves went by without the question being put.

Neither automatic signal is a check, and both were scored rather than trusted.
The ink test finds 1 of that volume's 3 plates; a scan for the OCR junk a plate
leaves behind finds 2 of 3. The miss is structural — `detectRegions` wants a
rectangle with no _words_ in it, and a figure with text run around it has words
on every side. Leaf 193 is exactly that and escapes both.

What does work is looking: 628 leaves tiled into 18 sheets, where a shape among
even grey columns is unmistakable. Be honest about its reach — a half-page
figure survives the reduction and a two-line diagram may not, so a clean sweep
is a floor rather than a census.

**Reading a leaf is `draft` → look → correct → `transcribe`.** Never type a leaf
out from the render: that is the generative act the whole design avoids, and a
reader producing text from an image alone has nothing to be wrong against.
`draft` turns the job into _"here is an image and here is a text, where do they
differ"_, which is the one shape of reading that cannot confabulate a paragraph.
Its `structural` list says what it guessed rather than measured, and is the
order to check things in.

**A decision that is the editor's is raised, never taken.** A compositor's
error, a place the book contradicts itself, a passage where "faithful to the
original" and "correct" pull apart: transcribe it **as printed** and attach a
`query` to the leaf (`src/core/queries`). Never silently correct it and never
silently keep it. There is deliberately no field for a proposed fix — a
suggestion beside a question is an answer in all but name, and the answer is
the editor's. `parsePageTranscription` refuses any field it does not know, so a
query can no longer be dropped with a green report beside it.

**Before committing: typecheck + test + format:check + lint.**

## The design philosophy that drives the UI

**The app interviews the user; it never makes them go find a setting.** Every
option starts life as a question asked at the moment it becomes relevant, with a
recommended answer pre-selected and the **evidence** for it attached — a word
crop, a page thumbnail, a rendered sample. Nobody should need to understand the
program's structure to use it.

Practical rules:

- **Questions are data, not screens.** A step returns `Question[]`; `QuestionView`
  renders whatever it gets. Adding a question needs no new UI code — and the
  whole flow is unit-testable with no DOM.
- **Batch into gates, don't drip.** 200 terms are one grid with accept-all, not
  200 prompts.
- **Never ask what isn't relevant yet** (no chapter-ornament question before we
  know the book has chapters).
- **Never ask what the app could find out first.** A question belongs at the
  point where the app can _help_ answer it. The title, author and year are asked
  at the export gate, after the vision pass has read them off the original title
  page, so the fields arrive prefilled with the scan beside them — not at Gate 1,
  where they were three empty boxes and a trip out of the browser.
- **Show the pixels.** Never ask "is this word right?" without the scan beside it.
- **Answer once, apply everywhere.** Confirming a term fixes it book-wide.
- **Correct content, never presentation.** The proof step fixes what the page
  _says_ and what a block _is_. It deliberately offers no per-paragraph indent
  and no manual line break: the book reflows to whatever measure the design gate
  settles on, so those are not corrections but damage. A paragraph needing
  different treatment gets a different kind, which the style system then applies
  consistently.

## Architecture in one breath

- `src/core` — **pure domain logic, no DOM and no Node.** Coordinate map, hOCR
  parsing, lexicon harvesting, page roles, the wizard step machine, assembly,
  design-by-interview, image algorithms, **the layout engine** (frames,
  Knuth–Plass line breaking, pagination, footnotes, illustrations, ornaments,
  the TOC), the ornament library, the edition/export report, style system. This
  is where the tests live.
- `src/platform/browser` — the only place browser APIs appear: PDF.js rendering,
  Tesseract.js OCR, canvas crops, the recon runner, font loading, the pdf-lib
  writer, and the page preview.
- `src/app` — the React wizard shell (`App.tsx`), the generic question renderer
  (`QuestionView.tsx`), the live page preview (`PreviewPane.tsx`), the export
  screen, and a dev-only `#preview` route for looking at gates that sit behind
  the paid run.

Path aliases: `@core`, `@platform` (defined in `tsconfig.json`,
`vite.config.ts`, and `vitest.config.ts` — update all three together).

### Conventions that matter

- **Core stays pure.** No `node:` imports, no `window`/`document` in `src/core`.
  Platform work belongs in `src/platform`. This is what keeps the flow testable.
- **API keys stay in the browser.** The key is the user's, stored locally, and
  sent straight to the API — there is no server to proxy through. Never log it,
  never put it in a prompt, never commit it.
- **Honest flag tiers** (SPEC §4): OCR confidence is a real probability; a model's
  self-assessment is not. Never gate a check on a model's opinion of its own
  output — escalation is decided by _deterministic_ cross-checks (OCR
  disagreement, word-count drift, structure anomalies).
- **OCR is the independent witness, not the source of truth.** Its value is that
  it isn't a language model, so it has no shared blind spots with the vision
  pass, and it supplies the bounding boxes the coordinate map needs.
- **Front matter is replaced, not transcribed.** The original title/copyright
  pages are _sources of metadata_; the scanned TOC and index carry the original
  edition's pagination and are discarded. The contents page is regenerated with
  numbers this edition actually prints (`src/core/pages`, `src/core/layout/toc`).
- **A note that cannot be placed is reported, never dropped.** `notesDropped`
  travels from the engine to the export screen. Silence here is the worst
  possible failure: the reader finds the missing footnote once it is printed.
  `imagesDropped` and `missingImages` are the same rule for pictures, and
  nothing is drawn in place of one — a grey placeholder box in a book for sale
  is worse than a gap the user was told about.
- **A model may propose a reading; only pixels may accept one.** With a scan,
  the model reads a page against the image and OCR is the independent witness
  that catches it drifting. Given only garbled text and no picture, it has
  nothing to be right _against_: it returns fluent, confident, partly-invented
  prose, and no downstream check can tell. For a public-domain reprint that is
  the one unrecoverable failure.

  This used to read "never repair text without pixels", and the rule has not
  moved — only the wording, because it forbade something worth having. Sense is
  the one check with _meaning_ available: `a fate that could move mountains` is
  two real words either side of one wrong one, both scanning, both what OCR saw,
  and nothing mechanical will ever catch it. So a pass that reads the assembled
  prose and says **"this does not cohere, and I would expect X"** is not the
  forbidden thing. Acting on X without looking is.

  The line is therefore drawn at the artefact, not at the activity. A reader
  without pixels emits a **finding** — a place, a reason, and a hypothesis
  marked as one. A finding becomes an edit only after a reader _with_ the crop
  has said what the paper says, and that reader is shown the crop before the
  hypothesis, because a model shown both confirms rather than reads. What must
  never be added is a pass whose output is text: a "clean this up" step that
  hands back prose instead of a list of places to look.

- **What needs reading is a structural question, not a statistical one.** Good
  OCR of a clean scan is made of `chirnrgeon` and `thc` — shaped exactly like
  words — so no measurement of word shapes can decide whether a file's text can
  be trusted. What can decide it is whether the page _is a photograph_:
  `looksScanned` tracks the transformation matrix and asks whether one image
  covers the page. `@core/textquality` is the other half and answers a
  different question — how _damaged_ a text is — which it does see well, and
  which is what warns about an EPUB that has no pixels behind it at all.
- **Never invent resolution.** Illustration crops are taken at the DPI the page
  renders at and placed at exactly that pixel size. Rendering a page larger to
  make the DPI number look better only interpolates pixels the scan never had:
  the print is no sharper and the KDP check that would have warned the user has
  been argued out of its warning. See `src/platform/browser/illustrations.ts`.
- **The preview is the PDF.** The design gate lays the book out, writes real PDF
  bytes and renders _those_ with pdf.js. Never add a second renderer that
  approximates the page — one renderer is what makes the gate's approval mean
  something. `layout()` is a pure function of its inputs, so the footnote
  re-flow and the two-pass TOC are "run it again", not mutable state.
- **Every glyph the book prints must have a width.** pdf-lib writes `/W` and
  `ToUnicode` from the glyphs a _code point_ reaches, so a ligature, a
  contextual alternate or a small capital gets neither: a full em of white space
  mid-word, and a page that copies out as line noise. `font-widths.ts` widens
  the list to what the book uses and `renderPdf` **verifies** it, raising rather
  than writing a book with holes. That check is only sound because `drawPage` is
  the single place text is drawn — keep it that way.
- **Measure with the engine that draws.** The `TextMeasurer` sums the advances
  of the glyphs `fontkit.layout()` returns, which is the same call pdf-lib makes
  to encode text. Measuring with anything else is how WYSIWYG breaks.
- **Memory discipline.** A 300-DPI page is ~19 MB of pixels; a 300-page book held
  at once would be ~5.8 GB. Recon renders, consumes, and releases one page at a
  time. Never accumulate page canvases.
- **Object URLs must be revoked.** Crops and thumbnails leak otherwise — see
  `releaseRecon`.
- **The loop is in the tab, unless it isn't.** The sequential runner sends one
  page and waits for the reply before building the next, so the reading stops
  dead when a phone locks — nothing on Anthropic's side knows there is a book,
  only three hundred unrelated requests. A wake lock and a checkpoint soften
  that; only the **Message Batches API** removes it, by moving the loop off the
  device (`src/core/transcribe/batch.ts`). What it costs is the seam context —
  page N's request is built before page N−1 has been read, so the tail is the
  previous leaf's _OCR_ and the prompt says so.
- **The batch door is built and, from a browser, currently shut.** The
  `anthropic-dangerous-direct-browser-access` opt-in that makes this
  server-less app possible is honoured **per endpoint**, and it covers
  `/v1/messages` but not `/v1/messages/batches`. Measured, not assumed: a
  preflight for any batch path returns `400 Disallowed CORS origin` with no
  `access-control-allow-origin`, for every origin, while the same preflight for
  `/v1/messages` returns `200` and `access-control-allow-origin: *`. Nothing in
  a page can argue with that, and the usual fix — proxy it through your own
  server — is the one thing this app has never had. So the offer is **probed
  rather than hard-coded** (`platform/browser/batch-reach`): the gate asks the
  server once per session and withdraws the question when the answer is no, so
  the day the header is extended the door opens with no change here.
- **A batch id is the only address of work already billed for.** So the ticket
  (`src/core/project/batch-ticket.ts`) is written after every batch is created
  and before the next page is rendered, a failed ticket write **stops** the
  submission, and the ticket is deleted only once every page is in the run. It
  is the one record here that is never capped, never evicted and never cleared
  by "don't keep book data on this device": everything else in the store costs
  time to replace and this costs money.
- **Only the paid step is persisted.** Everything else — rendering, OCR, the
  lexicon, assembly, layout — is free and repeatable, so the saved unit is the
  transcription, keyed to the file it came from (`src/core/project`). Reopening
  a book redoes the free half and _offers_ the paid half back as a question.
  Bump `CURRENT_SCHEMA_VERSION` and extend `migrateSavedRun()` in
  `src/core/project/saved-run.ts` on any shape change; it throws rather than
  returning a partial run, because a half-restored transcription looks like a
  book that was read and prints with holes in it.

### Pinned dependencies (deliberate)

- **`pdfjs-dist` v4** — v6 uses JS features not yet in every current browser.
- **`tesseract.js`** — its `main` is CommonJS with no `module` field, so the app
  imports `tesseract.js/dist/tesseract.esm.min.js`, which exposes only a
  **default** export.
- **Tesseract assets are vendored** into `public/tesseract/` (worker, WASM core,
  language data) rather than fetched from a CDN, so the app works offline.
- **Book faces come from `@expo-google-fonts/*`, not `@fontsource/*`** —
  fontsource ships only WOFF/WOFF2, which pdf-lib cannot embed.
- **`pdf-lib` fonts are embedded whole, with ligatures off.** Both are forced,
  and both fail silently if reverted: `{ subset: true }` corrupts the outlines
  of EB Garamond, Cardo and IM FELL English, and the whole-font embedder writes
  no width for a ligature glyph. The reasoning and the evidence are in
  `src/platform/browser/pdf-out.ts` and `fonts.ts` — read them before changing
  either, because nothing in the test suite short of looking at a rendered page
  catches the first one.
- **Junicode is vendored by hand** into `public/fonts/junicode/` (see the README
  there). It is not on npm and is loaded on demand; until it is present the app
  substitutes EB Garamond and says so.

## Verifying UI work

This sandbox has Chromium + Playwright, so **UI changes are verifiable here** —
run `node scripts/screenshot-flow.mjs` against a dev server and look at the PNGs
in `screenshots/`. Don't ship UI blind.

## Status

- **Done**: browser pipeline (render → OCR → harvest), lexicon builder, wizard
  step machine + question contract, Gate 1 (book identity + term review), and
  the vision pass engine (schema, prompt, client, runner, verification, cost) —
  all tested with a mock transport, so no API key or spend is needed to run the
  suite.
- **Also done**: the transcribe step is wired (key entry, cost approval,
  progress, cancel), assembly stitches pages into a book document (seam repair,
  hyphen healing, footnote linking, front-matter dispositions), and Gate 2
  surfaces flagged pages with the scan beside each.
- **Also done**: Gate 3 (structure confirmation).
- **Also done**: design-by-interview, and **the layout engine** — Knuth–Plass
  line breaking with Liang hyphenation, baseline-grid pagination with widow and
  orphan control, front matter, running heads, folios, recto chapter openings
  and drop capitals. The design gate now shows **real pages from the finished
  PDF**, and the export downloads that PDF. Because the page count and the
  layout warnings are measured, both KDP checks that used to report `pending`
  now report the truth.
- **The open TeX question is closed, and the LaTeX path is gone.** No browser
  TeX is needed: the app lays the book out itself and pdf-lib writes the file.
  `src/core/typeset` is now only the KDP checks.
- **Also done**: **footnotes** — set at the foot of the page their reference
  falls on, renumbered straight through the book, with the space reserved as
  lines are placed — and a **table of contents with measured page numbers**,
  laid out twice so the second pass cannot invalidate the first.
- **Also done**: **save and resume.** A finished transcription is stored in
  IndexedDB against the file's identity, so a refresh, a crash or a closed tab
  no longer costs the user the one thing they paid for.
- **Also done**: **ornaments in the PDF** (vector paths in `src/core/ornament`,
  placed by the engine and drawn with `drawSvgPath`), **collected endnotes** for
  notes whose reference mark is nowhere in the body, and moving the title,
  author and year questions to the export gate where they arrive prefilled.
- **Also done**: **proofreading** (`src/core/edits`) — each source leaf beside a
  readable render of its scan, with the text editable, blocks retypeable and
  pictures re-anchorable. Corrections are a _list_ applied over the pristine
  transcription, exactly like the image op stack, and are saved with the run
  (schema v6). Before this there was no way to fix a single wrong word.
- **Also done**: **the editor's own notes**, written at the proof step and set
  by the existing footnote machinery — placed, renumbered through the book, and
  collected as endnotes when they cannot be placed. Located by an explicit
  anchor rather than by splicing a marker into the text. This is the first thing
  the app can _add_ to a book rather than recover from it, which is what a
  public-domain reprint needs to be publishable.
- **Also done**: **illustrations** — detected from the OCR word boxes and an ink
  test on the pixels, reviewed one by one at Gate 3, cut out of the scan at
  render resolution, set to the measure (or given a leaf of their own), with the
  caption pulled out of the text flow and put under the picture. The KDP
  image-DPI check is measured from the placed size.
- **Also done**: **the image-editing mode** of SPEC §6 — crop by dragging,
  straighten, brightness, contrast, levels, despeckle, grey and threshold, on
  pictures cut from the scan and supplied alike. `src/core/image/engine` is
  wired at last. Non-destructive: the stack is re-applied over the original
  pixels every time, and the core resolves only the _size_ it leaves, through
  `sizeAfterOps`, because the DPI check divides by it. Background removal is
  deliberately not offered — the spec calls it best-effort, and without manual
  touch-up of the selection it is a magic button that eats part of the picture.
- **Also done**: **saved style profiles** (`src/core/style/saved-profile.ts`) —
  the book-two problem. A look is banked once and offered at the design gate on
  every later book, which then asks one question instead of five; the imprint
  and copyright holder ride along, while the ISBN, edition statement and
  publication date deliberately do not. What may be banked is enforced by
  `BANKED_STYLE_KEYS`, not by convention, so adding a field to `StyleProfile`
  fails a test until someone decides which of SPEC §7's two levels it belongs
  to. This also retired `ProjectFile` and the 141 lines of Electron-era model
  scaffolding reachable only from it.
- **Also done**: **Junicode**, vendored into `public/fonts/junicode/` with its
  licence beside it — the only CFF outlines here, so pdf-lib writes a
  `FontFile3` no other face exercises.
- **Also done**: **ligatures, contextual alternates and real small capitals.**
  All three were one bug: pdf-lib builds the PDF's width array from the glyphs a
  _code point_ reaches, so anything else printed as a full em of white space and
  copied out as line noise. `src/platform/browser/font-widths.ts` widens that
  list to the glyphs the book actually uses, and `renderPdf` verifies rather
  than hopes. Small capitals then needed no glyph-level draw path at all —
  pdf-lib applies features per embedded font, so a small-caps run is the same
  bytes embedded again with `smcp` on.
- **Also done**: **tables.** Matter set in columns is a `table` block carrying
  its `cells`, and its `text` is a _derived_ flattened view (rows on lines,
  cells separated by `|`) so the word-count cross-check, the seam checks and
  the proof editor all keep reading a page as prose. `normalizeTable` is the one
  place the two are reconciled, and it runs wherever a table can enter the book
  — the model's reply, assembly, and every correction — so they can never
  disagree. The engine sets one flowable **per row**, unbreakable: a long table
  breaks between rows without the pagination machinery knowing tables exist.
  Columns of figures are set to the right, heads in italic over a rule.
- **Also done**: **cross-page verification** (`src/core/transcribe/verify-book.ts`)
  — the other five checks compare a page against the OCR of _that page_, so a
  leaf missed, mis-ordered or read twice was invisible. Three deterministic
  comparisons across pages, with quorums and length floors so a book without
  running heads produces nothing rather than one finding per page.
- **Also done**: **Gate 1's term verdicts count** (`src/core/lexicon/vetted.ts`).
  The answer used to be read by nothing while the prompt called the raw harvest
  "confirmed as correct"; rejecting a word made the app insist on it.
- **Also done**: **the editor's voice, and notes written in it**
  (`src/core/annotate`). The first thing the app _writes_ rather than recovers,
  and the reason a reprint is worth publishing. The voice is a persona card plus
  exemplars carried in the prompt — there is no fine-tune and should not be —
  and the exemplars are **accepted notes in the form they were accepted in**, so
  a rewritten note teaches the rewrite. Rejections teach nothing on purpose. The
  model is never asked for a character offset: it quotes the words the note
  hangs on, `findAnchor` locates them, and a quote it cannot find comes back
  _unplaced_ rather than attached at a guess. Every date, figure and name a note
  asserts is compared against the book's own text and the difference is shown as
  the list to check — deterministic, so it is a flag that means something under
  SPEC §4. An approved note becomes exactly the `note` edit a hand-typed one
  produces. The introduction shares the card and is written from the book's
  shape plus evenly spaced extracts, because a model handed three hundred pages
  summarises the last twenty.
- **Also done**: **the fact bank** (`src/core/harvest`) — what each book leaves
  behind after it is printed, so a shelf of reprints becomes material to write
  _from_. Built around **primary attestation, not summary**: a model already
  knows the general history of any subject an old book covers, so an entry that
  restates an encyclopaedia buries the ones that are actually primary, and the
  prompt says so. `footing` (`stated` / `implied` / `context`) is the field that
  makes the file usable years later, and it is **enforced** — a `stated` entry
  whose quotation cannot be found in the book is demoted to `context` with the
  demotion printed. Tags accrete rather than drift: the vocabulary already in
  use travels into the prompt, the same technique as Gate 1's confirmed
  vocabulary and the voice exemplars. Two paths, priced apart — riding the
  annotation reply costs output tokens only, while a book worth mining and not
  worth annotating gets a standalone pass that also harvests tables. Exports as
  Markdown to read and JSONL to merge, with the book on every record so
  `cat *.jsonl` works. Nothing merges _across_ books on purpose: two books
  attesting the same thing is corroboration, and only whatever consolidates the
  files later can see enough to judge it. Approved notes are banked free.
- **Also done**: the four pieces of typographic polish that were left. **List
  items hang their markers** (a negative first-line indent, so wrapped lines line
  up under the text rather than under the number). **Running heads are cut to
  fit** — subtitle first, then a leading article, then a word-boundary truncation
  with an ellipsis, all measured with the engine that draws. **Optical margins**
  (`src/core/layout/optical.ts`) hang punctuation past the margin so the ink
  lines up rather than the box; it runs _after_ line breaking, so switching it
  changes no break and no page count, and it is skipped on a paragraph's short
  last line where there is no edge to align against. And **any leaf of the
  finished book can be looked at** (`src/app/PageBrowser.tsx`), rendered from the
  exported bytes — the design gate's four-page sample answers questions about the
  look but never shows the page a note actually landed on.
- **Also done**: **the uncertainty gate shows the text, not just the scan**, and
  **review verdicts survive a refresh**. The gate asks whether a transcription
  is good enough to keep and showed only a thumbnail — which cannot be
  proofread. `WizardState.pageText` carries what was read off each leaf, built
  in the one place both a fresh run and a restored one pass through. The
  verdicts themselves go to `localStorage` keyed by file, not into the saved
  run: that record is megabytes of transcription and rewriting it on every
  radio click would make a long book stutter. The transcription costs money and
  was always stored; these cost _time_, and used to be thrown away while the
  pages they applied to were carefully kept.
- **Also done**: **"I'll fix this myself" is its own answer** at the uncertainty
  gate. Accepting a page used to mean both "I checked it and it's fine" and "I
  can see exactly what's wrong and I'll correct it" — and the second reading
  erased the finding at the proof step, which is where the correction would have
  been made. The two are now separate answers, and the second travels as
  `Attention` (`src/core/edits/proof-sheet.ts`): the leaf keeps its note, gets
  its own jump button, and leads the flag list with the user's own words rather
  than a cross-check's. The same channel reports a recovered passage the app
  could not place, which was silently dropped before — the footnote rule applied
  to the other repair that can fail.
- **Also done**: **the uncertainty gate can fix a leaf, not only judge it.**
  Being shown a discrepancy and offered "keep it", "pay to read it again" or
  "leave it out" is three wrong answers when the mistake is one word and it is
  on the screen. A `page-edit` question carries the leaf's own passages and its
  answer is `blockId → corrected text`, holding only what changed — so a fix
  typed here becomes exactly the `text` edit the proof step produces and needed
  nothing new in layout, storage or export. The answer starts _empty_ rather
  than seeded with the current text, and `withCorrections` drops anything equal
  to it, because seeding would write an edit over every block on every flagged
  leaf and report the whole book as corrected. Passages are grouped under the
  leaf they _began_ on, matching the proof sheet. Where a hand correction meets
  the automatic one, the hand wins: a retyped leaf is no longer auto-restored,
  and the recovered passage is handed back through `Attention` rather than
  spliced in over the user's own words.
- **Also done**: **the reading of a scan is kept** (`src/core/project/recon-cache.ts`
  for the rules, `src/platform/browser/recon-cache.ts` for the storage). Render,
  OCR and harvest are free and repeatable, which is why they were never stored —
  but free is not quick, and reopening a book to fix one word meant ten minutes
  of Tesseract first. Measured in the harness: **7.9 s cold, 82 ms warm.** The
  record holds **Blobs**, not object URLs, since a URL names a Blob in a tab that
  has since closed; rehydrating mints fresh ones that `releaseRecon` frees as
  usual. What is worth the pure module is knowing when to _refuse_ one: a
  different DPI puts every word box, crop and illustration region somewhere else
  and makes the KDP image check divide by a number the pixels never had, and a
  partial "try a few pages" reading handed back as the whole book is a book
  missing its second half in silence. Both are misses, and a miss is deleted
  rather than refused daily — unlike a transcription it costs only time to
  replace. Written only when the user has agreed to book data being kept here,
  the same answer that governs storing the scan.
- **Also done**: **evidence you can actually read.** Every gate promises you
  never decide blind, and then showed a 150-pixel thumbnail of a page of dense
  type and a word crop squeezed into a table cell — enough to prove a page
  exists, useless for the job being asked. Anything shown as evidence now opens
  full size (`src/app/Lightbox.tsx`), rendering the leaf on demand at readable
  resolution rather than blowing up the thumbnail. The term grid's context peek
  is portalled to the body and sized in viewport units, because the grid it
  hung off scrolls sideways and was clipping it to the width of a cell.
- **Also done**: **italics are visible where they can be corrected.** The
  emphasis the pass recovers reaches the PDF — that chain was complete and is
  now tested end to end, down to the word being drawn from a second embedded
  font and extracting correctly. What was missing is that a textarea has no
  italics, so the emphasis was invisible at the proof step and the gate:
  impossible to confirm, impossible to add where the pass missed it, and
  silently discarded by retyping the paragraph. `withMarkup` puts the `<i>`
  tags back for editing and `applyEdits` reads them straight in — the same
  derived-view trick a table already uses for its columns. That exposed a real
  bug behind it: restoring a dropped passage spliced into the bare text and
  discarded the host paragraph's emphasis, so `spliceRunInto` now carries the
  word indices across the join.
- **Also done**: **a gate is worked through one decision at a time.** Gate 2 on
  a real book is forty flagged leaves, each a verdict plus an editor carrying
  the passage it is about — one wall of scrolling that is unusable on a phone
  and intimidating on a laptop. The same questions are now shown a group to a
  screen, with a bar that fills as leaves are finished and the place kept in
  `localStorage`, so closing the tab and coming back lands on the leaf you left
  rather than on the first one. What a group _is_ comes from the step's own
  `group` field (`groupQuestions`), never from a renderer parsing `page-9-fix`
  out of an id — a contract nobody wrote down is a contract nothing tests. The
  pager is **controlled**, holding no copy of the place: a local copy seeded
  from a prop has to be re-seeded when the prop arrives, and the prop arrives
  after the child's first effect, so the seeded copy wins and the remembered
  place is silently ignored. The forward action is held back until the last
  screen, because a "continue" button beside "next leaf" on leaf three of forty
  is an invitation to skip the other thirty-seven by accident.
- **Also done**: **the reading survives a phone.** Two halves of one problem.
  The screen is held awake while a long job runs
  (`src/platform/browser/wake-lock.ts`) — a phone that dims and locks takes the
  tab down with it, which is the commonest reason a ten-minute read never
  finished. The lock is released by the platform whenever the page is hidden
  and _not_ given back, so it is re-acquired on `visibilitychange`; without
  that, glancing at another app once would silently undo it for the rest of the
  run. It cannot keep work going with the screen off or the tab backgrounded —
  nothing in a browser can, workers included — so the other half is that recon
  **checkpoints** every 20 leaves and a fresh run carries on from where it
  stopped. `pagesDone` is what tells a checkpoint from a finished reading, and
  `reconCacheUsable` refuses to hand a partial one back as a whole book.
- **Also done**: **EPUBs, which cost nothing to bring in** (`src/core/epub`,
  `src/platform/browser/epub.ts`). A great deal of public-domain text is
  already digital — Gutenberg, Standard Ebooks, archive.org — and every part of
  this app that exists to _recover_ a book has already been done for it by a
  person. So an EPUB skips render, OCR, the term review and the paid vision
  pass entirely and joins the flow at the structure gate, gaining everything
  after it: the proofing workbench, notes and an introduction of the editor's
  own, the fact bank, the design interview, and a KDP-legal PDF. No new
  dependency — the archive's central directory is parsed as bytes in core and
  `DecompressionStream` inflates the entries — and no second implementation of
  anything: `<i>` is serialised back to the notation `parseInlineMarkup`
  already reads, so italics from an EPUB and italics from a scan arrive as the
  same word indices. What is worth knowing: the reading order comes from the
  **spine**, never from the manifest or the archive, because a guessed order is
  a book with shuffled chapters; `linear="no"` matter is left out or the cover
  prints mid-book; the author is the `dc:creator` marked `aut`, or a reprint
  gets credited to its 1913 translator; and `dc:date` is usually the _ebook's_
  year, so it is offered at the export gate rather than believed.
- **Also done**: **the app measures what it has been handed instead of trusting
  the file extension.** Two assumptions were wrong at the edges, and the edges
  are where the real books are: an archive.org EPUB is _machine OCR with no
  images_, believed completely, and a born-digital PDF carries flawless text
  that was rasterised, OCR'd for ten minutes and then paid for a second time.
  Now `looksScanned` asks the structural question — does one image cover the
  page? — and a typeset PDF has its own words read straight out of it, shaped
  as `OcrWord` with confidence 100 so the coordinate map, the lexicon, the ink
  test and the cross-checks all work unchanged. **Measured: 1.4 s against ~8 s
  of Tesseract**, and Gate 1's term grid disappears entirely, because nothing
  read those words and there is nothing to vet. `@core/textquality` runs
  alongside it to describe _damage_, which is what warns on an EPUB with no
  pixels to fall back on. The scan fixture now carries a sheet of paper under
  every leaf, because it claims to be a scan and the app can now tell.
- **Also done**: **the reading can leave the tab.** The wake lock and the
  checkpoints treat the symptom; the cause is that the sequential runner's loop
  lives in the page, so a locked phone stops the book where it stands. The
  **Message Batches API** moves the loop to Anthropic's side: every leaf goes up
  in one submission, the tab can close, and the results are collected in a
  session that may be days later on another device. **Half the price**, which on
  a three-hundred-page book is a number a person would answer differently, so
  the gate quotes both and lets them choose. What makes it work is chunking and
  a receipt. A batch takes 256 MB and a scanned leaf is one to two megabytes of
  base64, so a long book is _larger than one batch_ — and the body is stringified
  whole, so the ceiling that binds is the phone's, not the server's: pages are
  packed into 32 MB chunks, rendered into the chunk being filled and released
  with it. The ticket is written after each batch is created and before the next
  page is rendered, because from the instant a batch exists those pages are
  being billed and the id is their only address; a ticket that will not save
  **stops** the submission rather than uploading more of them. A page submitted
  and never returned is reported as a failure, never dropped — the footnote rule
  applied to the one repair that costs money. What is given up is honest and
  said at the gate: no live progress, and the seam context is the previous
  leaf's OCR rather than its finished reading, because page N's request is built
  before page N−1 has been read. **It does not work from a browser yet** — the
  batch endpoints refuse the direct-browser-access origin, as above — so the
  question withdraws itself and the sequential door is what runs. The whole path
  is exercised end to end against a stubbed API in `screenshot-flow`, including
  the reload that proves the ticket outlives the tab.
- **Also done**: **the gate points at the missing words instead of counting
  them.** A real book showed "18 words OCR read clearly are absent" above a
  thumbnail of a dense leaf and one four-word offer — leaving the other fourteen
  to be found by eye, in two panes. Everything needed to point at them was
  already in hand and thrown away: OCR boxes every word, the alignment already
  knows which words are missing and what sits either side of each gap, and Gate
  1's term grid already cuts a word out of a scan. Each disagreement is now a row
  carrying the word as it appears on the paper, its place in the transcribed
  text, and a verdict. Runs under four words are kept and marked `weak` rather
  than discarded, which is what produced the eighteen-against-one. Nothing is
  pre-selected: OCR is the rougher of the two readers, so a default that put
  every gap back would copy its misreadings over a transcription bought from a
  better one. Three false-positive classes went with it, all the same shape — a
  leaf's text compared against a body it was never going to reach.
  `checkableText` counts the running head and folio as transcribed (they are, in
  `furniture`); `dispositionFor` exempts leaves that are mined for metadata or
  discarded, which is what had the title page reporting the whole imprint as
  missing and offering to splice it into chapter one.
- **Also done**: **a second reading of the flagged spots** (`src/core/adjudicate`),
  before any of them reach a person. Most of those decisions do not need a
  human — they need someone to look at the pixels again, which is what the first
  pass did not do for these spots in particular: it read the whole leaf once, at
  speed, with a book to get through. One request per flagged _leaf_, carrying
  its image and every spot on it, because the image is nearly all of the cost;
  clean leaves are never sent, so a book the checks were happy with costs
  nothing. Two rules shape every line of it. **Never repair text without
  pixels**: the image goes with every request and the schema has no field for
  what the text ought to say, only for what the page _does_ say. **Never gate a
  check on a model's opinion of its own output** (SPEC §4): the prompt never
  says "you transcribed this" and never asks whether the earlier reading was
  right — that is self-assessment and carries no weight — it asks it to read a
  place on an image. The answer reaches the gate as a recommendation _carrying
  the reading it rests on_, so it can be checked against the crop beside it, and
  it removes nothing. Its worst outcome is the behaviour it replaces: a leaf it
  cannot read leaves its spots unadjudicated, exactly as they arrived before.
  Wired into both doors, because putting it only in the live runner left anyone
  who took the batch path without it.
- **Also done**: **the notes pass survives an interruption, and can be stopped.**
  It was the one paid step with nothing on disk while it ran: a book was read in
  chunks, every proposal was held in memory, and a locked phone or a closed tab
  lost every chunk already billed for. It now writes after **each** chunk
  (`src/core/project/annotation-checkpoint.ts`) and the gate offers what was
  bought back — carry on, take what is there, or start over — the same bargain
  the transcribe gate strikes with a saved run. Notes are stored _unlocated_:
  the offset a mark goes at is re-found against the book as it stands when they
  come out, so a paragraph corrected in between cannot put a mark inside a word.
  Resuming is refused when the body has changed (`bodyKeyFor`), because the
  chunks the record calls done would no longer describe the text a resumed run
  skips — a stretch of book unread in silence; the notes are still offered, only
  the resume is withdrawn. And the runner's `isCancelled`, which existed and was
  wired to nothing, is now a button: stopping keeps what has been read, charges
  nothing further, and does not carry the user past a gate they just declined.

- **Also done**: **a book is one file, and the shelf is a repository.** Every
  store this app had belongs to one browser on one device: clear the site data
  or pick up the laptop and the transcription that cost money and the evening of
  proofreading that cost time are both gone. `src/core/project/book-file.ts`
  puts the lot in one JSON — transcription, corrections, notes, introduction,
  supplied pictures and their retouches, the second reading's verdicts, the fact
  bank, every gate answer and the voice — and `src/core/sync` plus
  `platform/browser/shelf` write it to a git repository of the user's own with
  their own fine-grained token, on their own, whenever something expensive or
  laborious is finished. Still no server and still no account. What decides the
  layout is that **git keeps every version forever**: the file rewritten on each
  save is the small one, and the scan goes up **once** under its own SHA-256, so
  re-saving costs kilobytes rather than another scan. A catalogue card of a few
  hundred bytes sits beside each book so the intake screen can list a shelf
  without downloading it. Pictures are base64 and everything else is plain text,
  because a book file should diff in a repository and be readable by a person
  wondering what the app kept. The token lives where the API key lives and
  **never** enters a book file — a credential that reached one would be
  published the moment that book was saved — and the Settings panel says out
  loud when the repository it just connected to is _public_, because a git
  history cannot be taken back. `SavedRun` v10 carries the fact bank for the
  same reason: until now those entries lived in a React state variable and
  vanished on a refresh, so a book file written from a reopened session would
  have been quietly short of what was paid for.

- **Also done**: **the app can be driven from outside the tab**
  (`src/core/control` for the protocol, `src/app/agent-surface.ts` for the one
  place a command is executed, `scripts/drive.mjs` and
  `src/platform/browser/control.ts` for the two transports — see
  [`docs/CONTROL.md`](./docs/CONTROL.md)). Questions being _data_ is what makes
  it possible: a controller reads the gate as JSON and answers by id, so it
  drives the app rather than a copy of it, and both transports go through the
  same surface because a driver that clicked buttons while a bridge set state
  would disagree with it exactly where it mattered. Two rules are enforced
  rather than trusted, and both are tested against the real step machine instead
  of against themselves. **Nothing here can spend money**: the paid gates all
  stop at a button that names a price, so a controller advances freely and
  reports the number for a person to decide — and the one place the app spends
  with no quote, a leaf marked `redo` at the uncertainty gate, is refused by
  name, from the answers about to be committed. **No credential travels the
  channel**, in either direction: the key question keeps its prompt and loses
  its content, and setting one is refused. Evidence crosses as a `ref` rather
  than an object URL, because a `blob:` that resolves to nothing outside the tab
  that minted it looks exactly like evidence and is the one thing every gate
  here promises not to do; a discrepancy's crop is cut only when it is asked
  for, so reading one gate does not render the whole scan. The repository
  transport rides the shelf's rails — no server, no account, the same token
  rules — writes its reply _before_ running the command so a tab that dies
  cannot leave `advance` to be run twice, and puts a panel on screen the whole
  time it is live, because an app that can be operated remotely and shows no
  sign of it is indistinguishable from one that has been taken over.

- **Also done**: **a book read before there was a shelf can be put on one, and
  the editor's own pictures are written beside it rather than inside it.** The
  shelf save runs once, when a reading finishes, and does nothing when no shelf
  is configured — so connecting a repository afterwards left every book already
  on the device invisible to it, with the device's own list still showing them
  two inches from "Books on your shelf". Each book in Settings now offers to go
  up, as the first action on the row and the only one there that does not
  destroy something. `pushBookToShelf` is one implementation for both occasions,
  because a book put up by hand has to be the same file as one put up
  automatically or opening it later would depend on which button was pressed
  months earlier. The pictures are the other half: they rode inside the book
  file as base64, a third larger than the bytes and rewritten on **every** save,
  and git keeps every version — so a book with plates in it grew the repository
  by all of them again each time a correction was typed. They now go to
  `images/<digest>.png` under the scan's own rule, written once and named by the
  book file, with a picture the shelf will not take still carried inline rather
  than left out. The 40 MB refusal was only ever about the scan; what actually
  needed bounding was this. Crops cut from the scan are deliberately not stored
  at all — they are re-cut when wanted, and the scan is already up there.

- **Also done**: **the original contents page is kept for its prose**
  (`src/core/pages/synopsis.ts`). Front matter is replaced rather than
  transcribed and the scanned contents is the clearest case — but the reason is
  narrow: its page numbers describe a pagination this edition does not have. An
  _analytical_ contents, which is what an older book usually has (this one calls
  its own "SYNOPSIS OF THE LESSONS"), sets a paragraph under each chapter saying
  what is in it, and that paragraph is editorial work and the reason such a page
  is read rather than scanned. Discarding it with the numbers threw away the
  wrong half. The entries are now read back off the transcribed contents leaves,
  matched to the chapters the body actually prints — on letters and digits
  alone, because "MIND-READING, AND BEYOND" against "MIND READING, AND BEYOND."
  is a difference in hyphenation and a full stop rather than in what the chapter
  is called — and set under their entries with the folio **this** edition
  measures. A restoration and not an invention: every word comes off the paper.
  The parse is offered only when it comes back regular (`synopsisLooksSound`:
  most entries described, folios ascending), because a ragged one means the page
  was not laid out the way the reader assumes and a mangled contents printed
  under the author's name is worse than the plain one it replaces. Two things
  the parser must get right are the two the page actually does: a description
  routinely begins on one leaf and finishes on the next, and the folio line
  comes back as a `caption` on some leaves and a `paragraph` on others — so it
  reads the whole contents at once and matches on what the line _says_. Safe for
  the contents' two-pass scheme because a description comes from the document
  rather than from a layout, and the existing guard checks that rather than
  trusting it.

- **Also done**: **the formatting pass, and the four faults it found.** Proofing
  a finished book against the look it will actually export turned up things no
  unit test was ever going to. **A chapter opened by a number over a name** —
  "LESSON I." above "THE ASTRAL SENSES." — came back from the reading as two
  heading blocks, because on the page that is what it is, and was being counted
  as two chapters: the contents listed every chapter twice, the running head
  named the lesson number for a leaf before changing its mind, and with chapters
  opening recto each lesson cost two extra leaves, the first carrying a number
  and nothing else. A run of consecutive headings is now one chapter, named by
  the last and identified by the first, with the number set smaller over the
  title (`deriveChapters`). **`applyEdits` re-derived that list with its own copy
  of the rule**, and that copy dropped every recovered synopsis, so the
  analytical contents was read, matched, and silently thrown away on the way to
  the page — one implementation now, shared. **The title page put the second
  line of a two-line title through the descenders of the first**, because slots
  are one _body_ leading apart and a title sets at 1.6 times the body size.
  **And the editor's own prose could not italicise a word**: a written section
  and a written note were the two kinds of block `<i>` never reached, so a
  glossary naming forty books printed every title in roman. Three smaller
  things came with it — running heads take a `runningHeadStyle` (small capitals,
  falling back to full capitals in a face with no `smcp`, never synthesised),
  the divider ornament is drawn at last, on the title page, and the per-book
  style tweaks now ride in the design step's own answers so they survive a
  refresh and travel in the book file, which they never did.

- **Also done**: **the book can set a word bold, which is what a glossary is
  made of.** `<i>` had been the only inline markup that reached the page, so 126
  glossary headwords printed in the same colour as their definitions and the
  back matter read as a wall. `<b>` and `<strong>` are now read into a `strong`
  field beside `emphasis` — same word-index convention, same round trip through
  `withMarkup`, and carried across a page seam, a retype and a spliced run by
  the same code that carries italics. What a strong run _prints_ as is decided
  in the engine, because five of the seven faces offered ship a real bold and IM
  FELL English does not: `TextMeasurer.hasBold` is asked, and a face without one
  sets its strong runs in **italic** rather than in a bold smeared out of the
  regular outlines — the same refusal that governs small capitals, for the same
  reason. Bold is a third embedded face, so `renderPdf` is held to it end to
  end: the headword draws from a different font resource than its definition and
  the entry still copies out as text. Two things fell out of the same pass — the
  prose audit now strips markup before measuring, because `<b>Aerolite.</b>`
  puts a full stop against a `<` and moved the reported reading grade from 9.1
  to 13.4 without a word changing; and a compound no longer gains a second
  hyphen when it breaks at its own (`cross--legged`), since the hyphenator hands
  back `["cross-", "legged"]` and the breaker was adding one on top.

- **Also done**: **a leaf can be read without an API, and without anyone typing
  it out** (`src/core/draft`, `drive.mjs draft` and `transcribe`). With the
  paid vision pass gone there was nothing between a scan and a transcription
  but a person retyping the page from the render — which is exactly the
  generative act the propose/accept rule exists to prevent, because a reader
  producing text from an image alone has nothing to be wrong against. `draft`
  closes the gap from the other end: recon has already OCR'd every leaf and
  measured a box round every word, so the characters come off the pixels and
  what the module adds is the **geometry that was being thrown away** — which
  lines sit together, which are indented, which are centred, which are set
  apart at the head and foot. The job that remains is _"here is an image and
  here is a text, where do they differ"_, and a reader that never writes
  unprompted cannot confabulate a paragraph. Nothing downstream believes a
  draft: it is not saved, nothing downstream reads one, and its contents reach
  the store only by being corrected and passed to `transcribe`; every draft
  carries a `structural` list of what it guessed rather than measured, which is
  the order to check it in.

  Three faults came out of the first real leaf, and all three were invisible
  until a page went through it. **Line clustering scrambled the page**: words
  were gathered by distance from the _current_ line only, so a word whose box
  sat a few pixels low — a quotation mark, a descender, a letter the scan
  thickened — opened a line of its own that the next line's words then joined,
  and the last word of every line surfaced at the end of the line below it.
  Overlap against _every_ open band fixes it. **A line robbed of its last word
  looks inset on the right**, so it read as centred and was called a heading —
  the knock-on from the first, and the reason equal insets are no longer enough:
  a centred line must also be substantially shorter than the measure, because an
  indented first line that breaks early is inset on both sides to the pixel.
  **And a display title sits exactly where a running head sits**, so
  "SYNOPSIS OF THE LESSONS" was taken off the leaf as furniture. Position
  cannot tell them apart; size can, measured on the line's _tallest_ word
  because a letterspaced title comes back from OCR as a couple of words and a
  row of dashes.

  `transcribe` had three of its own, all of the same kind — a report that was
  not true. It keyed on the exact `name\0size\0date` triple, so a batch landed
  in a run of its own that nothing would ever open: no error, no book, and a
  session that believed it had filed a leaf. `findRunForFile` is what the app
  itself opens books with and is now what this uses. It took the leaf count
  from the batches when the scan was not stored, which made `stillMissing: 0`
  and `complete: true` come out of a book that had barely been started — the
  one wrong answer here, because it is the answer that stops anybody looking;
  it now asks the open app, and says "this is a floor" when nothing knows. And
  it reported `checked against the cached reading` over leaves the cache had no
  words for, which is worse than no check because it stops anyone looking
  again. `runs` came with them, because something that can write a run has to
  be able to unwrite one: a stray run does not sit quietly beside the real one,
  it _is_ what `listRuns()` hands back as the newest, which is how every other
  verb here finds the book.

  What the first leaf actually turned up is the argument for the whole shape.
  OCR read `belleves`; sense says `believes`; the 1916 compositor set two
  `l`s, and the 600-DPI crop settles it — the strokes are ascender height,
  against the x-height dotless `i` of `skeptical` in the same line. Dots ink
  unevenly all over this scan and are worth nothing as evidence; stroke height
  is worth everything. A pass that had been allowed to emit text would have
  quietly corrected it and nothing downstream could have caught that.

- **Also done**: **the book as a book, and a channel back to the assistant**
  ([`docs/PLAN-editor.md`](./docs/PLAN-editor.md) — stage 1 of it). The proof
  step gained a second face: the whole volume as one scrolling column
  (`src/app/BookEditor.tsx`) — divisions, body, divisions — set in a book
  face with italics shown as italics, click into a passage and type. Enter is
  a paragraph break (the `split` edit), Backspace at the start is a `merge`,
  Ctrl+I and a hand-typed `<i>` are the same tag (`src/core/edits/rich-text.ts`
  carries the notation both ways across a `contenteditable`, and
  `normalizeMarkup` stays the one reader). Deliberately absent: manual line
  and page breaks, per-block size and spacing — the engine decides those from
  rules, and rules survive reflow where hand breaks rot. Only the passage
  being edited is an editor; the rest is cheap read-only markup, which is what
  lets a long book scroll as one column. And the **memo** — the `queries`
  channel pointed the other way: a note the editor leaves _for the assistant_
  ("this page breaks badly", "check this against the scan"), anchored like a
  footnote and structurally unable to print, because `applyEdits` has no path
  from one to a page. `drive.mjs memos` lists them with the text each sits
  in; `memos resolve` records what was done and the memo stays, outcome
  attached, until the editor clears it — resolution is a ledger, not a
  deletion. A memo asking for prose gets a proposal in its resolution, never
  a landed edit. On screen a memo is presented as a **comment**, because
  that is the word-processor concept it maps to. And the surface behaves the
  way a Docs user assumes without being told: edits **autosave** a moment
  after typing stops, with an indicator that claims nothing the write has
  not confirmed; **Ctrl+Z / Ctrl+Shift+Z** undo and redo over the committed
  edit list, coalesced so a keystroke is not a step; an **outline** of
  divisions and chapters (the contents derivation) navigates the column; one
  sticky toolbar at the top acts on the open passage; and the view chosen —
  "Edit the book" or "Check against the scan" — is remembered per book.
  **Find & replace** works across the whole book (Ctrl+H, or the toolbar):
  the search reads through the notation the way a person reads the page, the
  replacement keeps the emphasis around it — a match crossing a run's edge is
  re-balanced rather than silently stripping the marking from words outside
  it (`src/core/edits/sweep.ts`) — and a Replace All is one undo step.
  `drive.mjs sweep` is the same machinery from the conversation, dry-run by
  default. **Ctrl+S saves at once** (committing the open passage first);
  where a shelf is connected, a **Save to the shelf** button sits beside the
  autosave indicator, because device storage protects against a crashed tab
  and only the shelf protects against a lost browser. An introduction or
  afterword can be **added, written and renamed in the galley** itself, and
  `drive.mjs book` reports open comments so a session starting cold sees the
  editor's asks without thinking to look. **The book's own footnotes are
  editable at last**: assembly pulls them out of the block flow, so no edit
  could reach them until the `note-text` edit (SavedRun v15). In the galley
  each printed note sits under the passage its marker is in — located the
  way the engine locates it — with unplaced ones in a named endnotes group,
  and the sweep covers notes as well as blocks and divisions. (The same pass
  fixed a live defect: assembly dropped the emphasis the reading recovered in
  a footnote, so their book titles had printed in roman all along.) **The
  galley shows the measured pages**: the engine lays the book out after a
  pause in typing and reports which page each block opens on
  (`LaidOutBook.blockPages`), the column draws "— p. 3 —" where a page
  begins, and "See the pages" (or any marker) opens the engine's own bytes in
  the page browser — one renderer, still. **Glossary mark coverage lives at
  the glossary's head**: marked / unmarked / never-used per entry, jump to
  the unmarked use, and a one-click circle placed as an ordinary text edit —
  `glossaryHeadwords` is the one extraction rule, shared with
  `book-files.mjs`. And **every picture stands at its anchor as a card** in
  the column (the engine's own anchoring), so nobody splits a paragraph
  through an invisible plate; the pixels and their tools stay in the scan
  view.
- **Also done**: **the reading pass, stage 1** — the record and the harvest
  ([`docs/PLAN-reading.md`](./docs/PLAN-reading.md)). The pass that chooses the
  footnotes and finds the introduction's material happened in a reading app
  whose highlights could not come back, so the book was read twice and built
  from the second, remembered reading. What that cost is measurable rather than
  felt: of the 23 footnotes in _Clairvoyance_, **22 hang on a proper name** —
  Roentgen, Marconi, Crookes, the SPR, Kant — because a reader scanning a page
  for annotation opportunities finds the entities it already knows, and the
  places a person actually stops (an argument that does not follow, a term used
  long before it is defined, an exercise that cannot be carried out as written)
  are not entities. The deficiency was never in the writing; it was in the
  selection, and selection is the editor's. A `highlight` edit carries one
  marked passage — a range, one of three closed tags, the editor's words — and
  **cannot print by construction**, `applyEdits` skipping it exactly as it skips
  a memo. It is anchored by its **words**, not its offset: every later
  correction shifts the characters in a block, so a highlight recorded at 721
  would silently come to name whatever now sits there, and the offset survives
  only as a tie-breaker between two occurrences of the same phrase. `findAnchor`
  is now `findQuote`'s far end rather than a second searcher. A highlight whose
  passage was retyped is reported `lost` with its words intact and never
  dropped, because a reading is the one artefact here that cannot be produced
  again by running something. Extracting `correctsTheBook` — one named rule for
  "a message about the book, not a change to it" — found a live defect on the
  way: the proof sheet's Undo filtered on `blockOf`, so reverting a corrected
  paragraph deleted every highlight in it, silently. Stage 2, the reading
  surface, is next; until it exists a reading is made and read from the
  conversation.
- **Also done**: **the reading pass, stage 2** — the surface. A third view
  beside "Edit the book" and "Check against the scan": **"Read the book"**, the
  same column the galley builds (`passagesOf`, extracted and shared, so a mark
  can never land on a paragraph the editor was not looking at) with **no way to
  change a word in it** — no `contenteditable`, no toolbar, no find and replace.
  Two hundred pages of reading on a touch screen with a caret in the words is an
  evening of accidental edits. Drag over words and a popover offers the three
  tags, a comment, and **"Fix it here"**, which hands the passage to the galley
  and lands on it. That last one was a per-paragraph button first, shown on
  hover — wrong twice over, because the device this view is for has no hover, so
  it was either chrome on every paragraph of a book being read or nothing at
  all; dragging over the words is what a reader does anyway on seeing an errant
  full stop, so the offer belongs on that. Marks are drawn by `htmlWithSpans`,
  which tints stretches of the notation _without_ letting a tint cross an `<i>`
  and splits overlapping marks at every boundary — one winning would say a
  passage is marked once when it is marked twice. The tints are located by
  `findQuote` against the passage as it stands, never by the stored offsets,
  for the reason the record gives. Two shared modules came out of it rather than
  a second copy of anything: `dom-offsets.ts`, where the three coordinate
  systems are reconciled once through `Range.toString()` — a pure
  re-implementation was written for this and thrown away, being longer than the
  browser's own and wrong in its first version — and `passages.ts`, the column
  itself. Verified in the browser rather than by reading the diff:
  `drive.mjs select` drags over words the way a finger does, and the round trip
  from gesture to `drive.mjs reading` was driven end to end.
- **Also done**: **the reading pass, stage 3 — the tablet.** The editor's rule
  for it is that **the shelf is where the reading lives and the device only
  holds what has not got there yet**, which is three things. A **manifest, an
  icon and iOS's own meta tags**, so Add to Home Screen gives an app with its
  own icon and its own place in the app switcher — and, on iOS, exemption from
  the eviction that clears a website's storage after a stretch without a visit,
  which is why this is not a nicety: the queue is the one thing on the device
  whose loss cannot be repaired by running something again. A **service
  worker**, whose rules matter more than its code: cross-origin passes through
  untouched (the shelf is `api.github.com`, and a cached answer from it is a
  book quietly out of date), navigations are network-first so a deployed fix is
  not blocked by a pinned index, and hashed assets are cache-first because the
  build names them by content. And the **outbox** — every change queued the
  instant it is made and flushed whenever there is a connection. What makes the
  queue safe is a property that fell out of the edit list rather than one
  anyone designed for: **highlights commute**, each keyed by its own id and
  collapsed by `withEdit`, so two devices marking one book cannot conflict and
  a re-sent flush is a no-op. So the queue holds **edits, never the book**: a
  flush fetches the current file, folds the queue into _its_ edit list and
  writes it back once, and anything done from another session survives. A
  `text` edit does not commute, so each entry carries what it was made against
  and a flush that finds the shelf changed underneath **reports** it rather
  than resolving it. Two faults came out of measuring rather than reasoning:
  the first service worker registered cleanly, cached the shell and opened
  offline as a **blank page**, because a first visit fetches its modules before
  the worker takes control — the index is now read at install time and the
  assets it names cached with it; and two overlapping flushes wrote the book
  file **three times for two flushes**, which is a commit that says nothing at
  best and a lost update at worst, so flushes are chained per book.
  `npm run check:install` and `npm run check:outbox` are those two
  measurements, kept, and both were fault-injected against the bug they found.
  Deliberately not built: a native shell. The editor reads by dragging a finger
  on text, so Pencil input — the only thing of the three a native wrapper would
  add that this pass could use — is not wanted.
- **Also done**: **the shelf is the front page, and a book can be opened to
  _read_ without its scan.** Two halves of the same thing. The intake screen led
  with "drop a scanned PDF" and listed the shelf below it — the order the app
  was built in, wrong for every session after the first and badly wrong on a
  tablet, where opening a new scan is the one thing nobody does. The shelf now
  comes first as cards (leaves, marks, notes, corrections, when it was saved),
  the device's own books next, and the intake last. And **`readFromShelf`
  fetches `book.json` and the editor's pictures and stops** — no scan, no
  recon, no Tesseract — marking the recovery half of the flow done (every
  question it asks was answered when the book was read, and none can be
  answered again without the paper) and landing in the reading view. That route
  was written into the plan as a Stage 3 item and had not in fact been built:
  until now every door into a book fetched the scan and started OCR, which on a
  three-hundred-leaf book is tens of megabytes over cellular and ten minutes of
  Tesseract before a word can be marked. What it gives up is _said_: the scan
  tab reads "Scan not on this device" and is disabled, rather than opening a
  view with no pixels in it. Two faults came out of looking at renders rather
  than at rules — below 860px the reading column collapsed to about ninety
  pixels wide, because stacking a flex row that sets `align-items: flex-start`
  shrinks its children to content; and once that was fixed the measure ran to
  750px, something like a hundred characters on a line, at exactly the width
  this view exists for. Measured at three widths now: 41, 68 and 56 characters.
  `summarizeBookFile` also stopped counting marks and comments as corrections,
  which would have reported a book with two hundred reading marks as two
  hundred corrections.
- **Also done**: **reading mode takes the screen, and two faults the device
  found.** Read on a real iPad, the view was a column of text with a quarter of
  the screen given to the step rail, a heading about making books, and a
  contents list beside the thing it points into. In the reading view the rail
  is shut (a ☰ opens it), the step heading is gone, and the contents is an
  overlay behind a **Contents** button that closes itself on a jump. Three
  grounds — paper, sepia, dark — set as tokens on the document root, because
  `body` paints the ground and a theme scoped to the column leaves a dark page
  in a cream frame; the mark tints are re-mixed for the dark ground, where the
  light values wash out to invisible. And the mark buttons moved from a popover
  on the selection to **a bar on the bottom edge**: iOS draws its own edit menu
  where the words are, with no supported way to suppress it, and it covered
  ours on the first real page. Nothing can win that fight, so this stops having
  it. The two faults were both saves. `persistRun` required
  `fileDataRef.current`, which a book opened to read has none of by design, so
  **every autosave failed** and an evening of marking lived in the tab — the
  indicator said so in orange, correctly and uselessly. And the outbox's
  `lastQueuedRef` started empty rather than level with the book just loaded, so
  opening a read book queued all 73 of its existing edits and wrote them back
  to the shelf as "a reading session" — a commit that says nothing, re-sending
  `text` edits with no base to judge them against.
- **Also done**: **the reading column is set in the book's own design**
  (`src/core/style/reading.ts`). It was a generic serif at a generic size, which
  is a different book from the one being made. It now takes its face, leading
  ratio, first-line indent, paragraph spacing, heading scale and centring, and
  its **measure in ems** from the `StyleProfile` — and its faces from the _same
  font files pdf-lib embeds_, registered as CSS faces off `fonts.ts`'s own list
  rather than a second set of declarations that would agree until somebody
  changed one. The measure is the number that matters: a column given the
  printed page's ems breaks a paragraph at the same _words_ it will on paper,
  which is what makes a screen read like the book rather than merely look like
  it, and it comes from `frameFor` so it cannot drift the day a margin changes.
  **Not a second renderer, and it does not claim to be the page** — a reflowing
  column cannot break lines where Knuth–Plass broke them or pages where the
  paginator broke them, and the PDF remains the only thing here that draws one.
  What crosses is the _design_, not the layout: the line `PLAN-editor.md`
  already draws for the galley's page markers, where data from the engine is
  honest and an approximation of it is not. Where a rule was needed it was read
  out of the engine rather than taken from habit — the indent is suppressed
  after _any_ heading because `suppressFirstIndent: afterHeading` is what the
  paginator does, and the drop cap belongs to a chapter heading, which is one
  at level 1. The first version conflated those and indented where the page
  does not.
- **Also done**: **the queries are a gate the editor works one at a time**
  (`src/core/queries/gate.ts`, and `gate-queries` in the step machine). A query
  is raised and never taken, and until now that was half a channel: the question
  reached `queries.md` on the shelf and the answer had to come back through a
  chat session. Seventy-nine of them is an evening of dictation, and a decision
  that never makes the trip is a book that keeps an error its editor settled
  weeks ago. Now it is one query to a screen — the passage as printed, a crop of
  the leaf, the three decisions a `Ruling` can carry, and a box for the
  reasoning that goes into `rulings.md`.

  **Nothing is pre-selected, and that is the design.** Every other question here
  arrives with the recommended answer chosen; this one must not, because a
  suggestion beside a question is an answer in all but name and the answer is
  the editor's — which is why `EditorialQuery` has no field for a proposed fix.
  `ChoiceQuestion.defaultValue` is therefore optional, so `defaultAnswers` seeds
  nothing and no answer exists until a person makes one. Nothing is `required`
  either: `required` governs the _step_, so seventy-nine required questions is a
  gate that cannot be left until all seventy-nine are settled — the exact
  opposite of the partial work this exists to keep. Skipping is safe because
  `rulingsFromAnswers` files nothing for an undecided query.

  **A ruling is saved the moment it is made**, on the device and on the shelf.
  It rides the outbox, and the argument that queue's doc comment makes for a
  reading mark holds word for word: each ruling is keyed by the query it
  answers, touches nothing else, and is collapsed on that key by `withRuling`,
  so two devices ruling on one book cannot conflict and a re-sent flush is a
  no-op. A second ruling on one query is the editor changing their mind about
  their own answer, not a disagreement to report, so the later one wins — which
  is what makes it unlike a `text` edit, and why a `RulingEntry` has no `saw`.
  `withRuling` replaces **in place**, because nothing reads two rulings on one
  query and moving one to the end would make a diff out of nothing on a shelf
  whose whole point is that git keeps every version.

  A sitting's rulings do not reach the state until the gate is left: the gate
  shows what is _outstanding_, so folding one in as it was made would take its
  screen out of the list under the editor, and going back to change an answer
  would find the query gone. They live in a ref, which is what is persisted and
  queued, so nothing is at risk. `SavedRun.rulings` had existed since v12 with
  nothing writing it — `persistRun` blanked the field on every autosave.

  Three things came out of driving it in a browser rather than reading the diff.
  The **decision was squeezed into a column** while the quoted phrase took the
  screen, because `QuestionView` divided the row on whether there was _any_ text
  evidence; the two gates hand over the same shape of evidence and only its
  length tells them apart. An **empty gate stopped everybody** — an EPUB raises
  no queries by construction — so it now walks itself through, in the shell
  rather than in `canEnter`, because a step that cannot be entered is a step
  `completed` never names and the proof step is gated on this one. And **`link
review` had to work for a book whose scan is too large for the shelf**, which
  is Vol. I of _Isis Unveiled_ exactly: the link opens such a book the light way
  and lands on the gate, because every decision here can be made from the words
  and the crop is a help rather than a requirement.

- **Also done**: **the gate finds its pixels when the scan cannot be kept.**
  The query gate promises the paper beside every decision and keeps that
  promise by rendering the leaf — which works right up until the scan is too
  large for the shelf to hold. Vol. I of _Isis Unveiled_ is **357 MB**, past
  this shelf's own 40 MB refusal and past GitHub's per-file limit both, so it
  can go up in no form at all: the editor opened the gate and was asked
  seventy-nine editorial questions over a passage of type and nothing else.

  So the crops are cut **once**, by a session that has the paper
  (`drive.mjs querycrops`), written to `books/<slug>/queries/<key>.jpg`, and
  fetched by the gate one at a time — which keeps the property the light route
  exists for: opening such a book still pulls down a book file and not a volume
  of pixels. `queryCropFor` falls back to `shelf:<path>`, still a ref the shell
  resolves rather than a URL, because a `blob:` that resolves to nothing
  outside the tab that minted it looks exactly like evidence.

  **`locateQuote` (`src/core/queries/locate.ts`)** is what makes a crop
  possible: a phrase written by a reader lined up against the words OCR boxed,
  loosely enough to survive the disagreement — and loosely **on purpose**,
  because a query is often raised _about_ a word OCR got wrong, so an exact
  match fails hardest exactly where a query is and `belleves` has to find
  `believes`. What keeps that from being sloppy is the floor: below two thirds
  it returns null and the caller must say so, because a crop of the wrong three
  lines is not a weaker version of the right one — the editor rules on it. On
  this volume it placed **74 of 79**; the five it refused are all Latin and
  ligatures (`Hæc murus æneus esto`, `Cory: "Phædras ;"`), which is where OCR
  reads worst and where the paper is most worth looking at, so those get the
  whole leaf rather than nothing, and which is which is named.

  **JPEG, measured rather than assumed**: these are a photograph of paper and
  the scan inside the PDF is already JPEG 2000, so PNG was preserving every
  artefact of a lossy original at three times the size — 275 KB a crop against
  81, or 21 MB against 6.4 over the set, on a shelf that keeps every version
  for ever.

  `npm run check:crop` is the measurement, kept, and fault-injected against
  both halves of the wiring. It has **its own page and its own stub** rather
  than a section of `screenshot-flow`: that was tried first and what it kept
  measuring was the accumulated state of the run — a shelf holding several
  books, a device deliberately wiped, a book whose queries an earlier section
  had already ruled on. Three green-looking failures came out of that, each a
  true statement about a book the check was not looking at. Two traps worth
  keeping: a `page.route` installed after the first navigation misses the
  requests that navigation makes (they fail against the sandbox's own
  certificate authority, and an empty shelf looks exactly like an empty shelf),
  and `page.goto` to a URL differing only in its hash **does not reload the
  document**, so the mount effects a deep link is read by never run again.

  Two driver faults came out of running it on a real volume. **`load` base64'd
  the scan through the debug protocol** — `use` had been fixed to fetch it over
  HTTP and this verb had not, so the fault the `GET /file` route exists to
  prevent was sitting in the one verb a session opens a book with; 476 MB of
  base64 kills the tab and returns `Target page, context or browser has been
closed`, which is indistinguishable from the flake the first command after a
  restart throws. And **`querycrops` first reached for `cropWordsFromPage`**,
  which opens the PDF and renders the page itself: twelve leaves opened
  thirteen documents over a 357 MB file and rendered every leaf twice.

- **Also done**: **a figure where the original set it, at the size the original
  printed it** (`IllustrationPlacement`; `drive.mjs figure`). The editor's
  standing ruling on _Isis Unveiled_ (leaf 193): reproduce the illustrations
  and their placement faithfully, and extend the tool if that is what it
  takes. It was: a picture had exactly one shape here — after the last text
  that shared its leaf, as wide as the measure — and that volume's three
  figures are none of them that. An amulet is engraved into the middle of a
  paragraph with eleven lines run down a narrow column beside it; the Azoth
  cross is drawn mid-sentence, "by the symbol [figure] which embraces three
  things"; the glycerine formula stands at its own small size over its
  caption, with three geometrical figures down the left of the next paragraph.
  Three placements, each off a leaf: `inline`, between blocks at its printed
  width; `within`, interrupting a paragraph at a character offset with the
  text resuming flush below; and `beside`, the run-around. The run-around is
  the drop capital's own mechanism — per-line widths and offsets into one
  `breakParagraph` — applied further down the paragraph: the line carrying
  the named word is found by breaking once, the widths set from it, and the
  paragraph broken again until the two agree. The figure and its narrowed
  lines are held together across a page break (`holdWithNext`), a paragraph
  shorter than its figure holds the slots beside it empty, and a placement
  the engine cannot honour falls back to a line of its own **and reports it**.
  Width is in **inches**, not a fraction of the measure: the cut was made at
  that size, a wider measure gains white rather than a larger engraving, and
  a figure cut at 300 DPI and set at its own width prints at 300 DPI, which is
  what the KDP check then says. The pixels travel as a supplied picture
  (`image` edit plus bytes, `images/<digest>.png` on the shelf), because a
  volume whose scan is too large for any shelf has no leaf to re-cut them
  from; a picture cut at the structure gate takes the same placement through
  the `place` edit. The proof sheet offers all of it, so the door is not only
  the driver's. Five faults were injected against the layout tests and one
  survived the first fixture: a run-around that never met a page break passed
  with the hold removed, and the sweep that walks the host paragraph down the
  page is what caught it. Crop boxes were **measured** off the 300-DPI render
  — ink runs per row and column, sixty lines of Node — after the first pass
  clipped the descenders of the line above the formula into the picture.

- **Also done**: **a reference mark that prints and claims no note**
  (`BareMark`; the `bare-mark` edit, SavedRun v18; `drive.mjs bare` and
  `drive.mjs pairs`). The editor's ruling on leaf 106 of _Isis Unveiled_
  Vol. I: the 1877 compositor set `‡` twice with one `‡` note under it, and
  the mark against "Presbytere de Cideville" refers to nothing. Keep it as
  printed, with nothing under it — which the engine had no way to do. Pairing
  is positional and runs the length of the book, so a surplus mark does not
  stand harmlessly: it takes the next note of its marker _anywhere_, the note
  that one belonged to takes the one after, and every note of that marker to
  the end of the volume is set one reference early. Measured on that book: one
  surplus `‡` displaced **188 references**, and declaring it bare put every one
  of them back.

  Anchored by **occurrence, not offset** — "the second `‡` in this block" —
  for the reason a highlight is anchored by its words: every later correction
  shifts the characters, and an offset recorded today names whatever sits
  there tomorrow. It is also the coordinate the claiming walk itself counts
  in, so what is recorded is what the engine reads. A declaration the document
  has no occurrence for is **reported** (`bareMarksMissed`, through to
  `LaidOutBook`), because this is the one editorial statement that fails
  _backwards_: losing it leaves no gap a reader can see, it silently puts the
  surplus mark back in the walk. `drive.mjs bare` refuses one the block cannot
  carry rather than recording it to be reported later as a mark the block has
  lost.

  Eleven faults were injected and all eleven caught, but two tests of mine
  passed against the reinstated bug first and both are worth recognising. The
  end-to-end layout test asserted `notesPlaced === 2` — true either way, one
  of them under the wrong reference — and passed with `doc.bareMarks` never
  reaching `prepareFootnotes`; the count of `‡` left in the body was no better,
  being 1 either way. What discriminates is **which words carry a reference**,
  read off the raised runs. And the `applyEdits` fixture used one leaf, where
  the only note is claimed by the first mark whatever happens: the damage a
  surplus mark does is to the _next_ leaf, so the fixture has to have one.

  Two things came out of the same pass. The galley grouped the book's own
  footnotes by its **own** rule — the first block whose text matched the
  marker — so on a book with 110 `‡` notes every one of them hung off whichever
  passage carried the first `‡`, and the galley disagreed with the page about
  where a note belongs, which is the one thing editing a note where it is read
  cannot afford. It goes through `prepareFootnotes` now. And `drive.mjs pairs`
  is the check that made all of this visible: `checkFootnotePairing` counts
  marks against notes _per leaf_, which is the right question to ask of a
  transcription and the wrong one after a correction, since a correction is
  keyed to an assembled block and a block crossing a seam belongs to two leaves
  at once — so it can only run over the pristine reading and goes on naming
  leaves already fixed. `pairs` reads `prepareFootnotes`' own output instead,
  with the body text before each mark beside the note that claimed it, because
  a note under the wrong reference is obvious on one line and invisible in any
  count. It shipped an hour before the declaration existed and did not pass
  `doc.bareMarks`, so its first answer after a ruling was that nothing had
  changed.

- **Also done**: **every footnote in Isis Vol. I is under its own mark — 840 of
  840 — and the two faults that stood between 86% and that.** Both were
  found by tracing each marker's chain in `drive.mjs pairs` output to the first
  leaf where the note's home leaf and the mark's leaf part company, and both
  are shapes worth recognising on the next book.

  **A doubled marker was two singles in the claiming walk.**
  `footnoteMarkerPattern('*')` is a bare `/\*/`, so `occurrences()` counted the
  two characters of a `**` as two `*` occurrences as well. The walk handed each
  a note _before_ the emit loop discarded them in favour of the `**` — the
  tie-break was right and came too late — so those notes fell back into the
  pool and the **next** block took them. Leaf 190 carried `**` and, much later,
  a lone `*`: the lone `*` took leaf 194's note and leaf 193 took leaves 191's
  and 193's, and because the chain re-converged at once the per-leaf check
  never named it. An occurrence is now a **maximal run**: a hit with a marker
  character on either side of it is not one.

  **A runover recorded as a fresh note.** Leaf 330's foot is the tail of leaf
  329's `†` note, and on the paper it has no marker, as a runover does. The
  reading gave it `†`. A note with no mark in the body waits, and it took leaf
  332's `†`; every `†` note to the end of the volume was set one early and the
  last, "Ibid., p. 2." on leaf 684, was collected as an endnote. Fixed in the
  **transcription** — the marker removed and the leaf re-landed through
  `transcribe`, merging by leaf so the text is untouched — because assembly
  already joins a markerless footnote to the note above it. That shape is
  mechanical: a marker on text whose first letter is lower case, or which
  opens on a closing quote or a comma. `checkNoteContinuations`
  (`@core/coherence`) names every such block, `transcribe` reports it the
  moment a batch lands, and swept over this volume it finds leaf 330 and no
  other. It is a floor and not a verdict — `‡ de Mirville` opens lower case
  and is a fresh note — so the leaf decides.

  Two things about how it was measured. The score is _notes on their own leaf
  or the one after_, and the seam is why "the one after" is in it: a
  paragraph joined across leaves puts a mark on the leaf after the one its
  block began on. That score went 59% → 66% (leaf 164 bare) → 86% (leaf 415's
  three title asterisks bare) → 100% (leaf 330's phantom removed, then the
  `**` fix), and the last two steps were _engine_ and _transcription_ faults
  rather than the compositor's — which is the correction owed to the ledger,
  where the drift had been attributed to three surplus marks in the text. And
  the fixtures had to have the shape of the fault: the `**` test needs a lone
  `*` **after** the `**` in the same block and a following block with marks
  of its own, or the stolen notes have nowhere to show up.

- **Also done**: **a figure below the line, which is what a chemical formula is
  made of** (`subscript`; `drive.mjs sweep` writes the `<sub>` notation like any
  other tag). The editor's ruling on leaf 520 of _Isis Unveiled_ Vol. I: every
  numeral in the formulae on that leaf is a subscript on the paper, in the body
  line and in the displayed reaction alike, and the transcription carried them
  as ordinary digits because plain text has nowhere to put the position.

  **It is the one inline kind here that is not word-granular, and that is the
  whole of the design problem.** `emphasis` and `strong` are word indices
  because that is the breaker's own coordinate system; `Na2CO3` is one
  whitespace-separated word and only two of its characters drop, so no word
  index can describe it. `markup.ts` said this case "has not come up" and named
  character ranges as the rejected alternative — it came up. `subscript` is
  therefore **character ranges** into the clean text, and what makes the
  offsets safe is exactly what makes the word indices safe: they are re-derived
  from the notation on every edit rather than stored once and re-applied to
  text that has moved. `parseInlineMarkup` had been computing these ranges
  since it was written and throwing them away; `<sub>` was in `TRANSPARENT_TAGS`.

  **Nothing in the PDF writer changed, because the mechanism was already
  there.** A footnote's reference mark is an `Attachment` — a short run at its
  own size, lifted off the baseline, given its own box so the breaker measures
  the line correctly — and a subscript is the same thing with a **negative**
  rise. `drawPage` already honoured `sizePt` and `risePt`. What the breaker
  gained is the ability to put such a run _inside_ a word rather than only
  glued after one, and the rule that a word carrying one is **never
  hyphenated**: a formula broken across two lines is not a decision worth
  letting Knuth–Plass make.

  **Both numbers are measured.** The displayed reaction on that leaf, rendered
  at 600 DPI and read with `scripts/lib/ink.mjs` (new, and the PNG decoder
  **Measuring, rather than looking** has been asking for), sets its capitals 49
  pixels tall and its subscript figures 26 — on both of its lines
  independently. That is 0.53. The figures reach 14 pixels below a baseline at
  row 173, so the drop is 0.286 of a **cap height**, and of cap height rather
  than of the em because the seven faces disagree about that far more than they
  look as though they do: 0.573 of the em in Crimson Pro against 0.770 in Libre
  Baskerville. `FontMetrics` now reports `capHeight` and the drop is computed
  from the face that will draw it — a fixed em fraction would have been a fifth
  too deep in one face and visibly shallow in another. Confirmed in the real
  690-page export rather than in a fixture: letters at 11.000/baseline 366.34,
  figures at 5.830/baseline 364.54, ratio 0.530, drop 1.803pt, and the letters
  either side of each figure share one baseline to three decimals.

  **Synthesised, never set from U+2082**, for the reason the reference mark
  already refuses to use ¹²³: measured across all seven faces, IM FELL English
  carries no subscript figures at all, and neither Cardo's italic nor its bold
  carries the `subs` feature. Anything resting on a glyph the face may not have
  draws as a hole in the most likely configuration.

  **`withMarkup` now takes its marks as one object**, and that is a fix rather
  than a tidy-up. `strong` was added as a third positional argument and
  `drive.mjs body` went on calling it with two — so an edit written against
  what the driver handed back and posted straight back as a `text` edit
  **silently stripped every bold run in the block**, because `applyEdits`
  re-derives the marks from the notation it is given. A block, a footnote and a
  prepared note all carry these fields under these names, so a call site passes
  the thing itself and cannot forget a kind it has never heard of.
  `spliceRunInto` had the same shape and got the same treatment.

  Two more live gaps closed on the way, both silent. **The EPUB reader never
  serialised `<b>` at all** — the block push has always read `markup.strong`
  and nothing upstream ever wrote a `<b>` into the string it parses, so every
  bold word in every EPUB arrived as roman, with no test anywhere near it. And
  **the page parser was dropping the new ranges on the floor**; the assembly
  test found it, which is the argument for writing the assembly test.

  Sixteen faults were injected across the four new suites and all sixteen
  caught. The one worth recognising is the page seam that **heals a hyphen**:
  it shortens the join, so a range shifted by the sum of the two halves'
  lengths lands one character early. `rebaseRanges` builds the map by walking
  the two strings rather than assuming an offset, and **returns null rather
  than guessing** when the transformation was not a pure deletion.

- **Also done**: **verse keeps the lines the poem has, and the book is set in
  the face its own ruling names.** Two halves of the editor's instruction to
  come as close to the original's composition as the tool can manage.

  **The line break.** Every kind here reflows and must: a newline in a
  paragraph is where the 1877 compositor's measure happened to end, and
  honouring it would be the manual line break the proof step refuses to offer,
  because the book is set to a measure it has not chosen yet. Verse is the
  exception and, measured over this volume, the **only** one — 1,881
  paragraphs, 42 blockquotes, 17 headings and 7 captions carry no newline
  between them, while 6 of the 105 verse blocks do, and they are Shakespeare,
  Virgil and Byron. `breakVerse` breaks each line on its own so it is
  _measured_ on its own, then re-indexes the words back onto the whole block,
  so everything downstream — the face a word is set in, the note a mark belongs
  to, the figure below the line — goes on counting in the block's own words and
  needs no idea that this happened. A line too long for the measure still
  wraps; a blank line between stanzas comes back as a line with nothing on it.
  Verse also takes the widow and orphan control that only paragraphs had: a
  stanza with one line at the foot of a page is a fault the original does not
  have.

  Six faults were injected against the new suite and all six caught. A seventh
  assertion — that no page carries exactly one line of a stanza — was
  **written, found not to discriminate, and removed**: the paginator already
  keeps a short verse whole in every fixture that can be built for it, with
  footnotes squeezing the page and with a page shortened to a few slots alike,
  so the test passed with the fault reinstated and was a test of reasoning
  rather than of code. What the change is actually verified against is the
  book: Shakespeare's three lines land 36, 37, 37 before and 37, 37, 37 after,
  and all six multi-line stanzas in the volume now sit whole on a page.

  **The face.** The ruling of 2026-09-16 says this edition is set in Cardo,
  the one face offered that carries U+2295 for the Azoth cross on leaf 520.
  The ruling was in `rulings.md` and **not in the book file**, whose `answers`
  were empty — so every export took the defaults. That is the Clairvoyance
  failure recurring, and it is silent by construction: `substitutions` is empty
  because no face was missing, the page count is right, and nothing is
  reported. Measured on the export: the cross appears on **no page** of the
  Crimson Pro run and on its own page of the Cardo one, and the subscript drop
  of 1.803pt is Crimson Pro's cap height to three decimals rather than Cardo's.
  `answers.design` now carries `bodyFont` and `headingFont`, and nothing else,
  so the ruling lands and no other choice is invented.

  What this leaves open is that a design ruling can still live in a sheet
  rather than in the book, with nothing comparing the two. Until something
  does, a book is not finished until someone has asked whether the face the
  rulings name is the face the book file sets.

- **Also done**: **small capitals, and the guard that was throwing away the
  marks measured in characters.** _Isis Unveiled_'s BEFORE THE VEIL glossary
  sets its 31 headwords in caps and small capitals — measured off the scan at
  900 DPI rather than judged by eye: HIEROPHANT's full H stands 77 pixels and
  the letters after it 50 to 53, on one baseline, a ratio of 0.65, and every
  headword sampled across leaves 39 to 55 falls between 0.65 and 0.75.

  **The mark is character ranges, and that was arrived at by being wrong
  first.** It was built as word indices, like `<i>` and `<b>`, and then could
  not set a single headword in the book it was asked for: every one of them is
  glued to the em dash that introduces its definition, so `HERMETIST.—From
Hermes` is one whitespace-separated word of which ten characters are small
  capitals and five are not. Marking the word would have set `FROM` in small
  capitals too. That is the conclusion `subscript` reached, for the same
  reason, and `markup.ts` had said the case "has not come up" — it has. What
  makes the offsets safe is what makes the word indices safe: they are
  re-derived from the notation on every edit rather than stored once.

  **Its meaning depends on the case of the text it covers**, which nothing else
  here does. `smcp` replaces lower-case letters and leaves capitals alone, so
  the word is written the way it is spelt — `<sc>Hermetist</sc>` — and the
  initial full capital falls out of the notation rather than out of a rule
  about first letters. A transcription reading `HERMETIST.` records what
  letters are on the paper and says nothing about their size, so the 31
  headwords had to be rewritten into their own case for the mark to act on.
  A face with no `smcp` — five of the seven offered — sets the run in **full
  capitals**, never capitals scaled down, the same refusal that governs bold.

  **And the fault that reached a printed page.** With the mark in the book
  file, in the block and in the document handed to the engine, the glossary
  came out in plain roman. `buildFlowable` was dropping every character range
  wherever the string being broken was not the block's own text — and it
  almost never is: a block carrying a footnote is handed over with its
  _markers taken out_, because they are redrawn as attachments and leaving
  them in would print both. On a book with 921 notes that is most of the
  blocks there are, and the same guard had been dropping `subscript` for as
  long as it has existed. Taking a marker out is a pure deletion, so the map
  is **built** — `rebaseRanges` walks the two strings — and dropped only where
  the transformation is not a deletion, as for an upper-cased running head.

  Nothing short of looking at the render catches this. The unit test passed,
  the export reported `cautions: []`, no notes dropped, no substitutions, and
  784 pages both ways. What settled it was measuring the rendered page the
  same way the scan was measured: cap 16 pixels, small capitals 11, ratio
  0.688 against the paper's 0.70, every letter on one baseline. **Two
  measurements were wrong before the right one**, both worth recognising — a
  headword locator that matched the first OCR box whose letters started with
  the word, so `MAGICIAN` was measured against `“magic.”` and came back with
  its first letter _shorter_ than the rest, which is not a thing a compositor
  does; and a whole afternoon spent on the browser's HTTP cache, which was
  innocent. A proof of the same page in a face with no `smcp` is what located
  the fault: it printed the headwords in full capitals, which proved the mark
  was reaching the breaker and the split was happening, and left `rangesFor`
  as the only place the face could be lost.

- **Also done**: **a word inside a table cell can be italic, and a contents
  entry can too.** The engine set every cell in one font, so `normalizeTable`
  dropped a run inside one — under a comment arguing that keeping a mark the
  page cannot make would be a record of emphasis the book does not print. True
  while it was true. _Isis Unveiled_'s analytical contents is what made it
  worth changing: three of its 156 entries italicise a word — _savants_,
  _Orohippus_, _Shudâla Mâdan_ — and the reprint printed all three in roman.

  **A table's marks live in the coordinates of its derived text**, not in a
  structure beside `cells`. The flattened view — rows on lines, cells
  separated by a pipe — is what the proof editor puts in a textarea, what the
  word-count cross-check reads and what `withMarkup` writes tags back into, so
  a word index in a table means what it means in a paragraph and all four
  kinds work in a cell with no new storage. A per-cell mark list would be the
  second hand-written copy this file keeps recording the cost of. `cellStarts`
  and `marksForCell` hand the engine each cell's share in the cell's own
  coordinates, and a run that reached past a pipe is clipped rather than
  allowed to mark the cell beside it.

  **The contents is a second path, and stopping at the body table would have
  set nothing anyone was looking at.** A contents leaf is _discarded by role_:
  its entries are read off into `chapter.topics` and drawn by the TOC builder,
  not by the table builder. So an `AnalyticalTopic` carries its own
  **notation** end to end and is parsed at the point of setting — one field
  rather than clean text plus a mark list re-based through `cleanTopic`'s own
  edits, because nothing matches on a topic or counts its words and the only
  thing that reads one is the line that draws it. Assembly writes each cell's
  marks back as tags before handing them over, which is also what keeps
  `@core/pages` free of `@core/transcribe`: that import would be a cycle,
  since the schema reads the role list the other way.

  **`normalizeTable` was not idempotent, and it runs on every path into the
  book.** Re-deriving the marks from rows that carry no tags computed them as
  empty, so a table's emphasis would have been wiped at the first page seam
  after it was made — silently, the same day it was added. Where there is no
  notation to re-derive from, the block's own marks already describe the same
  derived text and are kept: the contract `normalizeMarkup` keeps one function
  above. The idempotence test is what found it, and it is the shape to write
  first for anything that normalises.

  A cell that italicises a word is also not the width of the same cell in
  roman, and that number decides the column, so the natural width is measured
  through the breaker with the spans applied rather than with one font.

  Twelve faults injected, twelve caught. Three fixtures had to be rebuilt to
  discriminate, each a case of the fixture being too small for the fault: a
  one-row table cannot see a missing newline between rows, a single-word
  cell's natural width is measured by `naturalWidth` alone and passes with the
  breaker blind, and a one-chapter contents is refused by
  `analyticalLooksSound` before any mark is reached.

- **Also done**: **the body swept for small capitals, and the five ways a
  measurement can be confidently wrong.** Every all-capitals word in _Isis
  Unveiled_ Vol. I had its pixels read: 357 candidates on 163 leaves, 289
  measured, **123 caps and small capitals against 166 full capitals**, the two
  populations separating at 0.83 and 0.86 with nothing in between. Headings are
  out of the count — the design sets those.

  **A word list decides nothing here.** `GOD` is full capitals on leaf 18 and
  small capitals on leaf 30; `KNOWLEDGE` is small on 18 and full on 23;
  `SPIRIT` is full on 18 and `SCIENCE` small on 57. Only the leaf decides, so
  every occurrence is measured. The page was then checked against the paper:
  the 1877 printing sets `—POPE.` at 0.741 and the edition prints it at 0.688,
  inside the paper's own spread of 0.654 to 0.741.

  **Five faults, each of which produced a confident verdict about the wrong
  ink, and none of which shows in a count.** They are worth recognising because
  the shape recurs: a number that is _arithmetically_ fine and _physically_
  impossible.

  - _The box was on the wrong word._ Similarity matching put `CAUSELESS` on
    `ceaseless`, `IAO` on `Tao`, `TRAI-VIDYA` on the running head `TRAIL`. The
    matched OCR token must carry a capital of its own — the transcription
    records the word in capitals, so OCR read at least one — and a word of four
    letters or fewer needs a far better match, because similarity over three
    letters says almost nothing.
  - _The box held more than the word._ OCR runs neighbours together, so `GOD`'s
    box is `as—GOD.` and the first letter measured is an `a`. The box's letter
    count has to agree with the word's, give or take one for a misread letter.
  - _The first letter was an em dash_ — a 4-pixel band against 20-pixel small
    capitals, ratio 5.
  - _The first letter was an opening quotation mark_, about half a capital, so
    half-the-median did not catch it. The first letter of a word set in
    capitals is never shorter than the run's median.
  - _The window reached into the line above._ A five-pixel vertical pad pulled
    the previous line's descenders into the first column band and `—LORD` came
    back at 0.43, under the small-capital range, on a line the scan shows
    plainly in caps and small caps.

  **And one guard that was measuring the wrong thing.** Counting ink runs was
  tried as a test of "is this box the right word" and had to be withdrawn: at
  450 DPI a thin stroke drops below the threshold and a letter splits into its
  stems, so `FATHER` reads as nine runs and `MYSTERY` as twelve. That costs the
  ratio nothing — every stem of a capital is full height, and so is every stem
  of a small capital — but as a guard it rejected thirty-three sound
  measurements before anyone looked at why.

  **What could not be decided is listed, not guessed.** 47 candidates went
  unmeasured, nearly all two- and three-letter words where one letter after the
  first leaves no median to take, and 21 could not be placed on their leaf at
  all. Both lists are in the book's ledger.

  **And the first fault recurred inside that list, as a finding about the
  compositor.** The sweep also reported two words the reading records in
  capitals and the paper prints in lower case — `will` on four leaves, `all` on
  one. Read against the scan, all five are the box on the wrong word again: the
  box sits on an ordinary lower-case `will` elsewhere on the same leaf, while
  the word the reading records is `What is the WILL ?` three lines above. The
  guard cannot fire here, because the two are **the same letters** and no
  similarity score separates `WILL` from `will`. A guard written against one
  spelling of a fault does not cover the fault.

  Leaf 202's `WILL` is in fact **small capitals throughout, with no initial
  full capital** — measured on the line, `What`'s W stands 71 pixels and `Can`'s
  C 80 while all four letters of `WILL` stand 51 to 54 on one top edge, a ratio
  of 0.72. That shape is reachable and was not looked for: `<sc>` sets what is
  written lower case and leaves capitals alone, so a word small throughout is
  `<sc>will</sc>` and a word with a full initial is `<sc>Will</sc>`. Every mark
  this sweep made took the second form, because caps-and-small-caps is what a
  glossary headword is. **The first-letter ratio is blind to the first form by
  construction** — it measures the first letter against the rest, and in a word
  set wholly small that ratio is 1, which the sweep reads as full capitals. Any
  future sweep has to measure against the line's own capitals, not against the
  word's first letter.

  **How it was run, which is the reusable part.** One render per _leaf_ rather
  than one crop per word — 357 crops of 163 pages is three times the work and
  three times the browser churn. The driver's Chromium, holding a 357 MB scan
  open, stops answering after a few dozen renders and then crashes its target,
  so the restart belongs inside the loop; and one leaf of this volume crashes
  it at 450 DPI repeatably with a fresh browser, so the DPI falls back to 300
  and the record says which was used. A wrapper that pipes the script to `tail`
  tests `tail`'s exit status and will report success forever.

- **Also done**: **a correction to a footnote names the leaf and the marker, not
  a place in a list** (`NoteAnchor`; `drive.mjs notetext`). A `note-text` edit
  was keyed to `fnN`, an id assigned in assembly order — so anything that adds
  or removes a note anywhere earlier renumbers every note after it and every
  edit written against the old numbering silently names a different one. Three
  things did that to _Isis Unveiled_ Vol. I in one session: the `**` claiming
  fix, four bare-mark declarations, and the front matter, whose leaves put notes
  before every note in the book. **All eleven corrections on that volume landed
  on the wrong notes**, and nothing reported it — the counts balance, `orphaned`
  is 0, the export has no cautions, and the only way to see it is to read a
  printed foot against the scan, which is what turned it up: leaf 55 prints
  `§ Ibid., p. 92.` and the book printed a paragraph from another leaf entirely.

  This is the fault the highlight was designed against — "anchored by its words,
  not its offset, because every later correction shifts the characters" — and
  `note-text` had been given the one anchor that cannot survive the book
  changing. It is now `{pageIndex, marker, nth}`: the leaf, the reference mark,
  and which occurrence of it, all three of them things the paper shows.
  `noteAnchors` and `anchorsById` are one walk read from either end, so a
  surface holding a note and a surface holding an anchor cannot count
  differently. An anchor that names no note is **reported** through
  `noteTextsMissed` to `LaidOutBook` and led by `drive.mjs notes`, because this
  edit fails backwards: losing one leaves the paper's own text standing, which
  looks exactly like nothing being wrong. The migration **drops** a legacy
  id-anchored edit rather than carrying it, since the id it names is not the
  note it meant.

  **The recovery is the part worth recording, and it argued against my own
  first answer.** The ledger entry written when the fault was found proposed
  dropping the eleven, on the ground that "what each was originally correcting
  has to be recovered rather than guessed". That followed from the id being the
  only thing written down. With the anchor readable against the paper, ten of
  the eleven turn out to be rows already on the book's `rulings.md` — matched by
  the ruling's leaf and then by the printed text against every note on it, with
  a wide margin in every case — and all eleven went back in **byte for byte** as
  the editor approved them. Dropping them would have undone ten editorial
  decisions. The eleventh had no row and now has one: `Sec` for `See`, which the
  scan at 2400 DPI settles (the second letter carries a crossbar and the third
  does not, so the paper does print `Sec`), filed under the standing ruling the
  sheet already carries fourteen of.

  **`notetext` exists because there was no door.** `sweep` reached a footnote
  and only by matching words; nothing in a session could amend one by naming it.
  The verb refuses an anchor the book has no note for and lists what the leaf
  does carry, rather than recording an edit for `noteTextsMissed` to report
  afterwards as a correction that has lost its note — by which time the session
  that wrote it has gone away believing it landed.

  **And the fix missed a site, which using it is what found.** `drive.mjs`'s
  sweep still wrote `{noteId}`, so from the moment the core required an anchor
  the sweep could not touch a footnote at all. Reinstated, it throws inside
  `editTarget` — loud rather than silent, because `noteKey` reads `at.pageIndex`
  off nothing — which is the good version of this failure and not one to rely
  on: a driver is not typechecked, and the only reason this was a crash instead
  of eleven more mis-filed corrections is that the core had already been made
  strict. Eight faults were injected against the anchor itself and eight caught;
  the last needed a fixture carrying the same marker twice on one leaf, since
  nothing else can tell an anchor that counts occurrences from one that does
  not.

- **Next**: [`docs/PLAN-next.md`](./docs/PLAN-next.md) — the tool is safe to
  run and no second book has been read. Two driver faults that would corrupt a
  book mid-run, then the reading surface, then _The Human Aura_ — read with
  somewhere to put the reading.
  [`docs/PLAN-layout-preview.md`](./docs/PLAN-layout-preview.md) is closed and
  kept for why the layout engine is shaped the way it is.
