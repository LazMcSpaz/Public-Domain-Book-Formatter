# Spec: topic running heads

## What it does (plain English, for the owner)

Your decision of 19 November 2026, built:

- **A book whose chapters are divided by subheadings gets topic heads.** The left page carries the chapter title; the right page carries the topic in force on that page. Any other book keeps the house look's heads: the author on the left, the chapter on the right.
- **Which topic a page shows.** The first subheading that starts on that page. If none starts there, the one the page continues from an earlier page. Before a chapter's first subheading, the chapter title. Every chapter starts afresh.
- **Which headings are topics.** In each chapter, the largest subheadings that fall inside its text. In most books those are the section heads just under the chapter title; the small side heads under them ("Patience.", "Courage.") are too minor for a running head and are left out. A chapter divided only by side heads has those as its topics. A chapter that opens straight into its first section shows that section from its first page (your ruling of 19 November 2026): a chapter of letters opening on "Letter No. 1" shows "Letter No. 1" on the right page from the start. The other headings that can stand at the top of a chapter before its text, a byline ("By A. N. Author."), a title repeated in capitals under the chapter's own, or a lone "Part One.", never show. The tools tell them apart by resemblance: the heading counts only when it is at the level the chapter is divided at and begins the way one of the later dividing headings begins ("Letter No. 1" and "Letter No. 2"; "Part One." and "Part Two."; "I." and "II."). The simpler rules ("the chapter is divided later at the same level", or "text follows it") would both have let bylines and repeated titles into the heads of the shelf's lecture series. A first section named unlike the rest ("Introduction" before "Stanza I") keeps the chapter title in the head on its pages, as before. Checked on the shelf on 19 November 2026, read only: 6 of the 10 chapters of a book of letters gain their first letter as a topic, and 3 of the 32 chapters of a collection of lectures gain their first section; no byline or repeated title is taken in either.
- **"Divided by subheadings" means at least half the chapters.** A book is given topic heads when at least half of its chapters have one or more subheadings inside their text. A preface or a chapter with no subheadings counts against it; a part title with no text of its own is not counted. Two of four chapters divided: topic heads. Two of five: author and chapter.
- **Chapters that only open with a list of topics are your question.** Some books print a summary under each chapter title, short phrases run together with dashes or full stops ("The Sacred Fire. The Vestal Virgins. The Altar. Fire as a Symbol."), and no subheadings in the text. The tools cannot know which pages each listed topic covers, so they never guess. When at least half the chapters open that way, the book keeps author and chapter heads and `proof` says, in a line headed `askOwner`, that the question is yours: keep author and chapter, or say where each listed topic begins so it can be set as a subheading (the book then gets topic heads). Checked on the shelf on 19 November 2026: no book there opens its chapters with such lists as read.
- **A long heading never runs into the margin.** A topic too wide for the page is shortened the way a long chapter title already is: the part after a colon goes first, then a leading "The", then whole words from the end, with "…" to show the cut. In a book with topic heads, every head that had to be shortened is listed in the proof report (`headsShortened`, with what was printed instead and its pages). It is not a warning: nothing can give a head a short form yet, so a warning could never be cleared and the book could never pass the readiness check. Instead the readiness check puts the list to you (R2, needs a person), and you settle it by signing it off once you have read it.
- **Tidy heads** (your decision of 19 November 2026, in the house look only, through the setting `runningHeadTidy`). Every head drops a final full stop: "WHAT A KEEPER SHOULD BE." prints "WHAT A KEEPER SHOULD BE". A question mark, an exclamation mark and closing quotation marks stay; a full stop just inside closing quotation marks or a bracket goes too. A full stop that belongs to the last word stays: after initials ("J. K. L."), after words always shortened (etc., Jr.), after a heading that is only a figure or a letter ("3."), and in "...". A topic also drops a part label in front of it: "Part II." and the dash after it go, and only the topic prints. So do "Part Six" with a dash, "Part 3:" and "Section IV." with a full stop, in capitals or not. A heading that is only a label ("Part II.", "PART TWO") stays whole, and so does one with no dash, colon or full stop after the number. A chapter title keeps a "Chapter X." in front of it: your decision named topics, and most books print a chapter's number on a line of its own, which the head already leaves out. A head that was tidied is not reported as shortened.
- **Your own choice always wins.** A book with design answers of its own keeps its heads. In the design questions, the right page now offers "Current topic (the subheading in force on the page)", and the first design question offers "Chapter and topic".

