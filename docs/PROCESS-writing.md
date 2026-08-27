# Writing the apparatus: the introduction, the notes, the glossary

[`PROCESS-reading.md`](./PROCESS-reading.md) gets the text right and
[`PROCESS-edition.md`](./PROCESS-edition.md) turns a read book into a printed
one. Its **Stage 13 — The apparatus** is one bullet list, and this document is
that bullet list opened up, because the apparatus is the part of a reprint that
is actually written rather than recovered, and it is the part that has been
going in worst.

Same conditions as the other two: no API, and everything happens in a session.

---

## The problem this is a response to

The prose is written in a session whose entire context is a codebase. That is
not a neutral place to write from. The system prompt is about tools, the
conversation above is about test failures, the last thing read was a diff, and
the register of all of it is clipped, enumerative, and ends every paragraph on
a verdict. Prose written in that context comes out sounding like it, and the
writer is the one party who cannot see it happening.

Three things follow, and they are the whole protocol.

**The writer is not the session.** The prose is written by a subagent whose
system prompt is the editor rather than the toolchain. `.claude/agents/etsu.md`
is that prompt, and it is compiled from the voice card so it cannot drift from
the file the app reads.

**The writer is given the book, not asked to go and find it.** A thin briefing
produces thin prose, and a writer that has to grep for its own facts spends its
attention on grepping. `voice.mjs brief` renders the dossier from the same pure
module the API path uses.

**The session never touches the prose.** Not one sentence, not one word. Every
change goes back to the writer as a _finding_. This is the propose/accept rule
the rest of this repo already lives by, applied to writing: a patched sentence
is a sentence in the patcher's voice, and a piece patched twenty times is in
nobody's.

---

## Invariants

| #   | Invariant                                                                | How to attack it                                                                                                               |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| W1  | The agent and the voice card say the same things.                        | `node scripts/voice.mjs compile` and `git diff` — a non-empty diff means drift.                                                |
| W2  | The editor's own approved work reaches the writer.                       | `node scripts/voice.mjs prose` and `card` — an empty list is a writer with no model of itself.                                 |
| W2b | Nothing teaches the voice that the editor has not said he stands behind. | `harvest` names its books; there is no flag for the whole shelf. Read `prose` and ask of each entry: would he sign this today? |
| W2c | The shape was approved before the prose existed.                         | An outline for this piece exists and the editor changed or accepted it. `brief` asks for one by default.                       |
| W3  | Every fact the piece asserts came from the briefing.                     | `node scripts/voice.mjs check <proposals.json> <body.json>`; and for a section, the `outsideClaims` list.                      |
| W4  | The prose does not lean, and does not tell the reader what to read.      | `node scripts/voice.mjs audit <book.json>` exits non-zero when it wants a person.                                              |
| W5  | Somebody has read it as a reader rather than as a checker.               | The `first-reader` findings exist for this draft. There is no script for this and there cannot be.                             |
| W6  | No sentence in the piece was written by the session.                     | Not automatable. It is a habit, and the reason it is written down here.                                                        |

---

## Stage 13a — Brief the writer

```bash
node scripts/voice.mjs brief <book-dir> --length full --out /tmp/brief.md
```

What goes in is decided by `buildIntroductionPrompt`, which is pure and
tested: the book's shape, extracts spaced evenly through it so no chapter
dominates, and the rulings the editor marked `mention` so the piece can end
with a note on the text. **Do not hand-write a briefing.** A briefing typed by
hand is a second implementation of that judgement and it is thinner every time
somebody is in a hurry.

It exits non-zero when the book file has no title, author or year, and says
which. That is not a formality: those three are the facts a writer is most
likely to supply from general knowledge, and general knowledge about a 1916
occult manual is exactly where a confident wrong date comes from.

Add what only a person knows:

- `--want "..."` for a theme the editor wants drawn out.
- `--context "..."` for anything the app never learned.

