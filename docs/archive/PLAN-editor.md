# Plan: the book editor

The editor wants to edit the way a word processor edits: scroll the whole book,
click into a paragraph, type, italicise, and watch everything downstream shift.
Today that job is done a leaf at a time in the proof sheet, in plain textareas
with literal `<i>` tags — functional for corrections, wrong in shape for the
heavy editing the footnotes and the glossary now need.

Nothing underneath has to change. The book is already blocks plus an edit list
re-applied over a pristine transcription, and the layout engine already reflows
the whole volume on every change. What is missing is the **surface**: a
continuous, readable, rich-text view of the book that produces exactly the
`BookEdit` records the proof sheet produces. This plan is that surface, plus
one new channel — a note the editor leaves _for the assistant_ — and the line
that must not be crossed while building either.

## The line, restated once

**Seeing breaks is in; inserting breaks is out.** A hand-placed line or page
break is a statement about one particular layout, and it goes stale the moment
anything upstream reflows. The engine makes those decisions from rules (widow
and orphan control, recto openings, footnote reservation), and rules survive
reflow where hand breaks rot. So the editor shows the true breaks — measured by
the one engine that prints them — and offers no button to place one. Enter is a
_paragraph_ break, which is content, and maps to the `split` edit that already
exists. Font size, leading and indent stay per-_kind_ in the style profile,
reachable from the editor but decided at the design gate.

**No second renderer, still.** The edit view sets type in a browser font and
never claims to be the page. The page is the PDF, rendered by pdf.js from the
real exported bytes (`PageBrowser`), and that is the view a break is judged in.
What the edit view may honestly carry is _data_ from the engine — "page 47
begins here" — because that is a fact about the one layout, not an
approximation of it.

**Every keystroke is an edit-list record.** The editor holds no document of its
own. A word retyped in it must produce the identical `text` edit the proof
sheet or `drive.mjs correct` produces, through the same `withEdit`, so the two
doors cannot disagree and the wizard does not rot. The proof sheet keeps its
job — leaf beside scan is the right shape for checking a transcription against
paper — and the editor takes the other job, which is working on the book as a
book.

## The memo: a note addressed to the assistant

The app has one channel for decisions flowing to the person: an editorial
`query`, raised during transcription because the judgment is the editor's. The
memo is the same channel pointed the other way — anchored in the document,
waiting on the assistant, because the work is mechanical: "this page breaks
badly", "check this word against the scan", "is this entry marked in the
body?".

Shape: a `memo` edit — `{ memoId, blockId, at, text, resolved? }` — living in
the ordinary edit list, so it travels in the saved run and in `book.json` and
survives reflow like any note. Two rules give it its character:

- **It cannot print, by construction.** `applyEdits` skips it entirely; it
  never reaches the document, so there is no path from a memo to the layout
  engine at all. A note to the assistant appearing in a book for sale is the
  one failure this feature must make impossible, so it is impossible
  structurally, not filtered at export.
- **Resolution is a ledger, not a deletion.** The assistant answers a memo by
  writing `resolved` — what was done, in words — and the memo stays until the
  editor clears it. A note that vanishes reports nothing; a note that says
  what happened can be checked in ten seconds. Same rule as everywhere else
  here: silence is the failure mode.

The division of labour it encodes: the editor decides what the book says; the
assistant handles what is checkable — layout faults, pixel checks, consistency
sweeps, the audit and the closing commit ritual. A memo that asks for prose
("rewrite this definition") is answered with a _proposal in the resolution_,
never a landed edit: a decision that is the editor's is raised, never taken,
in both directions.

`drive.mjs memos` is how the assistant reads them — each memo with the text it
is anchored in and where — and `memos resolve <id> "<what was done>"` is how an
outcome is recorded. Both go through the run store the way `body` and
`correct` do.

## Stages

### Stage 1 — the memo channel and the editing surface (this change)

