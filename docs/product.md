# Libri Vetus editions, and the formatter that makes them

_Approved by the owner on 18 November 2026._

## What it is

New editions of public-domain occult and esoteric books, sold on Amazon KDP under the Libri Vetus imprint and edited as Etsu T. Dhent. Each is faithful to the original text and adds what makes it worth buying: an introduction, a glossary, footnotes and illustrations. The formatter is the workshop that makes them: a browser app plus the scripts Claude sessions run. The shelf is the private repository where every book lives.

## Who it's for

- **Uses it:** the owner (editor and publisher), mainly through Claude chat sessions, which drive the app and the scripts. Possibly other people later.
- **Buys the result:** readers on Amazon.
- **Runs on:**
  - Claude Code sessions in the cloud and on the owner's Windows computer; this is where most of the work happens (owner's decision, 18 November 2026);
  - the browser app, installed from the web, which is the engine the sessions drive and the owner's main window on the work (owner's decision, 19 November 2026, replacing "secondary and need not be robust"): reading, ruling and marking from the shelf, and the Workroom, where he sees the agents' roles, tasks and progress.

## The core loop

Take a book from its source (a scan, a born-digital PDF or an EPUB) to a printed edition that:

1. **reads exactly as the original printed it,** every word checked against the page;
2. **adds real value:** introduction, glossary, notes and pictures in the editor's voice;
3. **is truly ready when it is called ready.** Every check has run on the exact files that go to KDP, and anything not checked is said out loud.

The third point is the owner's biggest frustration so far: books declared done that turned out not to be.

## What it does today

- **Reads** scans, born-digital PDFs and EPUBs into text, and checks that text against the page images and a second, independent reading.
- **Puts every decision that is the editor's** to the editor as a question, with the reader's suggested answers, worked one at a time on the tablet.
- **Writes** introductions, glossaries and notes in the editor's voice, then audits them for bias and banned phrasing.
- **Lays out** print-ready KDP interiors, covers and EPUBs. The preview is the real PDF.
- **Keeps** every book, decision and record on the shelf, with full history.

## Never

- **Never call a book done, checked or ready to upload** unless the full readiness check has run on the exact files being uploaded. Say what was not checked.
- **Never let a model invent text.** A reading is accepted only against the page image, or, where there is no image, against the book's own counted evidence.
- **Never take a decision that is the editor's.** Raise it as a question, with suggested answers and none pre-selected.
- **Never assert or quietly deny the truth of the tradition.** State the established teaching plainly, never push a reader, and never let a term's ancestry stand in for an argument.
- **Never tell the reader what to read next.**
- **Never use long dashes in the editor's prose.**
- **Never spend money or handle keys on the editor's behalf** without the editor pressing the button. Keys and tokens never go into a book file, a prompt or a log.
- **Never draw a placeholder** for a missing picture or footnote. Report it instead.
- **Never publish a study book,** and never put book text or the owner's personal details in this public repository.
- **Never add a second way of drawing pages.** The preview is the PDF.

## Works with

- **Amazon KDP:** paperback, hardcover and Kindle uploads.
- **GitHub:** the shelf and this repository; hosts the app.
- **Scan sources:** archive.org, HathiTrust, Google Books, Wikimedia Commons.
- **Research sources:** the Theosophical sources named in the editorial rules.
- **Claude Code sessions:** cloud and desktop.
- **The owner's E: drive:** weekly backups.
- **File storage for large files:** chosen by test; see the decision records.

## Future directions

| Direction                                          | Status | What it means for the structure                                                                                                                   |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Many more books (dozens a year, across series)     | likely | Permanent book IDs, a catalogue record per book, book templates, automatic checks on the shelf                                                    |
| Tracing and picture books (original beside traced) | likely | Each book's `images/` holds originals, traced versions and a provenance record; layout support for facing pages; the Book of Solomon is the pilot |
| Compilations                                       | likely | A compilation book type with a parts list                                                                                                         |
| Books of the owner's own writing                   | maybe  | Noted; the "original work" book type does not rule it out                                                                                         |
| Audiobooks                                         | maybe  | Paused; the audiobook work is kept together and marked paused                                                                                     |
| Selling beyond Amazon                              | maybe  | Noted; listings per book, not one KDP-only file                                                                                                   |
| Translations                                       | maybe  | Noted; nothing assumes one language per book                                                                                                      |
| Other people working on it                         | maybe  | Noted; roles defined as agents, rules written down, checks automatic                                                                              |

Revisit this table whenever a change seems to push the project in a new direction.
