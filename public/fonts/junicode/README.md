# Junicode

Junicode is the one typeface this app offers that is **not** on npm — it is not a
Google font — so it is not installed by `npm install`. It is committed here
instead. It exists for enormous glyph coverage (long-s, thorn, eth, yogh,
archaic ligatures, and 5,980 glyphs in all — the rest of what medieval and
early-modern scholarship needs), which also makes it larger than the other six
faces combined. So it loads **on demand**, only when a user actually selects it,
rather than with the rest.

Version 2.226, the static OTF build. `OFL.txt` is the licence these files are
under and must stay beside them: this repository is public, so committing the
binaries is redistribution, and the Open Font License requires its text to
accompany them. `test/fonts-junicode.test.ts` fails if it goes missing.

## Which files the app uses

Only two:

    Junicode-Regular.otf     body text
    Junicode-Italic.otf      epigraphs, captions, the odd emphasised phrase

`src/platform/browser/fonts.ts` looks for exactly those names. The other eight —
Bold, SemiBold, their italics, and the four Cond faces — are present but
**unused**, because the layout engine's `FontStyle` is `regular | italic` and
nothing in the design system asks for a weight. They are kept rather than
deleted so that a heading weight, if it is ever wanted, is a wiring job and not
another download.

Worth knowing before a deploy: everything in `public/` is copied verbatim into
`dist/`, so those eight faces are about 8 MB of dead weight in a build. They
cost nothing at runtime — no user ever fetches them — but if the bundle size
matters more than the option, deleting them is safe and breaks no test.

## These are CFF, not TrueType

The only faces in the app that are. pdf-lib therefore writes a `FontFile3`
rather than the `FontFile2` every other face takes — a different branch of the
embedder, exercised by nothing else here. It works, and the test suite holds it
to that end to end: embedded whole, reopened with pdf.js, long-s intact.

Two things not to do:

- **Do not swap in the variable-font build** to save space. It parses and
  embeds, but as whatever single instance the reader guesses, so the failure
  shows up on paper rather than in a test. There is a test for this.
- **Do not turn on `subset: true`** to make the files smaller. It corrupts the
  outlines of half the faces in this app; see `src/platform/browser/pdf-out.ts`
  for the evidence.

## Replacing or updating them

Download the **static** build (not the variable-font build) from the releases
page, and keep the two names above:

    https://github.com/psb1558/Junicode-font/releases

Release filenames vary between versions, so rename as needed — a renamed file is
a silent failure, since the fetch 404s, the app substitutes EB Garamond and says
so, and nobody reads the notice. `npm test` catches it instead.
