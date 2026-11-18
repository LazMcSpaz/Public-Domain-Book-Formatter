# Public-Domain Book Formatter

The workshop that turns public-domain occult and esoteric books into Libri Vetus editions for Amazon KDP: a browser app plus the scripts Claude sessions run. Full product description: [docs/product.md](docs/product.md)

## Who you're working with

The owner is not a programmer. He decides the product and rules on every editorial question; you make the technical choices and explain them in plain English. Never ask him a technical question. Show progress as something he can see or try: a page, a PDF, a check result. Most book work now happens in chat sessions like this one; the app is the engine you drive and a viewer on his devices.

## Stack

TypeScript, React and Vite, all in the browser; Node scripts drive it headlessly through `scripts/drive.mjs`.

- **Run:** `npm run dev`
- **Test:** `npm test`, plus `npm run typecheck`, `npm run lint` and `npm run format:check`
- **Check:** `python3 harness/check.py`

## Map

See [docs/architecture.md](docs/architecture.md). Each module folder has its own CLAUDE.md: read it before working there.

- `src/core/`: all book logic, pure (no browser, no Node); where the tests aim.
- `src/core/layout/`: the layout engine: pages, line breaking, footnotes, contents, pictures.
- `src/platform/browser/`: everything that needs a browser: PDF reading and writing, OCR, fonts, the shelf connection.
- `src/app/`: the web app.
- `scripts/`: the commands sessions run; `scripts/reading-kit/` is the older reading pipeline, to be merged.
- `test/`: automated tests.
- `docs/`: product, architecture, decisions, process (one per book job), reference, specs, archive.

The books live in a separate private repository, the shelf (`Public-Domain-Books-Storage`), which has its own CLAUDE.md.

## Hard rules

- **Never tell the owner a book is checked or ready to upload** without the check results in front of him. Run every check for that stage on the exact files that go to KDP, and name anything that did not run as NOT CHECKED. `run.complete` means only that every leaf is read. The checks and the three words (read, checked, ready to upload) are in [docs/process/README.md](docs/process/README.md).
- **The shelf is the source of truth.** Browser storage is only a cache. Load a book from the shelf before touching it, never save a book you did not load this session, and push what you change before you stop.
- **At every stopping point, push, and fast-forward `main` in both repositories.** The deployed app and the shelf loader read `main` only. This rule is replaced by the merge-on-green workflow once cleanup task 8 lands.
- **This repository is public.** Book text, study-book details, KDP and ISBN details and the owner's personal details go in the shelf, never here.
- **Only use packages listed in `harness/rules.json`.** Adding one needs a decision record in [docs/decisions/](docs/decisions/README.md).
- **Respect the module boundaries** in docs/architecture.md; the check script enforces them.
- **Don't undo a decision** in docs/decisions/ without writing a new record.
- **Never run `python3 harness/check.py --write-baseline`** without the owner's approval. The baseline may only shrink.
- **Never add anything listed under "Never"** in docs/product.md.
- **Ignore `docs/archive/`.** It is history, not instructions.
- **Repo docs are the source of truth.** If an agent's own memory or notes disagree with them, follow the repo docs.

## How to build a feature

1. **Spec first:** copy [docs/specs/\_template.md](docs/specs/_template.md), fill it in, and confirm the plain-English summary with the owner.
2. **Direction check:** if the feature pushes towards something in product.md's Future directions, or something new, raise it with the owner first.
3. **Build in one pass,** following the spec and the folder rules.
4. **Check:** run `python3 harness/check.py` and the tests; fix until both pass. A test that passes with the fault put back is not a test: reintroduce the fault and watch it fail.
5. **Review:** a separate subagent that did not write the code reviews it against the spec and the rules.
6. **Owner tries it:** say exactly how, in plain English.
7. **Lessons:** turn anything learned into a check in `harness/rules.json` or a test if possible; otherwise add one line to the CLAUDE.md of the folder it applies to. Never add a general lessons or notes file. Delete rules that are no longer true.

## How book work is done

One process document per job, each naming the role that runs it: [docs/process/README.md](docs/process/README.md). A cold session starts with [docs/process/sessions.md](docs/process/sessions.md). Every command is in [docs/reference/commands.md](docs/reference/commands.md); which stages a book of a given shape goes through is in [docs/FLOW.md](docs/FLOW.md).

## Cleanup, checks and known issues

- **Cleanup plan:** [docs/cleanup-plan.md](docs/cleanup-plan.md). When asked to "clean up", take the top unfinished task, and mark tasks done in that file.
- **Still-works checklist:** [docs/still-works.md](docs/still-works.md). The owner runs it after any change that touches behaviour. Its Known issues section lists what was already broken.
- **Depended on by:** the shelf repository (the app reads and writes it) and the deployed app (built from `main` by `.github/workflows/deploy.yml`). Changes must not break either.

## Working files

These are live: sessions or the app write to them while working. Never archive or rename them except in a cleanup task that updates every instruction naming them.

- `docs/FLOW.md`: its route table is generated by `node scripts/shape.mjs --flow`, and a test compares it with the code.
- `docs/still-works.md`: update Known issues when the owner's run finds something broken.
- On the shelf: each book's `ledger.md`, `RULINGS.md`, `KDP-listings.md`, the generated sheets (`queries.md`, `rulings.md`, `proposals.md`, `review.md`, `corrections.md`) and `INVENTORY.md`.

## Docs index

- Product: [docs/product.md](docs/product.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Decisions: [docs/decisions/](docs/decisions/README.md)
- Process: [docs/process/](docs/process/README.md)
- Reference: [docs/reference/commands.md](docs/reference/commands.md)
- Specs: [docs/specs/\_template.md](docs/specs/_template.md)
- Cleanup: [docs/cleanup-plan.md](docs/cleanup-plan.md)
- Still works: [docs/still-works.md](docs/still-works.md)
