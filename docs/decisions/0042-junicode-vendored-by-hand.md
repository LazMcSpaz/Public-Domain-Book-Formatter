# 0042: Junicode is vendored by hand

Status: inherited · Date: 2026-11-18

## Decision

The Junicode face is kept in `public/fonts/junicode/` with its OFL licence and a README, and loaded only when a book asks for it. If it is missing, EB Garamond is used in its place and the app says so (`FALLBACK_FAMILY` in `src/platform/browser/fonts.ts`).

## Why (plain English)

Junicode is not on npm, being not a Google font, and it is wanted for its very wide range of characters (long s, thorn, eth, yogh and thousands more). It is the only face here with CFF outlines, a different path through pdf-lib that `test/fonts-junicode.test.ts` holds to working.

## What we gave up

Installing and updating it through npm. Its variable-font build is not used: one file per style is what fontkit and pdf-lib expect.

## Rule for agents

Keep the files, the licence and the README together. Keep the EB Garamond fallback. Do not swap in the variable-font build. Code note: the folder's README says only Regular and Italic are used, but `fonts.ts` also loads Bold; the README is out of date, and seven other files in the folder (Bold Italic, SemiBold, the Cond faces and their italics) are loaded by nothing, a cleanup candidate. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2049–2051, 2140–2142; src/platform/browser/fonts.ts; harness/sorting/part-7.md, contradiction 9.
