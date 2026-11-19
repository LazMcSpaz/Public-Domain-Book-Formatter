# Spec: the house look (cleanup task 19)

## What it does (plain English, for the owner)

Three of your books share one design exactly. That design is now the house look: a small file kept on the shelf, which a new book takes on unless you say otherwise. Before, the look lived in one browser, so a new book proofed on another machine came out in the app's defaults (6×9, Crimson Pro).

What a new book gets:

- **The same design as the three.** Libre Caslon at 11 pt on a 7×10 page, ornamented chapter openings with the Vine and Bud ornament, chapters opening on a right-hand page, no drop capital, the author and the chapter in the running heads, a one-level contents with each label on its own line, quotations set 4 ems in, side heads from the third level, small capitals from EB Garamond, the asterism on blank pages and a border round the title page.
- **Wider side margins.** Half as wide again: the spine-side margin goes from 0.75 in to 1.125 in, the outside one from 0.5 in to 0.75 in. The binding allowance beside the spine stays 0.13 in. The top and bottom stay as they were.
- **The running head sits lower, and the page number stays put** (your decision of 19 November 2026). The head stands 1.2 body sizes above the text, where it sat before 25 October 2026: its capitals start about 33.6 pt (0.47 in) below the top edge, 8.8 pt lower than on the printed _Lost Keys_ (24.8 pt). The page number at the foot stands 24.8 pt above the bottom edge, measured to the line its figures stand on; on the printed _Lost Keys_ it sat 36.8 pt up. Only the head and the number move. No line of text and no page changes. If a book's bottom margin would put the number into the text, it keeps its old place and the proof gives a warning.
- **How that came about.** The first version of this look balanced the two: the number sat exactly as far up from the bottom edge as the head's capitals sat down from the top, both 24.8 pt. When the head came down, the number was meant to stay where it was rather than follow it, so the look now sets the number's distance from the foot on its own (24.8 pt) instead of mirroring the head. Mirroring is still there for any look that asks for it.
- **No scrap at the end of a paragraph.** A paragraph no longer ends with "pris-" on one line and "on." alone on the next. The line before the last is not broken with a hyphen, and the last line holds at least about six letters (three ems). Only a paragraph that ended that way is set again; every other paragraph keeps its lines. If both cannot be had without spacing a line out too far, the last line's length comes first and the hyphen may stay; if even that cannot be had, the paragraph is set as before.
- **Short books are 6×9.** A book that would print under 100 pages at 7×10 is set 6×9 instead, with everything else the same. The 6×9 side margins work out the same as the 7×10 ones (1.125 in and 0.75 in), because the engine's standard margins are the same on both pages.
- **Topic heads for a book divided by subheadings** (your decision of 19 November 2026; [its spec](topic-heads.md)). When at least half of a book's chapters are divided by subheadings in the text, the left page carries the chapter title and the right page the topic in force on it. Any other book keeps the author and the chapter. A book whose chapters only open with a list of topics keeps the author and the chapter, and `proof` puts the question to you.

What does not change:

- **Your published books.** Every new setting is off unless a book asks for it, and a book that has design answers of its own always keeps them. Re-exporting a published book for a correction gives the same pages as before.
- **A book that inherits the house look keeps it.** When you approve a new book's look, its design is written into the book's own file. A later change to the house look never moves a book already set.

Where it shows:

- In a chat session, `proof` on a book with no design of its own says `designFrom: the house look from the shelf (imprint/house-look.json): 7x10, 180 pages`, or `6x9, a short book (84 pages on 7x10, under 100)`, followed by the heads it gave the book and why: `chapter and topic running heads (9 of 12 chapters divided by subheadings)`. If the house look file cannot be read, it says so and why, and falls back to the defaults out loud.
- In the app, the design questions open already answered with the house look, with a line saying so.

Hebrew and Greek: the house face has neither, so those letters are drawn from Cardo, which has both. Checked on a made-up page of pointed Hebrew and polytonic Greek set in the house look: nothing prints as a box.

## Done when (how we'll know it works; how the owner can try it)

- A book with no design answers proofs in the house look, and `proof` says so. A book with answers of its own proofs in its own look.
- Measured on the rendered pages: side margins 1.255 in (spine side, with the binding allowance) and 0.75 in; the head's capitals about 33.6 pt below the top edge; the page number where the first version put it, its line 24.8 pt above the bottom edge; each within 0.5 pt. Measured on the _Lost Keys_ sample at 600 dpi on 19 November 2026: the head's ink starts 33.4 pt from the top (24.6 pt before), the page number's ink ends 24.7 pt from the bottom, exactly as before, and the text and the foot of the page are the same pixels as before.
- Tests show the scrap at the end of a paragraph without the setting and not with it; the page number in its new place and the text unmoved; the head 1.2 body sizes over the text, and the page number within 0.1 pt of where the first version put it; trim by length at 99 and 100 pages; the house look inherited, and a book's own answers winning.
- Each test fails when its fault is put back.
- **The owner tries it:** open the _Lost Keys_ PDF set in the new look (the session names where it is) beside the printed copy, and look at the margins, the page numbers and the ends of paragraphs. When you approve, the house look file is written to the shelf.