## Stage 13b — The shape, and the editor approves it

`brief` asks for an outline by default. This is the gate, and it is where the
editor's judgement is worth most per second spent.

A finished introduction is very hard to argue with. It has a rhythm, the
sentences are good, and the objection that its third paragraph is the contents
page set as prose arrives after the work is done and reads like a demand to
throw it away. The same objection against an outline costs a line. So the shape
is settled first, by the person whose book it is, and the writing happens once
against something approved.

What comes back is notes and never prose: the opening's concrete thing, the
movements with the material each rests on quoted from the briefing and the
register each is in, **what is being left out and why**, the close, and any
`QUERIES:`. The left-out list is the half that is usually missing and the half
the editor cannot reconstruct later — it is the one place he sees the material
that was declined on his behalf.

Read it, change it, and hand the changed version back. It is his outline now,
not the writer's proposal.

```bash
node scripts/voice.mjs brief <book-dir> --length full --out outline-brief.md
# → etsu → outline.md → the editor edits outline.md
node scripts/voice.mjs brief <book-dir> --length full --stage write \
  --outline outline.md --out write-brief.md
```

`--stage write` refuses to run without an outline. A piece genuinely too small
to want one takes `--outline none`, which is a decision somebody made rather
than a step that quietly did not happen.

## Stage 13c — The writer writes

Give the `etsu` subagent the writing briefing and nothing else. It has the
voice already; that is what it is.

The approved shape is in the briefing and the writer is told not to redesign
it. If a movement turns out not to be carried by the material it writes the
rest and says so under `QUERIES:` — never quietly filling it and never quietly
dropping it, which is the footnote rule applied to shape.

For a **revision**, give it the writing briefing, the current draft, and the
findings. Never give it a rewritten passage, and never give it a sentence to
use. Its own prompt says findings are places to look and not sentences to
paste, and the reason it says so is that a model handed a candidate sentence
will use it.

What comes back is prose and nothing else. If it comes back with a `QUERIES:`
line, that is a fact it wanted and the briefing did not carry. Answer it from
the book or from the scan. Do not answer it from what you know.

## Stage 13d — The deterministic pass

```bash
node scripts/voice.mjs audit <book.json>          # or any file of prose
node scripts/voice.mjs check <proposals.json> <body.json>
```

`auditProse` is a word list and knows it. Its hedge list is a list to _read_,
not a list of faults: no lexicon can tell an established teaching from a
contested claim, and each one is a decision for a person. **Do not tune the
limits to make a draft pass.** Fix the draft, by sending it back to the writer.

## Stage 13e — The reader

```
Agent(subagent_type: "first-reader", prompt: <the draft>)
```

The audit cannot see flatness, which is the failure that matters most: an entry
so dry that nobody who read it would want to try anything has failed, and it
has not been made more truthful by being made duller.

The reader is shown the draft and **not** the voice card. This is deliberate and
it is the same rule as adjudication: a reader shown the hypothesis confirms it,
and a reader shown the rules grades against the rules and misses the three
paragraphs where their attention went. It reports findings and never prose, for
the same reason the writer is never handed a sentence.

A short report is a good outcome. A reader that always finds six problems is a
reader nobody can use, and its own prompt says so.

## Stage 13f — Round trip, and stop

Findings go back to the writer, which returns a fresh piece. Audit again, read
again. Two rounds is normal. If a third round is not converging — each pass
producing new findings rather than fewer — stop and say so, rather than
grinding. That is the same rule the PR loop uses for a review bot whose findings
stop converging, and it means the same thing: the brief is wrong, not the draft.

## Stage 13g — Bank what was accepted

This is the step that skips, and it is the one that makes the next book better.

```bash
node scripts/voice.mjs harvest      # the shelf's own approved work → the card
node scripts/voice.mjs compile      # the card → the agent
```

