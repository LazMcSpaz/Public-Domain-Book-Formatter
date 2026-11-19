# Spec: rulings and marks from the phone or tablet, and a query crop big enough to judge

## What it does (plain English, for the owner)

**Saving from the phone or tablet.** When you rule a query or mark a passage, the app sends it to the shelf. On your phone and tablet that send fails with "Load failed", which means the request got no answer at all.

What was found, and what could not be found here:

- Nothing in the app's saving code has changed since 7 October, the last day a ruling from the app reached the shelf. On 6 and 7 October the same code wrote the _Theosophical Glossary_ (a bigger file than _A Modern Panarion_) many times over.
- So the size of the book file is not the cause on its own. A _Lost Keys_ mark sends a fifth of what went through on 7 October.
- The cause cannot be reproduced from here. The fault shows only in Safari's engine, which every browser on an iPhone or iPad uses, and that engine is not available in this workshop. This session cannot write to GitHub at all, so it cannot try a write the way your phone does.
- The candidates that fit every fact are: your browser or network refusing or dropping the write; GitHub's answer to the write arriving without the permission header a browser needs (a browser then reports no answer); or GitHub taking too long to answer.

So this change does three things.

1. **When a send fails, the app says exactly what failed.** The note names the request in plain words: finding the book's folder, reading the book, asking the shelf for the book's version, or writing the book file. (The card written after the book is left quiet, as before: the book is already up, and the next send writes the card again.) It gives the size sent, how many seconds the browser waited and the browser's own words. It then checks two things for you. First, whether reading from the shelf still works, which tells a dropped connection from a write that was refused or cut off. Second, whether the write landed after all, with only the answer lost on the way back. If it landed, the app counts it as sent.
2. **Nothing is lost, and you can try again.**
   - A ruling or mark stays on the device until the shelf has it, whatever happens to the send.
   - After a refresh, a mark still waiting is drawn on the page again, and a ruling still waiting stays ruled. (Before, the app showed only the shelf's copy, so a mark still waiting to be sent vanished from the page.)
   - "Send to the shelf" is on the query screen as well as the reading screen.
   - The app tries again when you come back online and when you open the book or the query screen.
3. **A send no longer damages the book.** A send reads the book from the shelf, adds your change and writes it back. The app was writing back only the parts it understands, and dropped the rest. Measured on the shelf: a send to _Collected Manuscript Lectures_ would have deleted the reasons and findings written on 404 of its corrections. Now everything the app does not understand is written back exactly as it was.

**The query crop.** The crop beside a query showed the passage and about one line either side, cut through the middle of lines, and on a phone it was drawn so small (about 8 points) that it could not be read.

- **New crops** show the passage's lines plus three whole lines above and below. The passage is marked with a highlighter colour that leaves the ink exactly as printed.
- **On a phone,** every shelf crop, old or new, is shown at reading size (book type at about 18 points). You swipe sideways for the rest of the line, and a new crop opens scrolled to the passage. Tap it for the full-size view, as before.
- **Old crops** keep working, shown bigger. To get the marked, taller crops for _A Modern Panarion_, ask a session to cut its crops again.

Published books do not change: this is the app and its connection to the shelf only.

## Done when (how we'll know it works; how the owner can try it)

- A failed send's note names the request, its size, the seconds waited and the browser's words, and says whether reading still works. A test fails the write the way your phone does and checks every part of that sentence.
- A write that landed but whose answer was lost counts as sent. A test checks this with GitHub holding the new version.
- A mark made while sends fail is still on the page after a refresh, is still counted as waiting, and reaches the shelf when "Send to the shelf" is pressed. A browser check (`npm run check:saves`) does this with a faked shelf, for a mark and for a ruling.
- A send keeps every field the app does not know. A test with made-up corrections that carry a reason and a finding checks they survive.
- `npm run check:outbox` passes again. It now counts writes of the book file, not the card written beside it.
- A query crop holds whole lines, three either side of the passage, with the passage marked. A test checks the lines chosen from made-up word boxes.
- On a phone-sized screen a shelf crop is shown at reading size and opens scrolled to the passage. A browser check (`npm run check:crop`) measures both.
- Each new test fails with its fault put back.
- `npm run verify` passes. `node scripts/screenshot-flow.mjs` runs through, and the screens are looked at.
- **The owner tries it** (phone or tablet, the app from the Home Screen):
  1. Open _A Modern Panarion_ at its queries. The crop is big enough to read. Swipe sideways along it.
  2. Rule one query. Either the note says it was saved to the shelf, or it says which request failed and why. If it failed, take a screenshot of the note and send it to a session: that sentence is what finds the cause.
  3. Mark a few words in _The Lost Keys of Masonry_, refresh, and open it again. The mark is still there, and the count says it is waiting. Press "Send to the shelf".

## Modules touched

- `src/core/sync/`: a new `fold.ts`. It folds the waiting changes into a book file while keeping every field it does not know. It also folds them into a book being opened, so they show.
- `src/core/queries/`: new `crop-plan.ts` (which whole lines a crop takes, from the reading's word boxes) and `crop-note.ts` (the passage's position, carried inside the crop's own file).
- `src/platform/browser/`: a new `shelf-attempt.ts`, which names a failed request and times it. `shelf-outbox.ts` uses it and the new fold. A new `query-crop.ts` cuts and marks a crop. `shelf.ts` only splits its write in two (asking for the version, then writing), with no new behaviour.
- `src/app/`: a new `CropView.tsx`, which shows a crop at reading size. `QuestionView.tsx` uses it. `App.tsx` has small changes: the two ways of opening a book show waiting changes; "Send to the shelf" on the query screen; tries again on the query screen too.
- `scripts/drive.mjs`: `querycrops` uses the crop plan and marks the passage (`--lines` sets the context).
- `scripts/check-outbox.mjs` (fixed), a new `scripts/check-save-failure.mjs`, `scripts/check-query-crop.mjs` (extended) and `scripts/screenshot-flow.mjs` (stale steps).
- `test/`: tests for each of the above.
- `docs/still-works.md` (Known issues), `docs/reference/commands.md`, `docs/process/reading.md`.

## Rules/decisions that apply

- Root CLAUDE.md: a public repository, so tests use made-up text and names. Only packages in `harness/rules.json`; nothing is added.
- `src/core/` stays pure: the fold, the crop plan and the crop note are data in, data out.
- Every shelf read goes through `readUrl`. Outbox flushes stay chained one at a time per book.
- `src/core/sync/`: the outbox queues edits, never the book. A flush re-reads the shelf file, folds the queue in and writes once.
- A change the shelf has not taken is never dropped. A conflict is reported, never forced.
- `App.tsx` and `shelf.ts` are over the size limit: new logic goes in new files.
- Cleaned pixels feed only OCR. A crop is cut from the original render and the mark never covers the ink.

## Out of scope

- **A second way to send changes.** For example: writing each ruling as a small file beside the book for the tools to fold in, or writing large files through GitHub's lower-level Git Data API. Either is the right next step only if the new note shows a large write failing while reading still works. A small file beside the book would need every tool that reads a book to fold it in, which is a large change on its own.
- Cutting new crops for books already on the shelf. That is a session's job with the scan (`drive.mjs querycrops`).
- The crop shown when the scan is on the device (the whole leaf, as now).
- Anything that changes a published book's layout or exports.