## The file

`imprint/house-look.json` at the top of the shelf, beside `voice/`. It holds design answers, the same names and values a book file keeps under `answers.design`, so it is built by exactly the code that builds every book's look:

```json
{
  "version": 1,
  "name": "Libri Vetus house look",
  "design": {
    "kind": "nonfiction",
    "period": "victorian",
    "chapterOpener": "ornamented",
    "runningHeads": "chapter",
    "font": "libre-caslon",
    "dropCap": false,
    "runningHeadVerso": "author",
    "chaptersOpenRecto": true,
    "trimSize": "7x10",
    "bodyFontSize": "11",
    "ornamentChapter": "chapter-vine",
    "contentsDepth": "1",
    "ornamentBlank": "chapter-asterism",
    "frontTitleBorder": true,
    "sideHeadsFrom": "3",
    "contentsLabelLine": true,
    "quoteIndentEms": "4",
    "smallCapsFont": "EB Garamond",
    "marginInner": "1.125",
    "marginOuter": "0.75",
    "runningHeadRise": "1.2",
    "folioFromFootPt": "24.8",
    "avoidShortLastLines": true
  },
  "shortBook": { "underPages": 100, "design": { "trimSize": "6x9" } }
}
```

`shortBook` may be left out (then: under 100 pages, 6×9) or set to `null` (every book on the house trim). Likewise `topicHeads` ([topic-heads.md](topic-heads.md)): left out, a book with at least half its chapters divided by subheadings gets the chapter title on the left and the topic on the right; `null` keeps every book on the look's own heads. A file that names a setting no question has, or is of a newer version, is refused with the reason.

## Modules touched

- `src/core/style/house-look.ts` (new): the file format, `inheritDesign` (a book's own answers win), `trimForLength` and `isShortBook` (the 100-page rule, threshold a parameter), `houseDesignFor`, the one-line report.
- `src/core/sync/shelf.ts`: `HOUSE_LOOK_PATH`, in the shelf map.
- `src/core/model/types.ts`, `src/core/style/*`: four settings, off in every shipped look, a question each: `folioMirrorsHead`, `avoidShortLastLines`, `runningHeadRise` (in body sizes, from 1 to 2; standard 2) and `folioFromFootPt` (in points; 0 sets none). 1.125 in offered as a margin.
- `src/core/layout/frames.ts`: the head's rise read from the look (`headRiseOf`); a rise out of range is set at the standard 2, with a warning. Never above 2, so the head never comes nearer the trim than the standard place.
- `src/core/layout/furniture.ts` (new): the page number's place, either set from the foot or mirrored from the head's cap height (read from the face), never nearer the edge than KDP's 0.25 in plus the figures' descent, and never up toward the text. A set distance wins over mirroring.
- `src/core/layout/runts.ts` (new) and `break-lines.ts`: the no-scrap rule; `paginate.ts` passes it to prose.
- `src/core/layout/measure.ts`, `src/platform/browser/fonts.ts`: the measurer reports the face's cap height.
- `src/platform/browser/house-look.ts` (new), `interior.ts`: reading the file, laying a book out in the look it gets, a layout-only page count.
- `scripts/lib/house-look.mjs` (new), `scripts/drive.mjs`: `proof` finds the house look at the top of the book's shelf and reports where the look came from.
- `src/app/house-look.ts` (new), `src/app/App.tsx`: the design gate opens with the house look for a book with none.
- Tests, `docs/process/export.md`, `docs/reference/commands.md`, and the folder guides.

## Rules/decisions that apply

- Published books must not reflow: anything that moves a line or a page is a setting the house look turns on, never a new default.
- The head's height and the page number's place are margin furniture, but they are still settings, off by default (a rise of 2, no distance set): a published book exported again for a correction should look exactly as it did. Checked on 19 November 2026, before and after the head was lowered: 48 looks (the shipped ones and their variants, every shelf book's design, the first house look) on two made-up books, and the 15 shelf books with a design of their own laid out from their own text, each with the test measurer and the real fonts: 222 laid-out books, byte for byte the same.
- KDP: the spine-side margin plus allowance (1.255 in) beats the largest minimum KDP asks for (0.875 in past 700 pages); outside, top and bottom are at least 0.25 in; furniture stays 0.25 in from the trim.
- `src/core/CLAUDE.md`: the rules are pure core, tested; the platform and the app only fetch and lay out.
- `scripts/CLAUDE.md`: `drive.mjs` must not grow needlessly; new logic in new files.
- This repository is public: tests and the end-to-end run use made-up books.

## Out of scope

- Writing the real house look file to the shelf. That follows the owner's approval.
- The proof view before the design gate in the app, which still shows the defaults for a new book until the design gate is reached.
- Superscript letters and symbols no face has (task 19's last point): they stay on the symbol-font list for the house font.
- A word broken without a hyphen in text set ragged (found while building this; see the report).
