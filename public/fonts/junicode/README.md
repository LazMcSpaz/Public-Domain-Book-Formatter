# Junicode

Junicode is the one typeface this app offers that is **not** on npm — it is not a
Google font — so it is not installed by `npm install` and is not committed here.
It exists for enormous glyph coverage (long-s, archaic ligatures, and the rest of
what medieval and early-modern scholarship needs), which also makes it much
larger than the other six faces combined. So it loads **on demand**, only when a
user actually selects it, rather than with the rest.

Until it is present, choosing Junicode falls back to EB Garamond, and the app
says so rather than quietly showing a different typeface.

## Adding it

Download the **static** build (not the variable-font build) from the releases
page and drop two files in this directory:

    https://github.com/psb1558/Junicode-font/releases

    public/fonts/junicode/Junicode.ttf
    public/fonts/junicode/Junicode-Italic.ttf
    public/fonts/junicode/OFL.txt

`OFL.txt` must travel with the fonts: this repository is public, so shipping the
files is redistribution, and the Open Font License requires the licence text to
accompany them.

The release's own filenames vary between versions — rename them to the two names
above, which is what `src/platform/browser/fonts.ts` looks for.
