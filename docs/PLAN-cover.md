# The cover arm

> Status: **built and working.** The geometry, the composer, the writer, the
> studio and the four ways to get a picture are all in. What is left is listed
> at the bottom, and the first item needs the KDP template files.

## Why this exists at all

[`SPEC.md`](../SPEC.md) §1 listed book covers as a non-goal — "handled
externally by the user" — with one carve-out: _the tool must report final page
count, which the user needs for spine-width math._

That carve-out is the whole argument for reversing the decision. The page count
is the spine, the app is the only thing that knows it, and the old answer was to
print the number on a screen and send the user to another program with it in
their head. Everything else a cover needs, this app already has: a trim size, a
title and author read off the original title page, an imprint, plates cut out of
the scan at render resolution, an ornament library in vector, six embeddable
book faces, a text measurer that agrees with the PDF writer by construction, and
a DPI rule it applies without flinching.

The cover was never out of scope because it was hard. It was out of scope
because covers are _made_ rather than _recovered_, and the rest of the app is a
recovery machine. That is a real difference and it shapes what follows.

## Two levels, again

SPEC §7 splits the interior into a **saved style profile** (the look, banked and
reused) and **per-book config** (this book's facts, never reused). The cover
takes the same split, and here it is not a convenience — it is the product.

A reader recognises that six books belong together by looking at their spines on
a shelf. That recognition is the mechanism by which a small press becomes a
thing people collect, and it is made of an arrangement, a palette, a face and an
ornament repeated across volumes. So:

- **`CoverLook`** — arrangement, palette, faces, title case, rule, ornament,
  whether the spine carries text. Banked. `BANKED_COVER_KEYS` is checked against
  `CoverLook` in the tests, so a field added to the look fails the suite until
  someone has decided which side of the line it is on.
- **`CoverContent`** — title, subtitle, author, series, blurb, imprint, and the
  picture. Never banked.

The **series name is content, not look**, which is worth stating because it is
the tempting mistake: the same look often covers more than one series (a press's
whole list), and a banked series name would print _Cornish Antiquaries_ on a
book about beekeeping.

This is what answers "some books will stay close to their originals and others
will not, and some will go out in collections". A collection is a banked look. A
facsimile-ish reprint is `plate-window` with the book's own frontispiece in it.
A book on its own is neither, and costs one pass through the interview.

## Arrangements, not a canvas

The front cover is one of five arrangements — `classic-centered`,
`plate-window`, `banded`, `full-bleed`, `typographic` — with the sizes derived
from the trim rather than typed in.

A drag-and-drop canvas was the obvious alternative and is worse for exactly the
thing this arm is for. Free placement makes volume two a fresh act of design and
makes "the same as last time" a matter of remembering; an arrangement applied to
a 5×8 and a 7×10 is _the same look_ rather than the same numbers. It also keeps
the composer a pure function, which is what lets the preview be the PDF.

`typographic` is a first-class answer, not a fallback. A great many
public-domain reprints have no picture in them and want type, a rule and a
fleuron — and an arrangement that wants a picture and is given none falls back
to it and _says so_ in the report.

## The geometry is computed, and the templates are the witness

KDP publishes the arithmetic: the spine is the page count times the caliper of
one page, the bleed is an eighth of an inch on every outside edge, and the flat
sheet is two trims plus the spine plus the bleed. Their downloadable template
for a given trim and page count is a _picture of that arithmetic_.

Reading the picture instead of doing the sum buys nothing and costs two things:
a page count with no template on hand cannot be covered at all, and a book whose
count changes by one page — which happens every time a note is added — needs a
new download before it can be re-exported.

So `coverGeometry` computes, and the templates are kept as **evidence**:
`test/cover-geometry.test.ts` carries a `KDP_TEMPLATE_FIXTURES` table, and every
row measured out of a real template file is an independent witness against the
caliper constants. That is the same bargain the app strikes with OCR — a witness
with no shared blind spots, not a source to copy from.

**The table currently holds one row**, KDP's own published worked example (200
pages of cream at 0.5 in of spine, which pins the cream caliper exactly), plus
structural assertions about how the panels relate. _Measuring the repository's
own KDP templates into that table is the first thing left to do._ Until then the
three other calipers rest on KDP's published multipliers and nothing else.

One number in the module is not arithmetic and is treated differently: where KDP
prints the barcode. Getting that wrong would put a title under a black
rectangle, so it is a **keep-out region the module reports** and never a place
anything is drawn — the composer avoids it, the validator warns when something
lands in it, and being wrong about it costs a warning rather than a print run.

## Where the picture comes from

Four doors, and the app ranks none of them:

| Door          | What it is                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Plate**     | An illustration already cut out of this book's scan at render DPI, retouchable with the interior's own op stack. |
| **Upload**    | Anything the editor has the right to print — including art from the original edition.                            |
| **Generated** | A Replicate model, opt-in, with the brief assembled rather than typed.                                           |
| **None**      | `typographic`. Often the right answer.                                                                           |

### The resolution problem, which is most of the honesty here

This codebase has one rule about pixels: **never invent resolution.** It was
written for scans. Generated art walks into the same wall from the other side,
and it is easy to miss because the output looks immaculate on a laptop.

