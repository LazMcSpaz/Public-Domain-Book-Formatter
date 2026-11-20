# src/core/cover/

The cover: the flat KDP sheet (back, spine, front) computed from the trim, the page count, the paper and the binding; a composer that turns a cover document into placed items; the KDP cover checks; the look a collection banks; the cover interview; the ground patterns, figures and textures. How a spec is written and why it works this way: [docs/reference/cover-composer.md](../../../docs/reference/cover-composer.md).

## May use

- `@core/layout` (the `TextMeasurer`, `typographicQuotes`), `@core/ornament`, `@core/image`, `@core/transcribe`, `@core/wizard`, `@core/design`, `@core/model`.

## Must not

- Hold pixels, fetch a file or draw: the picture is the platform's (`src/platform/browser/cover-*.ts`, `press-mark.ts`).
- Build in a book's picture. The built-in figures are the press's vector traces in `public/devices/`; a book's picture is a texture file the cover command is given (`texture.ts`), which stays with the book.
- Put a book's ISBN, title or any real book's details in a test: use made-up ones with valid check digits.

## Key files

- `geometry.ts`, `geometry-stock.ts`: the sheet: spine from page count and caliper, bleed, wrap, hinge, safe areas, the barcode box. Computed, not looked up; KDP's templates are evidence in `test/cover-geometry.test.ts`.
- `compose.ts`: `composeCover`, the grounds, then `compose-front.ts` (picture, frame, band, device), `compose-front-type.ts` (title, rule, edition, subtitle, author, imprint), `compose-back.ts` (back and spine), `compose-barcode.ts`; `compose-frame.ts` holds the frame, rules and `frameStrokeIn`; `compose-text.ts` the display type.
- `document.ts`, `document-look.ts`, `document-normalize.ts`: the cover document, the look (every field with its reason) and `normalizeLook`.
- `profile.ts`: `BANKED_COVER_KEYS`, what a banked look carries. A new look field fails `test/cover-profile.test.ts` until it is listed.
- `figures.ts`, `figures-frame.ts`, `figures-back.ts`: the built-in ground figures, their boxes, anchors, fades and the tint clamp.
- `texture.ts`: a book's picture as the ground: `readTextureSpec`, `applyTexture`, `alignedOffset`.
- `patterns.ts`, `patterns-shapes.ts`: the allover grounds.
- `validate.ts`, `flatten.ts`: the KDP cover checks and what must be flattened.
- `interview.ts` and `interview-*.ts`: the cover studio's questions and `coverFromAnswers`.

## Folder-specific rules and lessons

- A figure stops at the fold unless it is one picture across the whole sheet (`groundFigureWrap`): two halves either side of a fold that creeps do not meet.
- A texture or figure is placed by the look's switches (`groundFigureInFrame`, `groundFigureOnRule`, `groundFigureWrap`), one box for both (`test/cover-texture.test.ts`).
- Measure a placement against the items the composer draws, not against its constants (`test/cover-on-rule.test.ts`).
- Check what a size is a share _of_ before changing the share: the author was small because the title was pinned small.
- Centre display type on its ink (`inkExtents`), not its advance box.
- A check that fires on every cover is one its reader learns to skip: a ground (pattern, figure or texture) is never an element in the barcode area.
- Judge a cover at thumbnail size (about 160 px wide) as well as reading size; render it before asking the owner.
