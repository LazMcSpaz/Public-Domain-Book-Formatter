# 0009: Proposals are an unselected menu

Status: inherited · Date: 2026-11-18

## Decision

The reader's likely answers to a query are offered at the query gate as a short menu of complete alternatives, none selected, above the three plain decisions (always offered) and a box for the editor's own wording. They are stored apart from queries and rulings (`run.proposals`, `src/core/queries/proposals.ts`) and written by `drive.mjs propose`. A proposal is a different type from a `Ruling`, so only the editor choosing one files anything, and the filed ruling records that it came from a proposal and whose. Every query goes up with proposals (the editor's instruction of 5 October 2026).

## Why (plain English)

The reader usually has a sense of the right answer and is thinking about it anyway, so taking it should cost the editor a tap rather than a paragraph of dictation. A menu with nothing chosen is how every other question in the app is asked, and it keeps the decision with the editor. An option that arrived already chosen would be filed on the next press of Next with nobody having looked.

## What we gave up

The simpler design of one pre-filled suggestion (rejected, see 0008). Some extra care: each proposal must state in full what choosing it would file, and `parseProposals` is stricter than the rulings parser, because a broken proposal puts a button on screen that does nothing.

## Rule for agents

Never make a proposal a `defaultValue` or a `held` value. Always keep the three plain decisions and the free box. Write proposals from evidence (the crop, a second printing, the book's own usage) before pushing the queries; `drive.mjs queries` names any query without one. `npm run check:proposals` checks in a real page that nothing is selected. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1780–1798, 3208–3252.
