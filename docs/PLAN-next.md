# Plan: what is left

Status: **Tiers 1 and 2 built; Tier 3 remains.** Written after
[`PLAN-layout-preview.md`](./PLAN-layout-preview.md) closed — every step in that
document is now built, verified in Chromium, and on `main`.

The app can take a scan to a finished KDP interior. What follows is not the rest
of a half-built pipeline; it is the difference between _one_ book and a
_series_, plus three typographic debts that are already written down in the code
as apologies.

## How this was scoped

Everything below is either (a) a promise in [`SPEC.md`](../SPEC.md) that the
browser app has not kept, (b) a comment in the source that admits a
substitution, or (c) something I know is untested because no book-sized run has
happened. Nothing is invented to fill the list. Where the spec asks for
something I think should stay unbuilt, it is in "Deliberately not doing" at the
end with the reason.

---

## Tier 1 — the series problem — **built**

This was the biggest real gap, and the one the user hit on book two. All three
items below are done and verified in Chromium across two books. What building
it changed is recorded at the end of each.

### 1. Saved style profiles (SPEC §7) — done

Today the design gate interviews the user, produces a `StyleProfile`, and throws
it away when the tab closes. Book two starts from the shipped defaults and gets
re-interviewed from scratch. SPEC §7 is explicit that the reusable _look_ —
trim, margins, body face, heading treatment, running heads, folio style,
ornaments — is banked once and applied across a series, and that setup time
should drop sharply after the first volume.

**Shape.** A second IndexedDB store beside `runs`, holding named profiles.
`src/platform/browser/run-store.ts` already owns the database; this is a second
object store and a `DB_VERSION` bump, not a second storage layer.

**Where it appears in the flow.** Not as a settings screen — as a question, per
the house rule. At the top of the design gate, _if_ any profile is banked:

> "Use a look you have already set up?" · [The Blackthorn Press look] · [Start
> fresh]

and at the design gate's accept, one more:

> "Save this look to reuse on the next book?" · name field, prefilled from the
> imprint.

**The part that needed care.** A profile must hold only what is content-free.
SPEC §7's "two-level separation" is the test — if reusing it on an unrelated
book would be wrong, it is per-book config and must not be banked.

**This turned out better than the paragraph above assumed.** `StyleProfile` did
_not_ mix the two levels: every one of its fourteen fields is already a fact
about the look, so there was no split to make. The risk is not the current
shape but the next person's addition to it, so the guard is
`BANKED_STYLE_KEYS` — a list checked against `StyleProfile`'s own keys, which
fails the moment a field is added without deciding which level it belongs to.
A convention would not have caught it; a test does.

One more thing the build changed: a banked look is applied **as banked**, never
rebuilt from the five answers. A profile hand-tweaked in a later session holds
settings no answer can express, and regenerating would silently flatten them.

### 2. Front-matter templates that carry across books (SPEC §7) — done

The imprint name and the copyright holder were retyped every book at the export
gate, though they are the same for every volume an imprint publishes. They now
ride on the banked look.

**The edition statement did _not_ come along**, contrary to the sentence this
paragraph used to end with. It names the original's year, so it is per-title;
the ISBN is per-title and the publication date is per-printing. Banking any of
the three would have been silently wrong on book two — the exact failure the
feature exists to prevent.

One ordering wrinkle: the look is named at the design gate, but the publisher's
details are asked one gate later. So the profile is written at the design gate
with the style alone and topped up when the export runs — and the export screen
says so, because changing saved state without telling anyone is how a user finds
out on book three that something has been following them around.

### 3. Delete the dead scaffolding — done

The type was `ProjectFile`, not `ProjectState` — this plan had the name wrong.
It and everything reachable only from it came to 141 lines, referenced by
**nothing**: the Electron-era project-file shape, left behind when the browser
app was built in a different order. `HeadingCandidate` and `TocEntry` even
documented themselves in terms of `ProjectFile.markdown`, a field of the type
they would have outlived. `styleProfileId` would have actively misled whoever
built (1), which is why this went first.

---

## Tier 2 — the three typographic debts — **built**

All three are done, and the shape of the problem turned out to be different
from what this section assumed. It is recorded here because the wrong diagnosis
survived two rounds of being written down as a comment.

### 4 + 5. Small capitals and ligatures — done, and they were one bug

This section predicted the two were one investigation. They were — but not the
one described. The plan said the job was "a glyph-level draw path beside
`drawText`", and that pdf-lib could not write glyph ids. It already does:
`CustomFontEmbedder` encodes Identity-H with `CIDToGIDMap` Identity and writes
glyph ids in `encodeText`.

The defect was one list. pdf-lib builds the glyph set for **both** the `/W`
width array and the `ToUnicode` map by walking the font's character set:

```js
for (cp of font.characterSet) glyphs.push(font.glyphForCodePoint(cp))
```

A glyph no code point reaches — a ligature, a contextual alternate, a small
capital — is in neither. Missing from `/W` it prints as a full em of white
space; missing from `ToUnicode` the page copies out as line noise.

`src/platform/browser/font-widths.ts` widens the list to the glyphs the book
actually uses, and `renderPdf` verifies afterwards rather than hoping — an
uncovered glyph raises instead of being handed to someone about to sell a book.
With widths written, both debts cleared at once:

- **Ligatures** are back on, along with contextual alternates. `dlig` and
  `hlig` stay off as typography rather than workaround; see `fonts.ts`.
- **Small capitals** need no glyph-level path at all. pdf-lib applies features
  per *embedded font*, so a small-caps run is the same bytes embedded again
  with `smcp` on — the same cost as an italic.

