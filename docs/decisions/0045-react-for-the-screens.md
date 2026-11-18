# 0045: React draws the app's screens

Status: inherited · Date: 2026-11-18

## Decision

The app's screens are written in React 18 (`react` and `react-dom`, `^18.3.1`) with TypeScript, in `src/app`: the wizard shell (`App.tsx`), the question renderer (`QuestionView.tsx`), the book editor and reader, the page browser and settings.

## Why (plain English)

The wizard is a set of screens built from data (0026), which React's component model handles directly. The original plan chose web interface technology for the same kind of work (linked panes, live preview, an image editor), and a browser app (0001) needs a web interface anyway.

## What we gave up

No comparison with other frameworks was recorded; the choice predates this reorganisation.

## Rule for agents

Keep React in `src/app`; never import it into `src/core` (0002). Stay on React 18, with the matching `@types/react` and `@types/react-dom`, unless a new record decides to move. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 15, 1833–1847; SPEC.md §2 ("Application shell"); package.json.