What does not change:

- **Your published books.** Every one of them names its own heads, none of them the topic, so every page lays out exactly as before. Checked on 19 November 2026 by laying out 44 looks (the shipped ones and their variants, every shelf book's own design, the house look and the interview's answers) on two made-up books, and the 15 shelf books with a design of their own from their own text, each with the test measurer and with the real fonts, on `main` and on this branch: 206 laid-out books, every one byte for byte the same, warnings included.
- **The house look file.** It needs one line for tidy heads, `"runningHeadTidy": true`, in its design ([the house look spec](house-look.md)); the topic rule needs none. A file may set its own topic rule (`topicHeads`, below), or turn it off with `null`.
- **A book keeps the whole house look when it keeps its heads.** The design written into a book is the whole of `proof`'s `inherited` answers, which carry the heads. `answers` refuses a few answers written into a book with no design of its own, because they would become its whole design and the rest of the house look would fall back to the engine's defaults.

## Done when (how we'll know it works; how the owner can try it)

- Tests show: the chapter title before the first topic; the first topic starting on a page; the topic carried to a page where none starts; two topics on one page (the head names the first, the next page the second); the reset at a new chapter; a byline before the text not taken as a topic, and a chapter opening straight into its first section showing it from its first page (and the same for a numbered or "Part One." first section, but never a byline, a title repeated in capitals, a lone part line, or a heading at another level); side heads as topics only in a chapter nothing larger divides; the chapter on the left and the topic on the right; a long topic shortened at a word, kept inside the text block, and reported once with its pages; a book without topic heads reporting nothing new.
- Tests show a shortened head kept out of the warnings and put to a person by the readiness check, who signs it off; a small-capitals book whose heads differ from the headings only in case reporting none; heads tidied (full stop, part label, question mark kept, initials kept, a label alone kept, a chapter title's label kept) and not reported as shortened, and nothing changed with the setting off.
- Tests show a partial design refused where it would replace an inherited one, naming what would be lost, and the inherited answers accepted; the house look's `topicHeads` refused when it names a key it does not have, says nothing, or offers the topic for the left page.
- Tests show the half-the-chapters rule at its boundary (two of four yes, two of five no, and a share such as 56% met exactly by 14 of 25), the house look giving chapter and topic heads to a descriptive book and author and chapter to another, the question raised for a book of topic lists, a book's own answers winning, and topic lists told apart from prose, dialogue, mottoes, bylines, scales and glossary entries, and from a motto in verse, a quotation of short sentences and a column of maxims (only a paragraph can be a list).
- Each test fails when its fault is put back.
- **The owner tries it:** open the sample PDF the session names, set in the house look with chapter and topic heads, and turn to the pages it lists: a chapter title in the head before the first topic, a topic changing in mid-chapter, and any head that had to be shortened.

## The house look file

A house look may carry a `topicHeads` rule beside `shortBook`. Left out, it is the owner's rule:

```json
"topicHeads": {
  "atLeast": 0.5,
  "design": { "runningHeadVerso": "chapterTitle", "runningHeadRecto": "topic" }
}
```

`atLeast` is the share of chapters (with text) that must be divided by subheadings, above 0 and at most 1. `design` is laid over the house look's answers for a descriptive book; every answer in it must be one its question offers, and the topic is offered for the right page only. `null` gives every book the house look's own heads. A rule that names any other key, or says nothing (`{}`, or a `design` that sets nothing), is refused with the reason. The inherited answers `proof` reports (`inherited`) include the heads, so a book that keeps them keeps its heads.

## Modules touched

- `src/core/model/types.ts`: the running-head mode `topic`.
- `src/core/assemble/divisions.ts` (new): what divides each chapter (`chapterDivisions`), the topics' headings (`topicHeadingIds`), the counts, the half rule (`isDescriptive`, `DESCRIPTIVE_SHARE`), the topic-list shape (`looksLikeTopicList`) and the question rule (`opensWithTopicLists`). It reads the chapters `deriveChapters` makes and never re-derives them.
- `src/core/layout/topic-heads.ts` (new): the rule for a page (`topicHead`, `topicShown`, `topicsOnNewPage`, `topicsAfterHeading`) and the record of shortened heads. `paginate.ts` calls it in four places and reuses `fitRunningHead`.
- `src/core/layout/head-tidy.ts` (new): tidy heads (`tidyRunningHead`), behind the setting `runningHeadTidy` (`src/core/model/types.ts`, `src/core/style/defaults.ts`, `profile.ts`, `editable.ts`, `saved-profile.ts`), off in every shipped look.
- `src/core/layout/types.ts`: `headsShortened`, present only in a book with topic heads.
- `src/core/style/house-look.ts`, `src/core/style/house-heads.ts` (new): the `topicHeads` rule, read strictly and applied (`houseHeadsFor`), the line saying which heads a book got, and the house settings a partial design would lose (`houseSettingsLost`).
- `src/core/style/editable.ts`, `profile.ts`, `src/core/design/design-interview.ts`, `src/core/wizard/steps.ts`: the topic offered for the right page; "Chapter and topic" in the interview.
- `src/platform/browser/house-look.ts`, `interior.ts`, `src/app/house-look.ts`: the heads laid in when a book inherits the house look, and the question handed on.
- `scripts/drive.mjs`: `proof` reports `askOwner`, `headsShortened` and each heading's level in `chapters`; `answers` refuses a partial design over an inherited one (`--partial` writes it anyway); `insert … heading --level 2` writes a subheading.
- `scripts/lib/readiness-ready.mjs`, `src/core/coherence/readiness.ts`: R2 puts `headsShortened` to a person.
- Tests (`test/topic-heads.test.ts`, `test/head-tidy.test.ts`, `test/divisions.test.ts`, `test/house-heads.test.ts`, `test/house-look-wired.test.ts`, `test/readiness-scripts.test.ts`, `test/style-editable.test.ts`), `docs/process/export.md`, `docs/process/checking.md`, `docs/reference/commands.md`, the house look spec and the folder guides.

## Rules/decisions that apply

- Published books must not reflow or change: topic heads are a mode no published book names, and nothing about them runs unless a head shows the topic. That is why a shortened chapter title in a book without topic heads is still not reported: reporting it would change those books' laid-out result.
- `src/core/CLAUDE.md`: chapters come only from `deriveChapters`; the rules are pure core, tested.
- `src/core/layout/CLAUDE.md`: furniture never spills into the margins; every fallback is said in the warnings. A shortened head is not a fallback but the head working as made; it is said in `headsShortened` instead, because a warning nobody can clear would keep the book from ever being ready.
- `scripts/CLAUDE.md`: `drive.mjs` and `paginate.ts` must not grow needlessly; new logic in new files.
- The owner rules on every editorial question: a book of topic lists is his question, never the tools' guess.
- This repository is public: tests and the spec use made-up text only.

## Out of scope

- A place to keep a short form for a long running head. Until there is one, a shortened head is reported in `headsShortened` and the readiness check asks the owner to read it and sign it off.
- Topic heads in a book whose chapters only list their topics: the owner decides per book.
- Reporting shortened heads in books without topic heads (it would change published books' laid-out result).