- `memo` in `BookEdit` (`src/core/edits/book-edits.ts`), skipped by
  `applyEdits`, collapsed by `withEdit` on `memoId`, ignored by `countEdited`
  (it corrects nothing). `src/core/edits/memos.ts`: `openMemos`, `memoSheet`
  (each memo with the current text of the block it sits in, in document
  order, lost anchors flagged rather than dropped), `resolveMemo`,
  `clearMemo`. Read back by `parseEdits` (`saved-run.ts`, schema v14).
- The rich-text round trip (`src/core/edits/rich-text.ts`), pure both ways:
  `htmlOfMarkup` renders the `<i>`/`<b>` notation as HTML that contains
  nothing but those two tags and escaped text; `markupOfNodes` walks a
  structural DOM tree back to the notation. `normalizeMarkup` remains the one
  reader on the way in, so a tag typed by hand and a tag made by Ctrl+I are
  the same tag.
- `BookEditor` (`src/app/BookEditor.tsx`): the whole book, front sections →
  body → back sections, as one scrolling column set in a book face. Blocks
  render read-only (cheap; a textarea per block is what would not scale) and
  become a `contenteditable` on click. Italic and bold buttons plus the
  native shortcuts; Enter commits the text and splits at the caret; Backspace
  at the start merges with the block above; a kind dropdown retypes; the
  editor's own footnotes and memos show under the block they hang on, and a
  memo can be left at the caret. Reached from the proof step by a toggle, so
  it is a second door onto the same edit list, not a replacement.
- `drive.mjs memos`, as above.

### Stage 1½ — what a word-processor user expects without being told (done)

Chosen by asking one question of the surface: where would someone who has
used Google Docs plenty, and this app never, trip first?

- **Autosave, said out loud.** Corrections used to persist only on _leaving_
  the proof step — an evening of galley editing lost to a crashed tab. Edits
  now save a moment after typing stops, and the indicator ("Saving…" / "All
  changes saved on this device" / a visible failure) claims nothing the write
  has not confirmed. `persistRun` reports success instead of swallowing it,
  and writes the scan once per session rather than beside every save.
- **Undo across the book.** Ctrl+Z / Ctrl+Shift+Z and buttons, over the
  committed edit list — history is a stack of previous lists, coalesced so a
  keystroke is not an undo step, bounded at 200. Inside an open passage the
  browser's own undo covers the typing in progress; ours picks up at commit.
- **An outline to navigate by** — divisions and chapters, from the same
  derivation the contents page uses, click to jump. And a word count.
- **Docs vocabulary.** The toggle is "Edit the book" / "Check against the
  scan"; the memo is presented as a _comment_ ("goes to your assistant —
  never printed"); the kind dropdown is labelled "Paragraph style". One
  sticky toolbar at the top acts on the open passage, where a word-processor
  user's eyes already are. The view chosen is remembered per book.

### Stage 1¾ — the low-hanging fruit (done)

- **Find & replace across the whole book** (Ctrl+H, or the toolbar). The
  search reads through the notation the way a person reads the page; the
  replacement keeps the emphasis around it, and a match crossing a run's
  edge is re-balanced rather than silently stripping the marking from words
  outside it (`src/core/edits/sweep.ts`, both directions fault-injected in
  its tests). Replace All is one `onChange` — one undo step, one autosave.
  `drive.mjs sweep` is the same machinery from the conversation, dry-run
  unless `--now` is given, every change reported.
- **Ctrl+S saves at once** — committing the open passage first, deferred a
  tick so the indicator never claims saved for typing left behind — and
  where a shelf is connected, **Save to the shelf** sits beside the
  indicator with the time of the last push: the device protects against a
  crashed tab, only the shelf protects against a lost browser.
- **Writing lives in the galley**: an introduction or afterword is added at
  the end of the column, written into a placeholder the engine's
  empty-section filter would otherwise hide, and renamed by clicking its
  title. Same records as the sheet's buttons.
- **The comment loop is self-driving**: `drive.mjs book` reports open
  comments so a cold session sees the editor's asks at the first look, the
  handoff doc makes the sweep part of the ritual, and Ctrl+Alt+M — Docs'
  comment shortcut — leaves one at the caret.
- The galley fits a phone, measured by the harness rather than assumed.

### Stage 2 — the true page beside the text (done)

- The engine lays the book out after a pause in typing and reports, for every
  block, the page its first line landed on and the folio that page prints
  (`LaidOutBook.blockPages` — recorded as lines are _placed_, the same hook
  the chapter record uses, and fault-injected in its tests). The galley draws
  "— p. 3 —" between the passages where a measured page begins; the markers
  dim while a fresh measure runs, and are simply absent before the first.
  Before the design gate, the shipped defaults stand in, and the markers move
  when the design does.
- "See the pages", or a click on any marker, opens the real pages — the same
  `PageBrowser` the export uses, rendering the engine's own bytes, opened on
  the page in question. One renderer, still: the galley never draws a page,
  it reports what the engine measured and shows what the engine wrote.
- Picture cards: every illustration stands at its anchor in the column — the
  engine's own `anchorIllustrations`, so the card and the plate cannot
  disagree — as a card naming its origin and caption. The pixels and their
  tools stay in the scan view; the card exists so a paragraph is never again
  split through an invisible plate.
- And the reverse of the markers: "Edit this page" in the page view jumps
  back to the passage whose text the shown page is setting, landed with a
  flash. Both directions now exist.

### Stage 3 — the two structured views

- **The notes browser** (done, and in-place rather than as a separate list):
  the book's own footnotes were the one kind of text no edit could reach —
  assembly pulls them out of the block flow, so they were neither blocks nor
  the editor's own writing. The `note-text` edit (`{ noteId, text }`, schema
  v15) closes that: applied by `applyEdits` over the assembled notes,
  notation read by the house convention, an emptied note removed like an
  emptied block. In the galley each printed note is edited _under the
  passage its marker sits in_ — found the way the engine finds it, by
  `footnoteMarkerPattern` over the blocks as they stand — and a note whose
  marker is nowhere sits in a named endnotes group at the foot of the
  column, exactly as the engine collects it. Find & replace and `drive.mjs
sweep` reach the notes too, printed and authored alike.
- **The glossary editor** (the coverage half is done): a panel at the
  glossary's head reports every entry's mark coverage — marked, unmarked,
  never used — with a jump to each unmarked use and a one-click "Mark it"
  that places the circle there as an ordinary text edit
  (`withGlossaryMark`), undoable like everything else. `glossaryHeadwords`
  is the one extraction rule, shared with `book-files.mjs --marks` so the
  shelf report and the editor cannot drift. Which occurrence deserves the
  mark stays the editor's call; the button only carries it out where they
  pointed. Still open: entry-per-row structured editing, if prose editing
  of the section proves clumsy on a real glossary pass.

