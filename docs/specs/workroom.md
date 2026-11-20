# Spec: the Workroom (step 3 of the owner's order of 19 November 2026)

## What it does (plain English, for the owner)

The Workroom is a screen in the app where you see, at a glance, what the team of agents is doing. It reads the status notes every agent leaves on the shelf ([status-notes.md](status-notes.md)) and shows them in the look you approved on 19 November 2026 ([the mock-up](workroom-mockup.html)): a dark gilded band at the top with gold lettering, a strip of counts and a live light; "Waiting on you" in deep oxblood with gold accents; a parchment page with light role columns and cards.

It shows five things:

1. **Waiting on you.** Every job waiting on you, the one that has waited longest first, with what is needed and the files to open. Tapping a questions sheet opens that book's question screen in the app, where you rule as you do now. Any other file (a readiness report, a draft, a sheet) opens in a plain reading view inside the app, read from the shelf: a Markdown sheet as ordinary text with headings and lists, a JSON file laid out readably. Never a raw GitHub page.
2. **The books.** Each book with its current stage among the eight (sourcing, reading, checking, writing, pictures, layout, upload, published), a small strip of eight steps showing how far it has come, and its latest jobs.
3. **The roles.** The seven roles, then the builder and the reviewer, each in its own column under its emblem: its jobs in progress, the ones it finished in the last week, and work handed to it that nobody has picked up yet. A job that has said nothing for twelve hours while claiming to be working is shown as **stale**, never as working. Tools work (a job with no book) appears under its role like any other.
4. **A job's detail,** when you tap it: its whole timeline, how far it has got, what came of it, the files it left (opened the same way), the job it took over from and whom it handed to.
5. **The counts:** how many jobs wait on you, how many agents are at work, how many books are in progress, and how many jobs were finished this week.

It is **live**. It reads the shelf when you open it, again every minute while it is on screen, and again as soon as you come back to it from another app. It says when it last read: "live from the shelf, 2 minutes ago". It does not read while it is hidden. If a read fails, it keeps showing the last good copy and says plainly why (no answer from the shelf, a token GitHub rejected, a branch the shelf does not have), beside the light and in full under the counts, and when it last could read.

A note that cannot be read is listed at the bottom as unreadable, with the reason, and never stops the rest of the screen from showing. With no notes at all it says: "No agent has reported yet. Notes appear here as the team works."

You reach it in one tap from the shelf screen (the **Workroom** button beside Refresh) or from the side rail on any screen, and it has its own address (`#workroom`) you can add to the Home Screen.

This version only shows. You act by opening a linked screen (ruling a query) or by telling a session in chat. Telling the Workroom "I have answered this" is a named open point, not built here.

## Done when (how we'll know it works; how the owner can try it)

- With made-up notes on a stand-in shelf, a browser check (`npm run check:workroom`) shows: the three views hold the right jobs; a stale job shows as stale; a waiting job's questions link opens that book's question screen; a job's detail shows its timeline; another file opens in the reading view; at phone width the columns stack; a malformed note is listed as unreadable with its reason; an empty shelf says the plain sentence above.
- A second browser check (`npm run check:device-db`) seeds the app's main database as `main` builds it, a made-up record in every store, and shows: the shelf screen, the Workroom and Settings' Forget leave its version, stores and records as they were, and a Workroom open in another tab drops its copy too; a browser left at version 8 by this branch's first version still opens and reads it; an open held up by another tab closes its late connection; a newer version opened in another tab makes the page let go at once and say to reload.
- Unit tests for the reader against a stand-in for GitHub: one listing request finds every note; a note already read is never fetched again; only new or changed notes are fetched; a malformed note is reported with the parser's reason; an empty shelf is empty, not an error. Each test fails with its fault put back.
- Screenshots at tablet and phone size, made-up data, looked at against the mock-up.
- `npm run verify` passes. Published books' layouts and exports do not change: nothing in the layout engine or the exports is touched.
- **The owner tries it:** on the tablet, open the Libri Vetus app, tap **Workroom** on the shelf screen. The screen shows what is waiting on you, where each book stands and what each role is doing, and says how long ago it read the shelf. Tap a job to see its timeline; tap a questions sheet to land on its question screen.

## How the notes are read (for the builder)

The notes live in `work/runs/<yyyy-mm>/` on the shelf, one file per run, and a waiting note can be months old, so every month is read, not only recent ones. Reading hundreds of files one request at a time would be slow on a tablet, so:

