# docs/

The project's written knowledge, in layers: what the product is, how each book job is done, why things are the way they are, and lookups. Superseded documents are in `archive/` (history, never instructions). A few older `PLAN-*` and `LEDGER-*` files stay at the top of `docs/` only because code comments cite their paths; each opens with a line saying so, and cleanup task 13 moves them. `BRIEF-reading.md` and `briefs/` are live: the reading scripts hand them to readers.

## May use

- Markdown, with relative links that resolve (`harness/check.py` checks every link) and code paths in backticks.

## Must not

- Hold book text, study-book details, KDP or ISBN details, or the owner's personal details: this repository is public, and they belong on the shelf.
- Treat anything in `archive/` as an instruction, or link to it from a rule.

## Key files

- [product.md](product.md): what the product is and who it is for, approved by the owner.
- [still-works.md](still-works.md): the owner's checklist, run before and after any change in behaviour.
- `architecture.md`: the folder map, who may use whom, and where each folder is heading.
- `decisions/`: one file per settled decision, with its reason.
- `process/`: one document per book job, indexed by [process/README.md](process/README.md).
- `reference/`: lookups, such as [reference/commands.md](reference/commands.md).
- `specs/`: one spec per planned change, started from [specs/\_template.md](specs/_template.md).
- [cleanup-plan.md](cleanup-plan.md): the numbered tasks that move the project to its target; take the top unfinished one.
- `archive/`: history, kept for its reasons; never instructions.
- [FLOW.md](FLOW.md): which stages a book of each shape gets.

## Folder-specific rules and lessons

- `FLOW.md`'s route table is pinned by `test/provenance.test.ts`: regenerate it with `node scripts/shape.mjs --flow`, never by hand. Moving the file means changing the path in that test and in `scripts/shape.mjs`.
- `architecture.md` must replace `ARCHITECTURE.md` in the same commit (the old one to `archive/`): Windows treats the two names as one file.
- A rule a test enforces is named with its test here, not restated; the test is the rule.
- Write for the owner, who is not a programmer: plain English, short sentences, no long dashes.
- A new document goes in the layer it belongs to; nothing new at the top of `docs/` except the files named above.
