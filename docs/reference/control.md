# Driving the app from outside the tab

The app interviews the user, and a gate is `Question[]` — data, not a screen.
That is what makes this possible: something that wants to operate the app does
not have to find a button or guess a selector. It reads the gate as JSON and
writes an answer back by id, which is the same contract `QuestionView` renders
and the unit tests drive.

Two transports, one implementation of what a command does.

|                     | `scripts/drive.mjs`            | the repository bridge                |
| ------------------- | ------------------------------ | ------------------------------------ |
| where it runs       | a Playwright session, dev only | the user's own browser               |
| how commands arrive | a localhost port               | a git repository they own            |
| what it is for      | working on the app             | working on a book while away from it |

Both go through `useAgentSurface` (`src/app/agent-surface.ts`), which is the
only thing that executes a command. A driver that clicked buttons while the
bridge set state would be two implementations of the flow, and they would
disagree exactly where it mattered.

## The rules

**Nothing here can spend money.** Almost every paid step makes that easy:
pressing continue at the transcribe or annotate gate puts up a quote and stops,
so a controller can advance freely and _report the price_ rather than approve
it. There is one exception in the app and it is deliberate — a leaf answered
`redo` at the uncertainty gate is read again the moment that gate is left, with
no quote, because a person who ticked "read this page again" has already
decided. A controller has decided nothing, so `advanceOutlook` refuses that one
by name, computed from the answers about to be committed.

**No credential travels the channel, in either direction.** The transcribe gate
asks for an Anthropic API key in an ordinary `text` question, so a snapshot that
echoed answers verbatim would publish it. `REDACTED_QUESTIONS` names those
questions, the snapshot omits their answers and keeps their prompts, and
`parseCommand` refuses to set one. A test asserts the list covers every question
on every gate whose prompt asks for a secret, rather than comparing the list to
itself.

**Being driven is visible.** While the bridge is live a panel sits above the
step, in the warning colour, naming the session, the repository, the last
command and its outcome, with a stop button. An app that can be operated
remotely and shows no sign of it is indistinguishable from one that has been
taken over.

## The commands

| command                    | what it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `{op:'state'}`             | the gate on screen, as JSON. No effect at all.                  |
| `{op:'answer', id, value}` | set one answer. Refused for a question this gate is not asking. |
| `{op:'advance'}`           | press the forward button. Refused per the rules above.          |
| `{op:'evidence', ref}`     | the pixels behind a piece of evidence, as base64.               |

A reply is `done`, `refused`, `failed`, or `started` — see below. `refused` is a
first-class outcome, not an error: it names the rule that applied so the
controller can put the decision to a person instead of retrying.

### Why evidence is a `ref` and not a URL

An object URL names a Blob in the tab that minted it. Carried across a wire it
resolves to nothing while looking exactly like evidence, which is worse than
sending no picture at all — every gate here promises the user never decides
blind. So the snapshot carries a name and `evidence` turns it back into pixels.

Discrepancy rows go further: they name OCR word ids, and their ref is a
`words:<page>:<ids>` pseudo-source resolved only when asked for. Cutting every
crop in a book to build one snapshot would render the whole scan to answer one
question.

## Using the driver

```bash
npm run dev &
node scripts/drive.mjs serve &          # holds a browser open

node scripts/drive.mjs open             # the 8-page fixture
node scripts/drive.mjs wait gate-identity
node scripts/drive.mjs state
node scripts/drive.mjs answer orthography preserve
node scripts/drive.mjs evidence 'terms#0' word.png
node scripts/drive.mjs advance
node scripts/drive.mjs shot design
node scripts/drive.mjs quit
```

`seed` writes a transcription straight into the run store, so everything past
the transcribe gate can be reached without paying for a reading. `bridge`,
`post` and `replies` drive the _other_ transport against an in-memory
repository, so the poll loop and the real request path are exercised without
putting test traffic in anybody's git history.

`window.__pdbfAgent` is published by `useAgentSurface` under
`import.meta.env.DEV`, which compiles to a literal `false` in a build — a
production page has no such handle.

## Using the repository bridge

Settings → **Letting something else drive**. Name a session, and either connect
a shelf or give this its own repository and fine-grained token
(`Contents: Read and write`, that repository only).

Two files, under `control/<session>/`:

