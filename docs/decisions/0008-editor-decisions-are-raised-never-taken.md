# 0008: A decision that is the editor's is raised, never taken

Status: inherited · Date: 2026-11-18

## Decision

Where the decision belongs to the editor (a printer's error, a place the book contradicts itself, a passage where "faithful to the original" and "correct" pull apart), the text is transcribed as printed and a `query` is attached to the leaf (`src/core/queries`). The owner rules on it at the query gate, and rulings are kept with their date in `rulings.md`. An `EditorialQuery` has no field for a proposed fix, and `parsePageTranscription` refuses fields it does not know, so a query cannot be dropped with a green report beside it.

## Why (plain English)

These are editorial judgements, and the editor owns them. A single suggestion placed where the answer goes is an answer in all but name, and it tends to be accepted without being weighed. But the editor's time matters too: most "undecidable" snippets settle themselves once the whole paragraph is read, so only a finding the context cannot settle is truly his.

## What we gave up

Autonomy: a session cannot finish a book alone, and some books wait for rulings. The same rule runs in reverse for memos (notes from the editor to the assistant): a memo asking for prose is answered with a proposal, never a landed edit.

## Rule for agents

Never silently correct and never silently keep. Before raising anything, read the whole block, the block before and the block after, and look for the same word elsewhere in the chapter; raise what is left with the paragraph attached. Never add a proposed-fix field to a query: offer answers only as proposals (0009). Read `rulings.md` before raising something already settled. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 684–706, 1771–1778, 2620–2680; docs/HANDOFF.md §4; docs/PROCESS-reading.md ("Editorial queries").
