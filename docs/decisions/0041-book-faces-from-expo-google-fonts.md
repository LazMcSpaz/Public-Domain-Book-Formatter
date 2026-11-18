# 0041: Book faces come from @expo-google-fonts

Status: inherited · Date: 2026-11-18

## Decision

The six book faces (EB Garamond, Cardo, IM FELL English, Libre Baskerville, Libre Caslon Text, Crimson Pro) come as TTF files from the `@expo-google-fonts/*` packages, imported by URL in `src/platform/browser/fonts.ts`. All are open-licensed (OFL). Cardo is also the fallback face for Greek, Hebrew and letters a book's face lacks (`GLYPH_FALLBACK_FAMILY`).

## Why (plain English)

pdf-lib can embed TrueType and OpenType files but not the compressed web formats (WOFF, WOFF2) that `@fontsource/*` ships. Open licences mean a book set in these faces can legally be sold; system fonts generally cannot be embedded in a book for sale.

## What we gave up

`@fontsource` packages and system fonts. IM FELL English has no bold, so its bold runs print in italic rather than in a faked bold.

## Rule for agents

Add a book face from `@expo-google-fonts/*`, or vendor a TTF or OTF by hand with its licence; never from `@fontsource`, and only open-licensed faces. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2040–2041, 2541–2560; src/platform/browser/fonts.ts (header); harness/sorting/part-4.md ("Packages in use").
