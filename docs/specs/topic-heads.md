# Spec: topic running heads

## What it does (plain English, for the owner)

Your decision of 19 November 2026, built:

- **A book whose chapters are divided by subheadings gets topic heads.** The left page carries the chapter title; the right page carries the topic in force on that page. Any other book keeps the house look's heads: the author on the left, the chapter on the right.
- **Which topic a page shows.** The first subheading that starts on that page. If none starts there, the one the page continues from an earlier page. Before a chapter's first subheading, the chapter title. Every chapter starts afresh.
- **Which headings are topics.** In each chapter, the largest subheadings that fall inside its text. In most books those are the section heads just under the chapter title; the small side heads under them ("Patience.", "Courage.") are too minor for a running head and are left out. A chapter divided only by side heads has those as its topics. A heading standing at the top of a chapter before any of its text, such as a byline or "Part One.", divides nothing and is never a topic.
- **"Divided by subheadings" means at least half the chapters.** A book is given topic heads when at least half of its chapters have one or more subheadings inside their text. A preface or a chapter with no subheadings counts against it; a part title with no text of its own is not counted. Two of four chapters divided: topic heads. Two of five: author and chapter.
- **Chapters that only open with a list of topics are your question.** Some books print a summary under each chapter title, short phrases run together with dashes or full stops ("The Sacred Fire. The Vestal Virgins. The Altar. Fire as a Symbol."), and no subheadings in the text. The tools cannot know which pages each listed topic covers, so they never guess. When at least half the chapters open that way, the book keeps author and chapter heads and `proof` says, in a line headed `askOwner`, that the question is yours: keep author and chapter, or say where each listed topic begins so it can be set as a subheading (the book then gets topic heads). Checked on the shelf on 19 November 2026: no book there opens its chapters with such lists as read.
- **A long heading never runs into the margin.** A topic too wide for the page is shortened the way a long chapter title already is: the part after a colon goes first, then a leading "The", then whole words from the end, with "…" to show the cut. In a book with topic heads, every head that had to be shortened is listed in the proof report (`headsShortened`, with its pages) and in the warnings, so you can give it a short form.
- **Your own choice always wins.** A book with design answers of its own keeps its heads. In the design questions, the right page now offers "Current topic (the subheading in force on the page)", and the first design question offers "Chapter and topic".

What does not change:

- **Your published books.** Every one of them names its own heads, none of them the topic, so every page lays out exactly as before. Checked on 19 November 2026 by laying out 44 looks (the shipped ones and their variants, every shelf book's own design, the house look and the interview's answers) on two made-up books, and the 15 shelf books with a design of their own from their own text, each with the test measurer and with the real fonts, on `main` and on this branch: 206 laid-out books, every one byte for byte the same, warnings included.
- **The house look file.** It needs no change. A file may set its own rule (`topicHeads`, below), or turn it off with `null`.

## Done when (how we'll know it works; how the owner can try it)

- Tests show: the chapter title before the first topic; the first topic starting on a page; the topic carried to a page where none starts; two topics on one page (the head names the first, the next page the second); the reset at a new chapter; a byline before the text not taken as a topic; side heads as topics only in a chapter nothing larger divides; the chapter on the left and the topic on the right; a long topic shortened at a word, kept inside the text block, and reported once with its pages; a book without topic heads reporting nothing new.
- Tests show the half-the-chapters rule at its boundary (two of four yes, two of five no), the house look giving chapter and topic heads to a descriptive book and author and chapter to another, the question raised for a book of topic lists, a book's own answers winning, and topic lists told apart from prose, dialogue, mottoes, bylines, scales and glossary entries.
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

`atLeast` is the share of chapters (with text) that must be divided by subheadings, above 0 and at most 1. `design` is laid over the house look's answers for a descriptive book. `null` gives every book the house look's own heads. The inherited answers `proof` reports (`inherited`) include the heads, so a book that keeps them keeps its heads.

## Modules touched

- `src/core/model/types.ts`: the running-head mode `topic`.
- `src/core/assemble/divisions.ts` (new): what divides each chapter (`chapterDivisions`), the topics' headings (`topicHeadingIds`), the counts, the half rule (`isDescriptive`, `DESCRIPTIVE_SHARE`), the topic-list shape (`looksLikeTopicList`) and the question rule (`opensWithTopicLists`). It reads the chapters `deriveChapters` makes and never re-derives them.
- `src/core/layout/topic-heads.ts` (new): the rule for a page (`topicHead`, `topicsOnNewPage`, `topicsAfterHeading`) and the record of shortened heads. `paginate.ts` calls it in four places and reuses `fitRunningHead`.
- `src/core/layout/types.ts`: `headsShortened`, present only in a book with topic heads.
- `src/core/style/house-look.ts`, `src/core/style/house-heads.ts` (new): the `topicHeads` rule, read and applied (`houseHeadsFor`), and the line saying which heads a book got.
- `src/core/style/editable.ts`, `profile.ts`, `src/core/design/design-interview.ts`, `src/core/wizard/steps.ts`: the topic offered for the right page; "Chapter and topic" in the interview.
- `src/platform/browser/house-look.ts`, `interior.ts`, `src/app/house-look.ts`: the heads laid in when a book inherits the house look, and the question handed on.
- `scripts/drive.mjs`: `proof` reports `askOwner` and `headsShortened`.
- Tests (`test/topic-heads.test.ts`, `test/divisions.test.ts`, `test/house-heads.test.ts`, `test/house-look-wired.test.ts`), `docs/process/export.md`, `docs/reference/commands.md`, the house look spec and the folder guides.

## Rules/decisions that apply

- Published books must not reflow or change: topic heads are a mode no published book names, and nothing about them runs unless a head shows the topic. That is why a shortened chapter title in a book without topic heads is still not reported: reporting it would change those books' laid-out result.
- `src/core/CLAUDE.md`: chapters come only from `deriveChapters`; the rules are pure core, tested.
- `src/core/layout/CLAUDE.md`: furniture never spills into the margins; every fallback is said in the warnings.
- `scripts/CLAUDE.md`: `drive.mjs` and `paginate.ts` must not grow needlessly; new logic in new files.
- The owner rules on every editorial question: a book of topic lists is his question, never the tools' guess.
- This repository is public: tests and the spec use made-up text only.

## Out of scope

- A place to keep a short form for a long running head. Until there is one, a shortened head is reported and the owner's short form is a question for the book.
- Topic heads in a book whose chapters only list their topics: the owner decides per book.
- Reporting shortened heads in books without topic heads (it would change published books' laid-out result).