- `inbox.json` — `{version, commands: [{id, command}]}`, written by the
  controller.
- `outbox.json` — `{version, replies: [{id, at, outcome, reason?, view?, image?}]}`,
  written by the app.

Each side only ever writes its own file, so the contents API's sha dance can
never become two writers on one blob. A command whose id already appears in the
outbox is never run again.

**Use a private repository.** Every command and every gate snapshot lands in a
git history, and a git history cannot be taken back. It may be the shelf; it
does not have to be, and a shelf that is public deliberately should not be it.

### The `started` claim

A reply is written _before_ its command runs, saying so, and replaced by the
result. Without it a tab that died between executing a command and recording
what happened would come back, find the command unanswered and run it again —
and the command it would re-run is `advance`, which is how a gate gets left
twice. The claim costs one extra write and turns an invisible double action
into a reply that says, in words, that the result is unknown. Same rule as the
batch ticket: record the thing that cannot be recovered before doing it.

### What it is not

It is not fast. The round trip is one poll interval (10s), so this is for a book
being worked through by someone who is not at the keyboard, not for a live
cursor.

## Working a book's flags offline

The transcription is the only part that costs money, and the app saves the book
to the shelf the moment that pass finishes (`App.tsx`, after
`runBrowserTranscription`). Everything the uncertainty gate needs besides it —
the render, the OCR, the word boxes, the cross-check findings — is free and
repeatable. So a book can be picked up from the shelf somewhere else entirely,
have its flags worked through, and be put back, without the person who paid for
the reading being at the keyboard.

```bash
node scripts/drive.mjs load ../shelf/books/<slug>/book.json ../shelf/scans/<sha>.pdf
node scripts/drive.mjs open ../shelf/scans/<sha>.pdf
node scripts/drive.mjs wait gate-identity 600
node scripts/drive.mjs advance
node scripts/drive.mjs answer useSavedRun use
node scripts/drive.mjs advance
node scripts/drive.mjs wait gate-uncertainties 600

node scripts/drive.mjs flags                 # every flagged leaf + its crops
# … judge them, one `answer` per verdict …
node scripts/drive.mjs save ../shelf/books/<slug>/book.json out.json
```

`flags` is the one that matters: it takes the whole gate in a single pass and
writes a crop per disagreement to disk, so the words on the paper can be looked
at rather than inferred. Each leaf comes back with the reason it was flagged
(the word-count drift, the confidently-read words that are absent), what OCR
read, what the transcription says, and the verdicts on offer.

Two things about the round trip are worth knowing:

**The run is re-keyed on the way in.** A key is `name\0size\0modified`, and a
scan on another disk has a different modification time, so the stored key would
name a file this browser will never see and the app would offer nothing back.
`load` re-keys to what this copy of the scan produces; `save` puts the shelf's
key back, so the book still matches the scan it was read from.

**Verdicts travel as answers, not as edits.** A fix typed at the uncertainty
gate is folded into the edit list when the gate is left, but that list is not
persisted until the proof step ends. The durable record in between is the
answer itself, which the app re-derives the edit from on the way back in. So
`save` carries `answers` back, and a verdict reached offline survives without
walking the rest of the book to make it stick.

### What may be decided without asking

The temptation is a confidence threshold — resolve anything you are, say, 85%
sure of. That is exactly the thing SPEC §4 rules out: a model's estimate of its
own reliability is not a probability, and gating a check on one means the flag
list is filtered by the same judgement that would have to be wrong for the flag
to matter.

What can carry a decision is **corroboration**, which is what the rest of this
app already runs on. A flagged gap has two independent readers: OCR, which is
not a language model and has no shared blind spots with one, and a fresh reading
of the pixels. So:

- Both readings agree on what the page says → resolve it. Two witnesses, neither
  taking the other's word, and the crop is on disk to be checked afterwards.
- They disagree, or the crop cannot be read → it goes to the person, with the
  crop, both readings, and what the transcription currently says.
- The transcription alone is never enough. Given garbled text and no picture, a
  model returns fluent, confident, partly-invented prose and no downstream check
  can tell — the one unrecoverable failure for a public-domain reprint.

In practice this resolves most of a gate and escalates a short list, which is
the same split a confidence threshold was reaching for, with something behind it
that can be checked.
