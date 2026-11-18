# src/app/

The React web app: the guided flow (wizard), the question screens, the book editor and reader, the page browser and Settings. It shows and collects; the decisions about the book are made in `src/core/`.

Heading: `App.tsx` (about 5,700 lines) is to be split along clear responsibilities, one task at a time.

## May use

- `src/core/` (alias `@core`) and `src/platform/browser/` (imported by relative path), React.

## Must not

- Hold book logic of its own; put it in `src/core/` and call it.
- Approximate layout: show line and page breaks only as engine data (`blockPages`) or the design (`@core/style` `readingStyle`).

## Key files

- `App.tsx`: the flow shell: steps, saving, shelf routes, the export screen's wiring.
- `QuestionView.tsx`, `QuestionList.tsx`: render any `Question`; the gate pager.
- `agent-surface.ts`: `useAgentSurface`, the one place a driver or bridge command is carried out.
- `BookEditor.tsx`, `BookReader.tsx`: the galley ("Edit the book") and the reading view ("Read the book").
- `passages.ts`, `dom-offsets.ts`: the column both views build, and DOM to text offsets.
- `PageBrowser.tsx`, `PreviewPane.tsx`: pages of the finished PDF, rendered from its bytes.
- `main.tsx`: the entry; the `#preview` route (`DevPreview.tsx`) is dev-only.

## Folder-specific rules and lessons

- Verify UI changes: run `node scripts/screenshot-flow.mjs` against the dev server and look at the PNGs in `screenshots/`. Never ship UI blind.
- The gate pager is controlled (no local copy of the place); groups come from `Question.group` via `groupQuestions`, never parsed from ids.
- The Read view never edits text; DOM and text offsets meet only in `dom-offsets.ts`, and the column is built only by `passages.ts`.
- A book opened to read (`readFromShelf`) has no scan or recon: saves must not need `fileDataRef`; the outbox baseline is the loaded edits.
- An empty query gate is walked through in the shell, never by `canEnter`: the proof step needs `gate-queries` completed.