**`harvest` makes you name the books, and there is no flag for all of them.**
That is the whole point of the verb. A book going out is not the editor
approving its prose: of the four introductions on this shelf he stands behind
one and has the other three down for rewriting, and a card built from all four
teaches the writer to produce more of what is being rewritten — while looking,
from the outside, exactly like a voice improving. Nothing measures that. Front
matter and notes are named separately (`--notes`), because an introduction you
would sign and a note you would sign are two different judgements.

It reads `book.json` and never `introduction.md`, because the readable files
are views and drift. A passage banked by hand outranks a harvested one and is
kept first; anything a cap drops is named on the way past.

Then commit **the card and the agent together**. They are one artefact in two
files and a commit carrying one of them is a commit that has to be remembered
later — the same rule as the book file and its exports.

---

## What has actually gone wrong

**The corpus existed and reached nobody.** `proseSamples` — the field whose
documented job is "what the pass is shown when it writes an introduction, a
glossary preamble, or anything else the editor signs" — was stored, normalized,
capped, banked and carried between books, and `voiceBlock` never emitted it. So
did `exemplars`, which was designed to accrete from accepted notes and had
accreted nothing, because it accretes at a gate and there are no gates any more.
Four published introductions and fifty-seven approved notes sat on the shelf
while the card carried one hand-typed passage and an empty list. Every piece of
prose this app has ever helped write was written by something that had never
read a line of the editor.

The shape of that bug is the familiar one: a field that banks, migrates, has a
cap and a doc comment, and no reader. `frontTitleBorder` was the same. What
catches it is asking, of any new field on a card, **which function puts this in
front of a model** — and writing the test that fails when nothing does.

**A cap dropped the only thing that was not replaceable.** The first run of
`harvest` evicted the editor's own hand-written calibration passage, which
exists in no book, in favour of three published introductions, and printed
`3 of 4 passage(s) kept` while doing it. The cap was right and the report was
true. What was missing was any way to tell a passage banked by hand from one
harvested automatically, and the fix is that hand-banked prose outranks
everything and anything dropped is named.

**The glossary marks were in the extracts.** `sampleBook` handed the writer
`the trolley-pole°` and called it a sample of the author's prose. It is this
edition's apparatus, not the book's words, and a writer quoting a phrase would
have carried the degree sign into print.

**The reader found what the audit was structurally unable to find.** On the
first real draft the audit came back CLEAN — one hedge to read, five flat
stretches reported and not enforced, grade 9.6. The reader, given the same
draft and no rules, came back with a paragraph that was a contents page set as
prose and that it had stopped reading a third of the way into; six sentences
whose modifiers hung on the wrong noun; and the fact that the introduction
never names the author once. None of those is reachable by a word list, and the
last one is the sort of thing that goes to print. Run both. Neither is the
check.

**The writer was asked to describe an apparatus it had never been shown.** An
introduction is where the reader is told there is a glossary, that a small
circle means an entry, how many notes there are. The briefing carried none of
it, and the first outline came back asking under `QUERIES` whether there was a
glossary at all. Every one of those numbers was in the assembled document.
`apparatusOf` counts them — and says "No footnotes" and "No glossary marks in
the text" out loud, because the failure already on this shelf is a volume that
carried a 74-entry glossary with not one mark on a word and nothing anywhere
saying so.

**`harvest` treated shipped as approved.** Its first version took the whole
shelf, which is the same mistake in a different place as writing the prose in a
build session: it substituted something measurable for the judgement that
actually decides. Four introductions were on the shelf, the editor stands
behind one, and a card built from all four would have taught his rewrite list
back to him with every sign of the voice getting better.

**The anagram lived only in the agent.** "The pen name is an anagram of 'The
Student'" was in `.claude/agents/etsu.md` and not on the card, so the app's own
prompt never had it and the first compile would have deleted it. Anything true
of the editor belongs on the card. The agent is generated; nothing survives in
it that is not in the file it is generated from.
