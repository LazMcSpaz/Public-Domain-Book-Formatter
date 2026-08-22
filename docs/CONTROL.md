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
