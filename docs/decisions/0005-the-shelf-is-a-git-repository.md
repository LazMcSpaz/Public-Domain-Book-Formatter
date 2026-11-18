# 0005: The shelf is a git repository the owner owns

Status: inherited · Date: 2026-11-18

## Decision

Each book lives as one file, `books/<dir>/book.json`, in a private git repository on GitHub that the owner owns (the shelf), written with his own fine-grained token. The scan goes up once, named by its SHA-256 (`scans/<sha256>.pdf`), and the editor's pictures go up as separate image files, so a save rewrites only the small book file. The shelf is the source of truth; the browser's storage is only a cache of it. Beside `book.json` sit readable Markdown files generated from it (`corrections.md`, `glossary.md`, `queries.md`, `rulings.md` and others).

## Why (plain English)

Browser storage is lost when site data is cleared or the device changes; a repository keeps every version forever and needs no server or account of ours. It is a shelf rather than a store of data blobs so that the owner can open it and read what was done, and JSON is not readable in that way, so anything he reviews also appears as Markdown.

## What we gave up

A database or cloud storage. Saving needs a connection and a token, and a scan over 40 MB (`MAX_SCAN_BYTES`) cannot go up at all. The readable files can drift from `book.json`, so a change to a book is four edits in one commit: the book file, the exported PDF, the readable files, and the commit that carries them all.

## Rule for agents

Load a book from the shelf before touching it, and push what you change. Never write a credential into a book file. When `book.json` changes, re-export and regenerate the readable files (`scripts/book-files.mjs`) and commit them together; `book-files.mjs --check` reports drift. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 44–62, 243–253, 1447–1477, 2418–2441, 2470–2489; docs/HANDOFF.md §2 and §3; docs/PROCESS-edition.md ("The one rule").
