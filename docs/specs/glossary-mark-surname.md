# Spec: the glossary check accepts a circle on a family's surname

Approved by the owner on 20 November 2026.

## What it does (plain English, for the owner)

"The glossary check: it should accept a mark on a person's or family's surname, as our rules already say."

An entry that names a family, such as "Smithers family", is circled where the book first names one of them, on the surname: "Rev. J. Smithers°". The finish check (`drive.mjs finish`, readiness item C7) looked for the two words "Smithers family" together, did not find a circle on them, and reported "glossary mark missing". It now also looks for the surname alone, matched as a name, the same way it already does for a person's entry ("Smithers, John (1850-1920)"). It still looks for the whole phrase too, as before, because some terms have the same shape and are not families ("Elder Brothers"): a circle on either counts.

## Done when (how we'll know it works; how the owner can try it)

- An entry headed "<Surname> family" (and "<Surname> sisters" or "<Surname> brothers") counts as marked when a circle follows the surname anywhere in the prose.
- A circle after the whole phrase still counts, as it did before ("The Elder Brothers° of the race", "the Rose family°"), and the circle-placing script does not take it out as a stray.
- A circle on an unrelated word, or on the surname set in lower case as a common noun, or on the surname used as the first name of someone else ("Smithers Brown"), does not count.
- The circle-placing script (`scripts/glossary-circles.ts`) and the finish check agree: both read the entry through the same core rule, so the script places a missing circle where the book first names the family, on the surname (the whole phrase only where it alone comes first), and does not remove one already there as a stray.
- The tests in `test/glossary-family-marks.test.ts` fail with the old behaviour (and with the surname read alone, without the whole phrase) and pass with the new.
- The owner can try it by running `drive.mjs finish` on the book where the fault was seen: the "glossary mark missing" line for its family entry is gone.

## Modules touched

- `src/core/annotate/person-headword.ts` (new): which headwords name people or families, and their surname. Moved out of `marks.ts`, which would otherwise pass the 400-line limit. `isNameTerm` says which term of an entry is matched as a name: only the surname.
- `src/core/annotate/marks.ts`: a family entry is looked for by its whole phrase, then by its surname; the check, the placer and the stray-circle sweep ask `isNameTerm` for each term.
- `src/app/BookEditor.tsx`: the galley's "place the circle" asks `isNameTerm` the same way.
- `test/glossary-family-marks.test.ts` (new); `test/glossary-marks.test.ts` is unchanged in what it tests.
- `docs/process/glossary.md`, G7: one sentence naming families.

## Rules/decisions that apply

- `docs/process/glossary.md`, G7: "People are matched as names, by surname."
- `scripts/CLAUDE.md`: a script imports core rather than keeping its own copy, so the script and the check cannot disagree.

## Out of scope

- Person headwords written without a comma ("John Smithers"): the check cannot tell them from a two-word term such as "Astral Body", and the house style writes a person "Surname, Given (dates)".
- Any change to which occurrence takes the circle.
