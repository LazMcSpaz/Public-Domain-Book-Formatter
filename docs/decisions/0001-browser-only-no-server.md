# 0001: A browser app with no server

Status: inherited · Date: 2026-11-18

## Decision

Everything the app does runs in the user's own browser tab: rendering scans, OCR, layout and writing the PDF. There is no server of ours, no account and no desktop shell. The built app is a set of static files published to GitHub Pages (`.github/workflows/deploy.yml`), and the Node scripts in `scripts/` drive that same app in a headless browser rather than doing the work themselves.

## Why (plain English)

A server costs money, needs looking after, and would hold other people's books and keys. Without one, the owner's work stays on his own devices and in his own repository, and the installed app keeps working offline. The original plan (SPEC.md) was a Windows desktop program with an installer and several system programs; the browser does all of that with nothing to install.

## What we gave up

The Electron desktop app, the Windows installer, and the Tesseract, OCRmyPDF, Pandoc and XeLaTeX programs that SPEC.md planned. Anything a web page is not allowed to do: the Anthropic Batches API refuses calls from a browser, and the usual fix, a small proxy server, is ruled out, so that door stays shut (see 0023). Work stops while a phone is locked or the tab is closed.

## Rule for agents

Do not add a server, a proxy, a cloud function or an account system. New capability goes into the browser app, or into a `scripts/` tool that drives it. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 15–23, 1996–2015, 2418–2441; SPEC.md, "Read this first" table and §2.
