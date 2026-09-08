# Reading a book aloud

`pronunciations.json` is the list of words this shelf uses that an English
phonemizer gets wrong. Each entry carries four things: the word as the book
prints it, a **lower-case respelling** to give the voice instead, the phonemes
that respelling produced when it was approved by ear, and a plain-English note
saying what it is supposed to sound like.

## Why lower case, and why hyphens

Both were measured rather than chosen. A capitalised syllable is sometimes
spelled out as letters and sometimes not, unpredictably — `Bla-VAT-skee` came
back as _"blah-vee-ay-tee-skee"_ and `Pan-cha-DAH-see` as
_"pan-cha-dee-ay-aitch-see"_, while `SID-eez` and `SHOCK-uh` were fine. It is
not a rule anyone can learn, so the convention everybody knows — capitals for
the stressed syllable — is the one thing a respelling here must not use.

A hyphen forces a stress, and is safe in lower case: `clairawdience` is read
wrong and `clair-awdience` is read right.

## Why every entry records its phonemes

`acarshick` does not say on its face that it means _uh-KAH-shik_. It was chosen
because it measured that way. A new phonemizer version, a different dialect or a
typo would each change what it produces — silently, into a book somebody then
listens to for six hours. So `expect` is what it produced when it was approved,
and `node scripts/say.mjs --check` reports when it no longer does.

Nothing here verifies itself. The check is a separate pass over the same file,
which is the arrangement every other gate in this repository uses.

## Adding one

Measure first. `node scripts/say.mjs --phonemes "candidate"` prints what a
spelling produces without synthesising anything, so a respelling can be hunted
down in seconds rather than by waiting on a render. Then have it read aloud and
judge it by ear: the phonemes say what it will do, never whether that is right.

## What is deliberately not here

Chapter numbers. `LESSON VIII` is read as _"lesson roman eight"_ and `LESSON I`
as _"lesson eye"_, but neither is a pronunciation problem — they are a rule, and
rules live in `src/core/speech` where they can be tested. This file is only for
words no rule will ever get right.