- **One request lists them all.** GitHub's git trees API, asked for the shelf's branch and the `work/runs` folder with `recursive=1` (`git/trees/<branch>:work/runs?recursive=1`), returns every file under it with its blob sha (git's fingerprint of the file's bytes). A 404 means the folder is not there yet (no agent has reported); the repository and then the branch are checked once, so a token that cannot see the shelf, or a branch in Settings the shelf does not have, is reported as that by name, not as an empty board. A listing GitHub cuts short (over 100,000 entries) is read again month folder by month folder.
- **A named limit:** a single month's listing that GitHub cuts short (over 100,000 notes in one month) is not noticed, so the notes past the cut would be missing without a word. At one note per run that is far beyond any month the team will have; it is left as it is.
- **A note is fetched only when its fingerprint is new.** Notes are fetched by blob sha (`git/blobs/<sha>`, raw), and kept in a cache keyed by that sha, in memory and on the device, so an unchanged note is never fetched again, even after the app is closed. A changed note has a new sha and is fetched once. The cache is trimmed to what the shelf lists after each read. Each fetched note is checked to match its sha before it is kept, so a cache or proxy that answered with the wrong bytes cannot plant a wrong note.
- **The device copy** is in a database of its own (IndexedDB `pdbf-workroom`, version 1, one store of notes keyed by blob sha), opened only by `note-store.ts`. Never in `localStorage`: that is shared with the shelf's token and the API key and is small on a phone (about 5 MB in Safari), and months of notes there would stop the token being saved. Never in the app's main database either (`run-store.ts`): that holds the owner's runs, kept scans, readings and the outbox of rulings and marks not yet sent, and adding a store to it means raising its version, which breaks every tab still open on the old code until it is reloaded. A copy that costs nothing to lose is not worth that. Writing the copy never holds up the screen, a refused write is tried again after the next read, and a device whose browser will not open the database keeps the notes in memory, for the open page only. Settings, under Storage on this device, shows its size and can forget it: that empties only the Workroom's database, and every open Workroom, in this tab or another, drops its own copy too, so its next read fetches every note from the shelf again, as Settings says.
- **The main database stays at version 7, as on `main`.** This branch's first version raised it to 8 for the notes. That was never deployed, but a browser that ran it (a check's browser, or a driver's profile) keeps the database at 8: the app opens such a database at the version it has instead of failing (every version only adds stores), and the main database's next version is 9. A connection to it lets go at once when a newer version of the app asks for the database in another tab, and the page says plainly to reload (`NewerVersionNotice.tsx`). An open held up by another tab answers at once with nothing, as before, and if it goes through later that connection is closed at once, so it cannot hold up the next one.
- **Named limits of the sheet reader** (`markdown.ts`). Two spots take time that grows with the square of a sheet built to be awkward. HTML comments are cut out by a pattern that, for each `<!--` never closed, looks to the end of the sheet: 160 KB of unclosed `<!--` takes about 1.6 seconds. And at each `[` a link is tried, which looks along the rest of the line for its close: one line of 80,000 `[` takes about 3 seconds. The tools never write sheets like these, so both are left as they are; such a sheet is slow to open, never shown wrongly.
- **The shelf connection's rules.** Every request goes through `reach` (so "no answer" is named as such), carries the unique `unshared` mark that every shelf read carries, and is `no-store`. The mark now comes from one place (`shelf-request.ts`), which `readUrl` in `shelf.ts` also uses; the token is still sent only to `api.github.com`.
- **Parsing is core's.** The files go to `readNotes` (each checked strictly and against its file name; a bad one reported with the parser's reasons), and the views come from `workroom(notes, now)`. The app adds no grouping, ordering or stale rule of its own; the counts, the step strip and the book's readable name are small pure helpers in `src/core/work/`.

## Modules touched

- `src/core/work/`: new pure helpers for the screen (`board.ts`: the counts, the step strip, a book's name from its folder; `links.ts`: what a link opens; `markdown.ts`: a sheet as headings, paragraphs, lists, tables and code). `src/core/sync/work-paths.ts`: which entries of the trees listing are notes.
- `src/core/wizard/deep-link.ts`: a link may name a book by its shelf folder as the shelf names it (capital letters, dots and underscores included), so `#book=<folder>&at=queries` opens the question screen for every book on the shelf. Before, it accepted only lower-case names, which none of the shelf's renamed folders are.
- `src/platform/browser/shelf-notes.ts` (new): the reader and its cache; `note-store.ts` (new) keeps the device copy in its own database (`pdbf-workroom`) and tells every open Workroom when Settings forgets it; `notes-failure.ts` (new) says a failed read in words. `run-store.ts` stays at version 7 and gains only what the main database needs anyway: it opens a database a newer build raised, lets go when a newer version asks, and closes a connection that comes after its open was answered "blocked". `src/platform/browser/shelf-request.ts` (new): what every shelf request carries (the address of the API, the headers, `no-store` and the `unshared` mark), moved out of `shelf.ts`, which gets shorter.
- `src/app/`: `Workroom.tsx`, `WorkroomCards.tsx`, `RunDetail.tsx`, `ShelfFileView.tsx`, `workroom-live.ts`, `workroom-emblems.tsx`, `workroom.css`, `NewerVersionNotice.tsx` (new); `main.tsx` gains the `#workroom` address and shows the newer-version band on every screen; `App.tsx` gains the Workroom button on the shelf screen and the link in the side rail (wiring only).
- `scripts/check-workroom.mjs` and `scripts/check-device-db.mjs` (new, with `scripts/lib/device-db.mjs`), `package.json` (`check:workroom`, `check:device-db`).
- Tests; `docs/still-works.md`, `docs/reference/commands.md`, `docs/architecture.md` and the folder `CLAUDE.md` files.

## Rules/decisions that apply

- Root `CLAUDE.md`: this repository is public, so tests, screenshots and the check use made-up books only. Only listed packages (the Markdown view is our own few lines, not a package).
- `src/platform/browser/CLAUDE.md`: every shelf read through the shelf connection's conventions (`reach`, the unique mark, `no-store`).
- `src/app/CLAUDE.md`: the app holds no book logic; the views come from core.
- [status-notes.md](status-notes.md): the record, the stale rule (twelve hours), a book's current stage, and "picked up" for a hand-off.
- `docs/product.md`: the app is the owner's main window on the work; a note never says a book is checked or ready to upload, only the readiness report does, so the Workroom shows a checker's report as a file to open, never as a verdict of its own.

## Out of scope

- **"The owner answered"** as an action in the Workroom. When you rule in the app, the job stays waiting until its agent or the managing editor moves it on. Showing "answered, not yet picked up" needs a record of the answer (in the note, as a version 2, or beside it); that is decided later.
- Changing a note from the app in any way: the Workroom only reads.
- A PDF or picture viewer for linked files beyond what the reading view shows (a picture is shown; a PDF is named, with where it is).
- Other people working on it: the views are written for one owner.
- Notifications when something starts waiting.
