# Decision records

One short record per technical or method decision. A decision is changed only by writing a new record.

## Foundations

- [0001](0001-browser-only-no-server.md) A browser app with no server: everything runs in the tab, nothing to install.
- [0002](0002-core-stays-pure.md) The core stays pure: `src/core` uses no browser or Node features, so it tests and runs anywhere.
- [0003](0003-one-renderer-the-preview-is-the-pdf.md) One renderer: the preview is the PDF, so approving the screen means approving the print.
- [0004](0004-measure-with-the-engine-that-draws.md) Measure with the engine that draws: one fontkit call measures and draws text.
- [0005](0005-the-shelf-is-a-git-repository.md) The shelf is a git repository the owner owns: the source of truth, with readable files beside each book.
- [0006](0006-books-are-made-in-chat-sessions.md) Books are made in chat sessions that drive the app: the app is engine and viewer, the conversation judges.

## The reading method

- [0007](0007-propose-from-sense-accept-from-pixels.md) Propose from sense, accept from pixels: findings, never replacement text, and staged reading.
- [0008](0008-editor-decisions-are-raised-never-taken.md) A decision that is the editor's is raised, never taken: transcribe as printed and attach a query.
- [0009](0009-proposals-are-an-unselected-menu.md) Proposals are an unselected menu: the reader's answers offered, none chosen.
- [0010](0010-standing-rulings-prefill-and-hold.md) Standing rulings pre-fill and hold, never settle: the editor still approves each case.
- [0011](0011-ocr-is-the-independent-witness.md) OCR is the independent witness, not the source of truth.
- [0012](0012-provenance-decides-trust.md) Where a page came from decides trust: a photograph or not, converted text or typeset.
- [0013](0013-without-pixels-the-book-is-its-own-witness.md) Without pixels, the book is its own witness, only where it can count.

## Checks and safety

- [0014](0014-refuse-rather-than-warn.md) Guards against silent loss refuse; they do not warn.
- [0015](0015-deterministic-cross-checks-not-model-opinion.md) Escalation by deterministic cross-checks, never a model's opinion of itself.
- [0016](0016-report-never-drop.md) Report, never drop: anything the engine cannot place reaches the export screen.
- [0017](0017-one-question-one-implementation.md) Two passes that ask one question share one implementation.
- [0018](0018-checks-are-scored-before-they-are-trusted.md) A check is trusted only after it has been scored against real faults.
- [0019](0019-every-printed-glyph-has-a-width.md) Every glyph the book prints has a width, or the PDF is not written.
- [0020](0020-saved-runs-migrate-or-refuse.md) Saved runs migrate or refuse, never load half.
- [0021](0021-credentials-stay-in-the-browser.md) Credentials stay in the browser, never in a file, log, prompt or commit.
- [0022](0022-driver-cannot-spend-or-carry-keys.md) The driver cannot spend money or carry keys, and shows when it is live.
- [0023](0023-paid-batch-path-probed-and-ticket-kept.md) The paid batch path is probed, and its ticket is never thrown away.
- [0024](0024-bias-audit-after-writing.md) The editor's prose gets a bias audit after it is written.
- [0025](0025-voice-card-is-the-source.md) The voice card is the source; the writing agent is its copy.

## The app and the book

- [0026](0026-the-app-interviews.md) The app interviews; questions are data, asked when the app can help.
- [0027](0027-correct-content-never-presentation.md) Correct content, never presentation: no hand-placed breaks or per-paragraph styling.
- [0028](0028-edits-over-a-pristine-transcription.md) Corrections are edits over a pristine transcription, keyed to assembled blocks.
- [0029](0029-reading-marks-and-memos-cannot-print.md) Reading marks and memos cannot print, and are found by their words.
- [0030](0030-front-matter-is-replaced.md) Front matter is replaced, not transcribed; an analytical contents keeps its prose.
- [0031](0031-never-invent-resolution.md) Never invent resolution: pictures are placed at the size the scan supports.
- [0032](0032-non-destructive-image-editing.md) Non-destructive picture editing, no background removal.
- [0033](0033-ornaments-are-vector-paths.md) Ornaments are vector paths drawn by the PDF writer.
- [0034](0034-style-has-two-levels.md) Style has two levels: the reusable look and the book's own facts.
- [0035](0035-page-cleanup-off-by-default.md) Cleaning a page before OCR is built, and off by default because it did not help.
- [0036](0036-tablet-is-an-installed-web-app.md) The tablet app is the web app installed, not a native app.

## Packages

- [0037](0037-pdfjs-dist-stays-on-v4.md) pdfjs-dist (pdf.js) stays on version 4, for current browsers and the iPad.
- [0038](0038-tesseract-js-with-vendored-assets.md) Tesseract.js is the OCR engine, imported from its ESM build, its files vendored.
- [0039](0039-pdf-lib-writes-the-pdf.md) pdf-lib writes the PDF, with fonts embedded whole.
- [0040](0040-fontkit-shapes-and-measures.md) fontkit shapes the type for both measuring and drawing.
- [0041](0041-book-faces-from-expo-google-fonts.md) Book faces come from @expo-google-fonts as embeddable, open-licensed TTF.
- [0042](0042-junicode-vendored-by-hand.md) Junicode is vendored by hand, with EB Garamond as its fallback.
- [0043](0043-paddle-ocr-second-reader-pinned.md) PaddleOCR is the second reader, pinned exactly and handled specially.
- [0044](0044-mupdf-pinned-for-scripts.md) mupdf is pinned exactly, for measurement scripts only.
- [0045](0045-react-for-the-screens.md) React draws the app's screens.
- [0046](0046-vite-serves-and-builds.md) Vite serves the app in development and builds it for GitHub Pages.
- [0047](0047-vitest-runs-the-tests.md) Vitest runs the tests, in Node, with no browser.
- [0048](0048-playwright-drives-a-headless-browser.md) Playwright drives a headless browser for the agent and the checks.
- [0049](0049-tex-linebreak-and-hyphenation.md) Lines are broken by tex-linebreak with TeX's hyphenation patterns.
- [0050](0050-small-development-tools.md) Small development tools: TypeScript, ESLint, Prettier and friends, with two unused packages to clean up.