### Stage 4 — what remained, settled

- **Selection across blocks — retired, deliberately.** The unit of editing
  is the passage, which is what keeps a three-hundred-page book scrollable
  (one live editor, everything else cheap markup) and what matches the edit
  model (every change names one block). The boundary operations are complete
  instead: Backspace at a passage's start merges it up, Delete at its end
  pulls the next one in, and Enter splits — so any cross-boundary edit is a
  merge away, in either direction. A multi-block editable region would trade
  the memory discipline and the edit-list honesty for one gesture; not worth
  it until a real pass proves otherwise.
- **Undo across a reload — deliberate.** The history stack is session-local;
  the durable layers are autosave (the device) and the shelf (git, which
  keeps every version forever). "Undo what I did yesterday" is a question
  for the shelf's history, through the assistant.
- **Search within the editor** — done (find & replace, and native Ctrl+F
  works because the whole book is one page). Jump from a finding or query to
  its block stays open, and cheap, when wanted.
- **Memos on regions rather than points** — still waiting on a real book to
  prove points too coarse.
- **The structured glossary rows** — settled as: prose editing with bold
  shown as bold, plus the coverage panel, per-entry status chips, and "Add
  an entry". Entry-per-row forms would be a second representation of the
  same text; the panel gives the structure without the drift.

## What was deliberately not built

- Per-block font size, leading, indents, manual line or page breaks — the
  container-box disease. Presentation stays with kinds and the style profile.
- A Node-side renderer for the preview. One engine draws the page.
- A second storage for editor state. The edit list is the whole of it.
