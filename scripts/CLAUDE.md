# scripts/

The commands sessions run: the driver `drive.mjs` (drives the app in a headless browser), the checks, exports, shelf maintenance, glossary tools and the browser checks behind `npm run check:*`. Every command is listed in [docs/reference/commands.md](../docs/reference/commands.md).

Heading: the giant `drive.mjs` (about 7,800 lines) is to be split by responsibility; book-specific one-off scripts are to move to `scripts/one-off/<book>/`.

## May use

- Node built-ins, `playwright`, `pdf-lib`, `pdfjs-dist`, `mupdf`.
- `src/core/` through vite-node (`npx vite-node --config vitest.config.ts …`), or from plain Node by registering `resolve-ts.mjs` and importing core with `await import(…)`.
- The app and `src/platform/browser/`, only inside the driver's browser (`page.evaluate` importing `/@fs…`).

## Must not

- Reimplement core logic in a script; import it, so a script and the app cannot disagree.
- Leave a tool a later session will need in a scratchpad: the glossary tools, `flatten-cover.py` and the corrections-sheet writer were each lost that way once.

## Key files

- `drive.mjs`: `serve` holds a browser on the app and takes commands on port 7788; every other verb is a command to it.
- `readiness.mjs`: the whole readiness list (C1 to C12, R1 to R11) on a book and its upload files, one report and verdict; its checks are in `lib/readiness-*.mjs`, the list and the verdict in `src/core/coherence/readiness.ts`.
- `book-files.mjs`: readable files against `book.json` (`--check`) and part of the "done" list (`--finish`; not the readiness check).
- `checks-of.ts`, `coverage-of.ts`, `page-turns-of.ts`, `spelling-of.ts`: checks that need no browser.
- `shape.mjs`: what a book is made of, recorded as `run.shape`; `--flow` regenerates `docs/FLOW.md`.
- `voice.mjs`: the editor's voice card and the prose audit.
- `resolve-ts.mjs`: lets plain Node load `src/core` (aliases, extensionless imports).
- `storage.mjs`: big files into and out of the R2 bucket, checked by fingerprint; `lib/r2.mjs` makes the requests.
- `lib/`: plain-Node helpers shared by scripts and tests (`ink.mjs` measures ink off a PNG).
- `screenshot-flow.mjs`, `check-*.mjs`: the browser checks.

## Folder-specific rules and lessons

- Anything a session needs from the browser becomes a `drive.mjs` verb, never a one-off `page.evaluate` in a shell command.
- A verb that writes a run finds it with `findRunForFile`, never by name, size and date (that lands in a run nothing opens).
- Never send a scan through the debug protocol as base64 (kills the tab, looks like flake); fetch it through the driver's `GET /file`.
- Over OCR text, strip only our own tags (`<i>`, `<b>`, `<sc>`); a `<[^>]+>` regex eats everything between a stray `<` and `>`.
- Trust a new check only after it catches a deliberately injected fault; a check with nothing to compare against must refuse, not pass.
- A check in `readiness.mjs` whose command stops before its report is NOT CHECKED, never FAILED or PASSED: confirm the report line ran before reading an exit code. A driver's `{"error": …}` or a missing count is never a zero (`test/readiness-scripts.test.ts`).
- Node 22's `fetch` ignores `HTTPS_PROXY` unless started with `NODE_USE_ENV_PROXY=1`; a script calling an outside API from a cloud session must restart itself with it, as `storage.mjs` does.
- Windows: hand the page `PAGE_REPO` (drive.mjs:163), not `REPO`; get a script's folder with `fileURLToPath`, not `URL.pathname` (`shape.mjs:49` still does).
- Browser checks: their own page and stub; install `page.route` before the first `goto`; a `goto` differing only in its hash does not reload.
