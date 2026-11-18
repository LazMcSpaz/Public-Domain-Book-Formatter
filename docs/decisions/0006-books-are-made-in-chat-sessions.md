# 0006: Books are made in chat sessions that drive the app

Status: inherited · Date: 2026-11-18

## Decision

The owner makes books by working with an AI assistant in a Claude Code session (phone, desktop or web). The assistant drives the app through `scripts/drive.mjs`, which holds a headless browser open and runs named commands ("verbs") against it. The app is the engine and the viewer: rendering, OCR, assembly, layout and writing the PDF. The conversation does the judgement: reading, weighing a discrepancy against the scan, writing the introduction and notes. The step-by-step wizard stays as the way in for a person without an assistant, and both doors go through one surface (`src/app/agent-surface.ts`) so they cannot disagree about what the flow is.

## Why (plain English)

Each side does what it is good at. The browser holds the pixels and does the mechanical work; the prose decisions the wizard used to ask one radio button at a time are better made in conversation. So a change to the app is worth making when it improves what the assistant can see, check or write.

## What we gave up

The wizard as the main interface, though it is kept and maintained. Reading books through paid API passes: books are now read in sessions (see 0007). A Node-only toolchain, refused in 0003.

## Rule for agents

When you need something from the browser, add a verb to `drive.mjs` rather than a one-off `page.evaluate`. Prefer the four useful shapes: a driver verb, evidence returned as an image, a pure function in `src/core`, or a readable file on the shelf. Never let the wizard rot: a feature reachable only from a chat session is a feature the app does not have. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 25–78, 199–206; docs/CONTROL.md.