Two things this section got right and they held: never synthesise small
capitals by scaling, and measure with the engine that draws. The second caught
two real bugs during the wiring, both silent — a cache key that ignored the
small-caps variant, and a contents title measured in one face and drawn in
another.

One fact the plan did not have: **only three of the seven faces carry `smcp`**
— EB Garamond, Cardo and Junicode. IM FELL English, which the interview
recommends for the 17th century, has none, while the interview asks for
small-capped headings on every period but modern. A face without them gets full
capitals, and the typeface question now says which is which, so the choice is
made with the fact in view.

An unlooked-for gain: because `smcp` is applied to the text as written rather
than to an upper-cased copy, a heading now extracts as "Of the Air" instead of
"OF THE AIR". That is what a screen reader says aloud and what a search
matches.

### 6. Junicode, vendored — done

Version 2.226, static OTF, with `OFL.txt` beside it — this repository is
public, so committing the binaries is redistribution and the licence has to
travel with them. A test fails if it goes missing.

Two things worth carrying forward. These are the only **CFF** outlines in the
app, so pdf-lib writes a `FontFile3` rather than the `FontFile2` every other
face takes — a branch nothing else exercises, now covered end to end. And
Junicode is what exposed the `calt` half of the width bug: it substitutes
contextual f-alternates that no code point reaches, which is not a ligature
feature and so slipped past two comments about ligatures.

The eight unused faces (Bold, SemiBold, their italics, four Cond) are kept
and documented as unused — `FontStyle` is `regular | italic` and nothing asks
for a weight. They are ~8 MB of dead weight in `dist/`; deleting them is safe
and breaks no test.

---

## Tier 3 — proving it at scale

### 7. A real book, end to end, against the live API

The vision pass has been exercised against the live API **once**, and never at
book length. Everything else is verified by 572 tests and a headless Chromium
run over an 8-page fixture. That is a good suite and it is not the same claim.

What a full run would actually test, that the fixture cannot:

- **Memory over hundreds of pages.** The render-consume-release discipline is
  correct by construction, but "no canvas is retained" is a property no test
  currently asserts. A 300-page book at 300 DPI is ~5.8 GB if the discipline
  slips anywhere.
- **Cost, measured rather than estimated.** The estimate is shown before the
  user approves the spend. Nobody has compared it to a real invoice.
- **Resume under real conditions** — a refresh 180 pages into a paid run.
- **Whether the flag tiers are calibrated.** How many pages does Gate 2 actually
  surface out of 300? If it is 40% the gate is noise; if it is 2 pages the
  cross-checks are too quiet. This number cannot be guessed and it decides
  whether the proof step is a pass or a spot-check.

I would do this **before** Tier 2, because it is the only item here that can
change the plan. The others are known quantities.

### 8. The physical proof loop

SPEC §10 is blunt that no digital check replaces one printed copy — gutter
swallow, light faces at print size and muddy images only show on paper. This is
the user's task, not the code's, but it belongs on the list because it is the
last gate before a book is actually for sale.

**The differentiation requirement, from KDP's own policy.** A public-domain
title that is already free in the store may only be published in a
_differentiated_ version: an original translation, original annotations, or ten
or more original illustrations — with `(Translated)`, `(Annotated)` or
`(Illustrated)` in the title field and a bulleted summary of the originality at
the top of the product description. A linked table of contents, formatting
improvements and collections are named as _not_ differentiating.

This bears directly on what the app already does. The editor's own notes and
authored front/back-matter sections (`src/core/edits`) are what makes an edition
_annotated_; the layout engine, the TOC and the typography are explicitly not
enough on their own. Illustrations cut from the scan are the original's, not
original work, so they do not count toward the ten — only pictures the editor
supplies would. Nothing in the app currently says any of this at the export
gate, which is a gap worth closing: the KDP report checks trim, gutter, fonts
and image DPI, and could equally count the editor's annotations and own
illustrations against the thresholds above.

---

## Deliberately not doing

Recorded so the next session does not re-litigate them.

- **Background removal** (SPEC §6). The one op of eleven left out of the image
  editor. The spec calls it best-effort and it is; without manual touch-up of
  the selection it is a magic button that quietly eats part of a picture. Ships
  only if the selection becomes editable, which is a much larger piece of UI
  than the op.
- **An index** (SPEC §7, already marked "optional/low-priority"). The original
  scanned index carries the original edition's pagination and is discarded on
  the same rule as the TOC. Generating a real one needs term selection, which is
  editorial work no heuristic does — and a bad index is worse than none.
- **Side-by-side hover-synced review panes** (SPEC §12 P2). The proof step does
  this job leaf by leaf with the scan beside the text. The coordinate map exists
  if it is ever wanted, but the flow no longer has a place for it.
- **Windows install wizard, Docker packaging** (SPEC §12 P4, "later"). Both were
  for the Electron design and there are no system binaries left to install.
- **A find-replace dictionary** (SPEC §12 #10). The lexicon gate already fixes
  a term book-wide from the evidence, which is the same outcome reached from the
  right direction — "answer once, apply everywhere" rather than a regex the user
  has to author blind.

---

## Suggested order

1. ~~**(3) dead scaffolding**, then **(1) saved profiles** and **(2) front-matter
   templates**~~ — done.
2. ~~**(6) Junicode**~~ — done.
3. ~~**(4 + 5) Small caps and ligatures**~~ — done, and the honest outcome was
   better than the "not with this embedder" this plan braced for.
4. **(7) A real book against the live API** — all that is left, and the only
   item that can still change the picture. It needs a key and real spend, so it
   is the user's to run.

Tier 1 was where the remaining _product_ was. Tier 2 was the _craft_. Tier 3 is
the only place a surprise is still likely to come from.