A 6×9 front cover at KDP's 300 DPI is 1800 × 2700 pixels — 4.9 megapixels. Most
image models return about one, which across that front is **136 DPI**: soft in
print, and the softness reads to a browsing reader as exactly the cheapness a
careful reprint is trying to avoid.

So the studio computes the required pixels from the arrangement's own frame
_before_ anything is generated (`artFrame` → `requiredPixels` →
`checkResolution`), says the answer in DPI rather than megapixels, and names
which suggested models can and cannot reach it. Upscaling is offered and
labelled for what it is: invented detail, tolerable on a wash and dishonest on
an engraving, where the invented detail is lines that were never drawn.

### The brief

Generated art on a book is a claim a reader can hold against you, and the
failure mode is specific: a cover that looks machine-made makes a reader doubt
the text inside is a faithful reprint. So the briefs steer toward what
generation is good at and what a period reprint can honestly use — a ground, a
texture, a device — and away from what invites the doubt. Every brief forbids
lettering, first for a practical reason: the cover's type is set by the
composer, in an embedded face, at a measured size, and a model's idea of
lettering underneath it is a second, misspelled title.

A pictorial brief is still offered, because sometimes it is right and the user
is an adult. It just says what it is.

The brief is **assembled from parts, not typed free-hand**, which is what makes
two books in a collection get the same brief with different subjects — the thing
a remembered prompt in somebody's notes never does.

Provenance is recorded for every picture, always, and
`describeProvenance` turns it into a credit line. That costs a few hundred bytes
and makes the credit a fact rather than a memory.

### Replicate from a browser

Unknown, on purpose. Whether `api.replicate.com` answers a page with no server
behind it is a fact about their CORS policy that can change in either direction,
so `platform/browser/replicate` **probes it once per session** and the studio
withdraws the offer when the answer is no — the same treatment
`batch-reach.ts` gives the Anthropic Batches API, and for the same reason: an
option that fails on the first click with a sentence about cross-origin policy
is worse than no option.

When it is refused, nothing else about the arm is diminished: make the picture
wherever you normally would and choose "a picture of your own".

The token lives beside the API key and the shelf token, under the same rules —
never in a book file, never logged, never across the control channel.

## What is checked, and how hard

`validateCover` mirrors the interior's KDP report, with one difference: three
checks are `fail` rather than `warn`, because a cover fails visibly and
terminally. An interior with a tight gutter is a book someone can still read; a
title trimmed in half is pulped.

| Check                       | Level when wrong                        |
| --------------------------- | --------------------------------------- |
| Spine from a measured count | `pending` until the interior is typeset |
| Page count for the paper    | `fail` (`pending` when unanswered)      |
| Bleed painted to every edge | `fail`                                  |
| Type inside the safe area   | `fail`                                  |
| Barcode area clear          | `warn` — KDP prints over it regardless  |
| Art DPI at placed size      | `warn`                                  |
| Spine text                  | `warn`                                  |
| Embedded fonts              | `fail`                                  |
| File size under 40 MB       | `fail`                                  |

An **unanswered** page count is `pending`, not `fail`. Opening the studio to a
red failure for not having typed anything yet teaches people to ignore the
colour, which is the one thing these checks cannot afford.

## What is left

1. **Measure the KDP templates into `KDP_TEMPLATE_FIXTURES`.** One row per
   template file: trim, page count, paper, and the flat sheet's own dimensions.
   Three of the four paper calipers currently rest on KDP's published numbers
   with no independent check, and the barcode's exact offset within the back
   panel wants confirming against a template rather than against their prose.
2. **A physical proof.** SPEC §10's rule applies here more than anywhere: no
   digital check substitutes for one printed copy, and the spine is the thing to
   look at.
3. **Retouching cover art in the studio** — deliberately _not_ done, and here is
   the reasoning, because the obvious reading of the gap is wrong.

   `ImageEditor` exists and is wired to the interior's illustrations. The studio
   does not open it on a cover picture, and mostly does not need to: the handoff
   sends `drawableImageBytes()`, which is the **retouched** bytes, with the
   post-op dimensions to match. A plate straightened and levelled inside the
   book arrives on the cover already straightened and levelled. Uploaded and
   generated art was prepared before it got here by definition.

   What is left is the case where the cover wants a _different_ treatment from
   the same picture — a tight detail crop of the frontispiece, pushed harder in
   contrast, while the plate inside the book stays whole and gentle. That is a
   real want and a narrow one, and the escape hatch is to crop the file before
   uploading it. It is also once per book rather than once per leaf, which is
   what makes the friction tolerable here and intolerable at the proof step.

   `CoverArt.ops` stays in the model regardless. It costs nothing, `sizeAfterOps`
   already consults it so the DPI check divides by the right number, and it
   means wiring the editor in later is a UI job with no change to the document,
   the writer or the store.

4. **Interior art.** The reason the art module is `@core/cover/art` and not
   `@core/cover/replicate-prompt`: nothing in the brief-building, the resolution
   arithmetic or the provenance record is about covers. A chapter-opener or an
   endpaper is the same three questions with a different frame, and the frame is
   already a parameter. What it would need is a decision about where such a
   picture enters the book — an `Illustration` with `origin: 'supplied'` is
   already the shape for it.
5. **Cover looks on the shelf.** Banked looks live in IndexedDB, which is one
   browser on one device. `src/core/sync` already writes books to a git
   repository; a collection's look belongs there too, or book two on a new
   laptop starts from the shipped defaults.
