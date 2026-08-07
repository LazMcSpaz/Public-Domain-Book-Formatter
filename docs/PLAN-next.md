# Plan: what is left

Status: **proposed, nothing built.** Written after
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

## Tier 1 — the series problem

This is the biggest real gap, and it is the one the user hits on book two.

### 1. Saved style profiles (SPEC §7)

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

**The part that needs care.** A profile must hold only what is content-free.
`StyleProfile` currently mixes the two: trim size and body face belong to the
imprint; anything derived from _this_ book's period or structure does not.
SPEC §7's "two-level separation" is the test — if reusing it on an unrelated
book would be wrong, it is per-book config and must not be banked. That split
has to be made in the type, not remembered by convention, or the third book
inherits the second book's date.

**Testable in core**: profile ↔ answers round-trip, and the content-free
assertion (bank a profile from book A, apply to book B, confirm nothing of A's
content survives).

### 2. Front-matter templates that carry across books (SPEC §7)

The copyright page, the imprint name, the edition statement and the editor's own
name are re-typed every book at the export gate. Everything except the ISBN and
the edition date is the same for every volume an imprint publishes. This rides
along with (1) — same store, same question — and is cheap once (1) exists.

### 3. Delete the dead scaffolding

`ProjectState` in `src/core/model/types.ts` — and with it `findReplace`,
`readingProgress`, `tags`, `imageEdits`, `styleProfileId`, `frontMatter` — is
referenced by **nothing**. It is the Electron-era project-file shape, left
behind when the browser app was built in a different order. It currently reads
like an implemented feature to anyone opening the file, and `styleProfileId`
in particular will actively mislead whoever builds (1).

Either delete it or reduce it to the fields (1) and (2) actually use. I would do
this _first_, in the same session as (1), so the new persistence is not written
next to a decoy of itself.

---

## Tier 2 — the three typographic debts

Each of these is a substitution the code already confesses to in a comment. They
are what stands between "a clean reprint" and "a book that looks like a real
edition" — which is what SPEC §8 says this layer exists for.

### 4. Real small capitals

`headingStyle.smallCaps` currently sets **ordinary capitals**. On a period book
that is the wrong texture — full caps in a running head are shouting where small
caps are speaking.

`PLAN-layout-preview.md` §"Small caps: not in v1, and never faked" settled the
rule and it stands: **never synthesise them by scaling capitals.** EB Garamond,
Cardo, IM FELL and Junicode all carry a real `smcp` feature; the job is to ask
fontkit to apply it and write the resulting **glyph ids** rather than a string.
That means a glyph-level draw path beside `drawText`, and it must go through the
same `TextMeasurer` that already sums `fontkit.layout()` advances — otherwise
the measure and the draw disagree and WYSIWYG breaks at exactly the place the
gate's approval is supposed to mean something.

Risk: this is the same territory as the ligature problem below (pdf-lib writes
no width for a glyph answering to no code point), so **do 4 and 5 together or
not at all** — they are one investigation.

### 5. Ligatures

Off, and `src/platform/browser/fonts.ts` explains why: pdf-lib's whole-font
embedder maps code points to glyphs, and a ligature glyph answers to no code
point, so it gets no width. The comment calls it "a deliberate, unhappy trade"
between "no fi ligature" and "broken words", and picks correctly.

The fix is the same glyph-id write path as (4). If that path lands, both debts
clear at once; if it proves impossible against pdf-lib's embedder, both stay,
and the comment stops being an apology and becomes a finding.

**Do not** attempt this by reviving `{ subset: true }`. That corrupts the
outlines of EB Garamond, Cardo and IM FELL, nothing in the suite catches it, and
it is already written down in `pdf-out.ts` as evidence.

### 6. Junicode, vendored

The design interview offers Junicode; the loader substitutes EB Garamond and
says so. Junicode is not on npm — it exists for enormous archaic glyph coverage
(long-s, and the rest of what SPEC §11 lists as the labor that actually fills
time), which is precisely what a 17th-century reprint needs. This is a
**download-and-commit task**, not an engineering one: fetch the release, put the
two faces in `public/fonts/junicode/`, check the licence, remove the
substitution notice.

Worth doing early because it is an hour of work and it unblocks the one font
choice a period book most wants.

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

**Also user-side, and I will not guess at it:** verify KDP's current terms for
public-domain works and what it requires of differentiated content. My
recollection of that policy is not a source; read it from Amazon.

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

1. **(6) Junicode** — an hour, unblocks a real font choice.
2. **(7) A real book against the live API** — the only item that can change what
   follows.
3. **(3) Delete the dead scaffolding**, then **(1) saved profiles** and
   **(2) front-matter templates** in one arc.
4. **(4 + 5) Small caps and ligatures** as a single investigation into a
   glyph-id write path — with a real possibility that the honest outcome is "not
   with this embedder", written down as a finding.

Tier 1 is where the remaining _product_ is. Tier 2 is where the remaining
_craft_ is. Tier 3 is the only place a surprise is likely to come from, which is
why it is second.
