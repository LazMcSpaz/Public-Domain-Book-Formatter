# Books read here, pending a shelf

The shelf is a **git repository of the editor's own**, and this is not it —
`src/core/sync` writes a book there with the editor's own token, and
`drive.mjs shelf push` sends it. This directory exists because that token is
not in every container a session runs in, and a reading that reaches only a
local file is work done into a machine that is about to be reclaimed.

So what is here is a **durable copy, not a home**. Each book is the same
`book.json` `serializeBookFile` writes — transcription, corrections, notes,
rulings, every gate answer — with its two editorial sheets beside it so they
can be read in GitHub's own file view:

- `book.json` — the book. Open it in the app, or push it to a shelf.
- `queries.md` — decisions waiting on the editor.
- `rulings.md` — decisions the editor has made, and when.

The scan is deliberately **not** here. It goes to the shelf under its own
digest, written once, because git keeps every version and a re-sent scan grows
the repository by a whole scan each time.
