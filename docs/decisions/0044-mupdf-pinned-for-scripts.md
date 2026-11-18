# 0044: mupdf is pinned exactly, for measurement scripts only

Status: inherited · Date: 2026-11-18

## Decision

`mupdf` (the MuPDF library compiled to WebAssembly) is a development dependency pinned exactly at 1.28.1. It is used only by Node scripts that work on a scan: measuring italic type and line positions (`italic-witness.mjs`, `slant-witness.ts`, `coverage-of.ts`), taking the permissions lock off encrypted scan chunks (`decrypt-chunks.mjs`), and extracting the images a ClearScan file kept (`reading-kit/sd/images.mjs`). The app never loads it.

## Why (plain English)

These are one-off jobs on a scan in Node. For one of them the reason is stated: some Secret Doctrine scan chunks are encrypted, pdf-lib refuses them, and MuPDF decrypts them. It was declared in `package.json` on 24 September 2026 because an undeclared install was removed by the next `npm install`. Why the version is pinned exactly was not recorded; this pin is not in the old list of deliberate pins.

## What we gave up

Simplicity: this is a third PDF library beside pdf.js and pdf-lib. The scripts state that MuPDF is used for measurement only, never as a second renderer of the book (0003).

## Rule for agents

Keep it out of `src/` and out of the app. Treat the exact pin as deliberate until someone tests a newer version against these scripts and writes a new record. Never use it to draw or preview pages of the edition. Do not replace without a new decision record.

## Source

harness/sorting/part-4.md, contradiction 8 and "Packages in use"; git commit 09d5407 ("Declare mupdf as a dev dependency"); scripts/italic-witness.mjs (header comment).
