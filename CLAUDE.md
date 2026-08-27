# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## What this is

**Starting cold on a book?** Read [`docs/HANDOFF.md`](./docs/HANDOFF.md)
first, then the process it points at:
[`PROCESS-reading.md`](./docs/PROCESS-reading.md) for getting the text right,
[`PROCESS-edition.md`](./docs/PROCESS-edition.md) for turning a read book
into a printed one, and
[`PROCESS-writing.md`](./docs/PROCESS-writing.md) for the introduction, the
notes and the glossary — the part that is written rather than recovered, and
the part this session is worst placed to do itself.

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
other half of the pass. `.claude/agents/first-reader.md` is that reader: it is
shown the draft and deliberately **not** the voice card, because a reader
holding the rules grades against the rules and misses the three paragraphs where
their attention went. It reports findings and never prose, for the same reason
the writer is never handed a sentence. Pretending a word list could stand in for
it would be the same error the audit module exists to catch.

The editor's voice card (`voice/<pen-name>.json` on the shelf, and
`scripts/voice.mjs` to read it) carries the same rules in the form the writing
is actually done against. Read it before writing anything that goes in a book.

**Better than reading it: write as him.** `.claude/agents/etsu.md` is the same
card compiled into a subagent — the stance, the construction rules, the avoid
list, the editor's own published front matter and his approved notes, in a
system prompt. Brief it with the book's verified facts and it returns front
matter written in the voice rather than checked against it afterwards, which is
a different and better thing: a writer who has the rules cannot produce a draft
that has to be argued back into them.

The card stays the source — it is the file the app reads, and the one that
travels with a shelf that has no formatter checkout beside it — and the agent
is **generated from it** by `node scripts/voice.mjs compile`. It used to say in
its own last paragraph that the two would drift and that a session would then
write in a voice nobody approved, with nothing stopping it. Now nothing has to:
an edit to the agent is lost on the next compile, and every exemplar the shelf
has banked since the last one arrives with it.

`node scripts/voice.mjs harvest` is the other half of that loop, and the reason
it had to be built is worth stating plainly. `proseSamples` and `exemplars` were
both designed to accrete from work the editor accepted, and both accrete at a
_gate_ — so once the books were made in a conversation, neither ever did. Four
published introductions and fifty-seven approved notes sat on the shelf while
the card carried one hand-typed passage and an empty list, and `voiceBlock`
never emitted the passage either. Every piece of prose this app has helped write
was written by something that had never read a line of the editor.

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
node scripts/screenshot-flow.mjs     # drive the wizard headlessly, screenshot each screen
```

Working _on a book_ (see **How the work is actually done**, above):

```bash
node scripts/drive.mjs serve &       # hold a browser open, take commands on :7788
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
node scripts/drive.mjs runs          # readings held here; `runs drop <n>` removes one
node scripts/drive.mjs state         # the gate as JSON; `answer` and `advance` work it

node scripts/book-files.mjs <book-dir> --check   # do the readable files still
                                     #   describe the book? regenerates them
                                     #   without --check
```

Writing the apparatus (see [`PROCESS-writing.md`](./docs/PROCESS-writing.md)):

```bash
node scripts/voice.mjs brief <book-dir> --out b.md  # the dossier a writer gets,
                                     #   rendered by the module the API uses
node scripts/voice.mjs audit <book.json>            # the bias pass, deterministic
node scripts/voice.mjs harvest       # the shelf's approved work → the card
node scripts/voice.mjs compile       # the card → .claude/agents/etsu.md
node scripts/voice.mjs prose         # what front matter the writer has of its own
```

**The session never writes the prose and never patches it.** The `etsu` subagent
writes; the audit and `first-reader` report findings; the findings go back to the
writer. A sentence fixed here is a sentence in this session's voice, and a piece
fixed twenty times here is in nobody's.

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

- **Next**: [`docs/PLAN-next.md`](./docs/PLAN-next.md) — the tool is safe to
  run and no second book has been read. Two driver faults that would corrupt a
  book mid-run, then the editorial-query channel, then _The Human Aura_.
  [`docs/PLAN-layout-preview.md`](./docs/PLAN-layout-preview.md) is closed and
  kept for why the layout engine is shaped the way it is.
