# 0049: Lines are broken by tex-linebreak with TeX's hyphenation patterns

Status: inherited · Date: 2026-11-18

## Decision

Paragraphs are broken into lines by the Knuth–Plass method from the `tex-linebreak` package, with Liang hyphenation patterns from `hyphenation.en-us` (the same patterns TeX uses), in `src/core/layout/break-lines.ts`. The app's own code turns prose into the boxes, spaces and break points the method consumes, and places the result.

## Why (plain English)

Knuth–Plass weighs a whole paragraph at once and picks the set of breaks with the least total badness, which is why TeX's pages look set rather than typed. Using a faithful implementation leaves the app to model the text rather than reinvent the method. Both packages are plain calculation over plain data, so they keep `src/core` pure (0002).

## What we gave up

TeX itself: the XeLaTeX path of SPEC.md is gone and no TeX runs in the browser. Simple word-by-word wrapping, which is easier and looks worse.

## Rule for agents

Build line breaking on these two packages; do not add a second line breaker. After any change to how a book breaks, read line starts out of an exported PDF and count lines that open on a closing mark or end on an opening one. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1225–1240, 2086–2095; src/core/layout/break-lines.ts (header comment); harness/sorting/part-4.md ("Packages in use").
