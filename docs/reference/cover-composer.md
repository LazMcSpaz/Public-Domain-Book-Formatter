# The cover composer

How a cover is drawn: the spec a session writes, the command that draws it, and why the composer works the way it does. The command is `scripts/cover-front.mjs` ([commands.md](commands.md)); the screen is the app's `#cover` (the cover studio); the code is `src/core/cover/` with its browser half in `src/platform/browser/cover-*.ts`.

## Writing a cover spec

A spec is a JSON file kept with the book (`covers/softcover.json`, `covers/hardcover.json` on the shelf). It is a partial cover document, merged over the defaults:

- `trimSize` (`7x10`), `pageCount` (the exported interior's), `paper` (`bw-cream`, `bw-white`, `bw-groundwood`, `standard-color`, `premium-color`), `binding` (`paperback` or `hardcover`);
- `pageCountMeasured`: true only when the page count came off the exported interior;
- `look`: the arrangement, palette, faces, sizes, rules, frame and grounds (every field is in `src/core/cover/document-look.ts`, each with its reason);
- `content`: the title, subtitle, author, edition line, blurb, imprint, ISBN;
- `device` and `mark`: the emblem on the board and the printer's mark on the spine, files under `public/`;
- `widthPx`: how wide the picture comes out;
- `texture`: a book's own picture as the ground (below).

### A picture on the frame's rule

`look.groundFigureOnRule: true`, with `groundFigureInFrame: true` and a frame, sets a framed figure's box on the inner edge of the frame's inner rule, so the picture touches it. Off, the box stands `FRAME_CLEARANCE_IN` (0.14 in) inside the frame's outer edge, the clearance a line of type keeps.

### A texture from a file

The built-in figures are the press's vector traces in `public/devices/`. A book's own picture is never built in, since this repository is public: the spec names its file, and the command is given the folder it is in.

```json
"texture": {
  "file": "plate.png",
  "placement": "on-rule",
  "scale": 1,
  "align": { "x": 0, "y": 1 },
  "opacity": 0.06
}
```

- `file`: a PNG, JPEG or WebP, found in `--textures <folder>` or beside the spec.
- `placement`: `front` (off the front panel's three cut edges, the default), `framed` (inside the front frame), `on-rule` (on the frame's inner rule), `wrap` (across the whole sheet).
- `scale`: 1 covers the box exactly; up to 4 draws it larger, cropped at the box.
- `align`: where the picture sits when it overflows the box, 0 to 1 each way; `{ "x": 0, "y": 1 }` is its left edge and foot on the box's. Centred when left out.
- `opacity`: the tint, held between 0.03 and 0.2 like every ground figure; the look's `groundFigureOpacity` when left out.
- `toEdge`, `back`, `invert`: the look's `groundFigureToEdge`, `groundFigureBack` and `groundFigureInvert`, for this picture.

The texture is tinted in the look's figure colour, so the file is ink on white. To set a picture at a size and place of its own inside the box, prepare it on a canvas of the box with `scripts/cover-texture.py`, using the box size `cover-front.mjs` prints ("ground figure box"), and keep `scale` at 1. The texture is the book's, not the collection's: it is never banked with a look.

## How it was built (the plan, kept from the cover branch)

> Written on the branch the composer was built on. Where it and the code disagree, the code is right.

> Status: **built and working.** The geometry, the composer, the writer, the
> studio and the four ways to get a picture are all in. What is left is listed
> at the bottom, and the first item needs the KDP template files.

### Why this exists at all

[`SPEC.md`](../../SPEC.md) §1 listed book covers as a non-goal — "handled
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

### Two levels, again

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

### Arrangements, not a canvas

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

### The geometry is computed, and the templates are the witness

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

### Where the picture comes from

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

### What is checked, and how hard

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

### What is left

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

## Lessons from building it

> Kept from the cover branch's notes, in the order they were learned. The current rules are in `src/core/cover/CLAUDE.md`.

**And the back cover printed them too, in the one place the editor writes.**
The blurb is the only prose on a cover that is written rather than read off a
title page, and it names books: the Hall blurb opens its second paragraph with
`<i>The Secret Teachings of All Ages</i>`, which set as angle brackets on the
board. Same shape as the three above it — a run of text emitted as one string
with one font — and found the same way, by rendering the thing rather than
reading the diff. `wrapMarkup` breaks a paragraph into runs, through
`parseInlineMarkup` rather than a second reader, since its word indices are
already the coordinate `wrapText` walks in; a face with no bold makes the
engine's own substitution. The quotes went with it: the interior turns
typewriter marks round at layout time (`typographicQuotes`) and the cover did
not, so the blurb would have set `"Black Magic pure and simple"` in typewriter
marks in a line of Garamond. Applied to the blurb unconditionally and without a
switch, because a cover is new matter entirely — nothing on it is being
reproduced from a page, so there is no faithfulness argument to weigh.

**A newline in a title is a hard break, and it is the one place here a hand
break is right.** The body forbids them because it reflows to whatever measure
the design gate settles on, so a break typed against one measure rots against
the next. A display title does not reflow: it is three or four words set as a
shape, and `THE / MANUSCRIPT / LECTURES` is not what a breaker would choose and
is what the board wants. `stackedLines` wraps each segment, so a stacked line
too long for the measure still breaks rather than running off the cover, and
`fitText` goes through it too or the size is chosen against a line count the
page will not have. Safe for a banked look by construction, the break living in
`content.title`, which is the half that never travels. What it did break is the
**spine**: that line is `title · author` along a fold, and the newline reached
the writer intact. Reproduced rather than reasoned about — the fault was put
back and the sheet rendered — it does not drop a glyph, it **breaks the line**:
the rotated run set as three stacked lines across the spine's width and ran off
the fold onto the front panel. `flattened` is the one rule for anywhere a break
cannot be set, and the editor saw the broken version because the sheet he was
sent had been rendered before the fix went in.

**The author's name was a caption on every cover this arm had made.** The
editor's note, on seeing the third of them: the author of a book is pretty
important, and this is a trend. `AUTHOR_RATIO` was 0.38, so a 30 pt title set
its author at 11.4 pt — smaller than the back-cover copy beside it, and a
reader along a shelf is often looking for the name rather than the title. It is
0.62 now, with `AUTHOR_MIN_PT` at 16 because a share alone fails at the small
end: a short title fitted to a narrow trim comes out at 20 pt and a fifth of
that is unreadable at the distance a cover is first seen. `SPINE_MAX_PT` went
14 to 16 for the same reason, and the ceiling is safe to raise because the
**thickness** bound is what actually protects a thin spine — the test that
pins it asks a slim book, not a fat one.

**What settled the number is the thumbnail, and it is the test to reach for.**
Twice the raise was not enough and twice it was argued at reading size, which
is not where a cover is first met. Rendering the front at a true 160 px — what
a search result shows — answers it in one picture: at 15.6 pt the name is a
smudge, at 21.8 it is legible only just, at 26 it reads. The same picture said
the real fault was not the ratio at all. **The author was small because the
title was**: this spec pinned `titleSizePt` at 30 on a 7×10 board, chosen when
the title was one line, and unpinned the engine fits it at 42 with the author
following to 26. Check what a size is a share _of_ before changing the share.

**And the ground figure had to move with it.** The eye is positioned by the
artwork rather than by the composer — a wrap figure is scaled to the sheet's
height, so there is no vertical slack to shift it in, and `radiance.mjs --at`
is the pupil's height as a fraction of the sheet. Two lines of title put the
rule 1.042 in further down, so the artwork was regenerated at `--at 0.4217`
against 0.32, which holds the rule-to-pupil gap at 1.435 in exactly. Both
numbers came off `composeCover`'s own items rather than off a render: the title
rule is a `rule` item and not a thin `fill`, which is what the first
measurement looked for and did not find.

**A blurb is read standing up, and the size that suits a page does not suit a
board.** The back-cover copy set at the body size of a book held at reading
distance, which is the wrong distance: a back cover is read at arm's length off
a shelf, and at thumbnail size in a listing it is not read at all. So
`blurbSizePt` and `blurbBorder` on the look, both banked, because a collection
wants one treatment and not a decision remade per volume. Three things the pass
turned up. The **leading has to come off the chosen size**, not off the default,
or a larger face prints its lines through each other, and the fixture that pins
it measures the step between two baselines rather than counting items. The
overflow guard **returned in silence** — a blurb longer than the space it has
was simply cut, which is this file's own rule about a guard's fallback, so it
warns and names the size. And the box is struck round **the copy that was set**,
not round `blurbFrame`: that frame runs down to the barcode, so a box on it
stands three inches of empty board below the last line.

**And the check that should have been looking was looking at the ground.** The
same render warned that an element sat where KDP prints the barcode, and the
element was the ground figure — bled off the sheet at twelve per cent, under
everything, by construction. `isGround` knew about the ground _pattern_ and was
not extended when the figure was added, so the warning fired on every cover
carrying one. The code's own comment says why that is worse than silence: a
check that fires every time is a check its reader learns to skip, and it was
the one check that could have told me whether the blurb I had just moved
intruded.

- **Also done**: **the cover** (`src/core/cover`, `platform/browser/cover-*`,
  `src/app/CoverStudio.tsx` — the reasoning is in
  the plan above). SPEC §1 called covers a
  non-goal with one carve-out — the tool must report the page count, "which the
  user needs for spine-width math" — and that carve-out is the argument for
  reversing it: the page count _is_ the spine, this app is the only thing that
  knows it, and the old answer was to print the number and send the user
  elsewhere with it in their head. What makes it cheap is that everything else
  was already here: the trim, the title and author read off the original title
  page, plates cut at render resolution, the ornament library, six embeddable
  faces, a measurer that agrees with the writer, and the DPI rule. **The
  geometry is computed, not looked up** — KDP publishes the arithmetic, and
  their template files are kept as _evidence_ against it in
  `test/cover-geometry`, the same bargain the app strikes with OCR. The
  interior's two-level split (SPEC §7) reappears as a `CoverLook` banked for a
  **collection** and a `CoverContent` that never travels, enforced by
  `BANKED_COVER_KEYS`; the front is one of five **arrangements** rather than a
  canvas, because free placement makes volume two a fresh act of design and a
  collection is the point. The preview is the PDF, as at the design gate. Art
  has four equal doors — a plate from the book, an upload, a generated picture,
  or none — and the honesty is in the pixels: a 6×9 front at 300 DPI is 4.9 MP
  where most models return one, which is 136 DPI, so the requirement is computed
  from the arrangement's own frame _before_ anything is generated and quoted in
  DPI rather than megapixels. Every brief forbids lettering, because the type is
  the composer's job and a model's version of it is a second, misspelled title.
  Provenance is recorded for every picture. Replicate is **probed, not
  assumed**, exactly as the batch endpoint is: if a browser may not call it the
  question withdraws itself and the other three doors are undiminished.

- **Also done**: **the front cover on its own** (`src/core/cover/icon.ts`,
  `renderFrontCover`). A cover file is a flat sheet — back, spine, front, plus
  the bleed the printer cuts off — which is what KDP wants and is nothing like
  what a person recognises as a book. Anywhere books are _listed_, including
  this app's own shelf, needs the front panel trimmed. It is cut out of the
  rendered sheet rather than composed separately, so an icon cannot show a front
  cover the PDF does not contain, and pdf.js is given the crop's offset and a
  canvas the size of the crop so a large icon of a long book does not rasterise
  the back cover to throw it away. Two things the pure module exists to get
  right: the cut lands on the **trim, not the bleed** — an eighth of an inch of
  artwork nobody will ever see, at the wrong proportion, so a cover judged by
  its icon would be judged against something that is not the book — and the
  **DPI is reported** rather than rounded up to look respectable, because a
  picture of a cover uploaded to a printer is a rejected book.

- **Also done**: **the plain board — a frame, a device over the type, and the
  label arrangement.** What a reprint from one tradition actually wants is the
  cloth binding's paper label: an emblem, a compact block of type near the head,
  a border, and an empty board. None of the three existed. **The frame** is
  struck an eighth of an inch inside the safe line, because trim wanders by up
  to a sixteenth and a line parallel to the edge is the one place that shows;
  front only, since a border round the back would run under the rectangle KDP
  prints the barcode over. It brings `frontTypeArea` with it — the safe area
  lies _outside_ the frame, so setting type to it would strike a centred line
  through the border, which is a cover that prints rather than a cover that
  errors. **The device on the front** is the look's own press mark placed a
  second time, under its own id: the same artwork prints a third of an inch on
  the fold and an inch on the board, and one raster serving both is the wrong
  picture at whichever it was not made for. It is charged against the type's
  height budget rather than merely offsetting it, so the title is fitted to the
  space that is left. **`label`** is the arrangement: everything in one block
  near the head, distinct from `typographic`, which is the jobbing printer's
  page with the author at the foot and the space between doing the work. The
  test that the device is _charged_ passed against the reinstated fault first —
  at 6×9 a short title's size is settled by the measure and the height budget
  never binds — so the fixture is a tall device over a long title, where it
  does.

- **Also done**: **the ground figure** (`src/core/cover/figures.ts`) — one
  large picture behind the front cover's type, bled off three edges and
  printing at around five per cent. It is deliberately **not** another entry in
  the ground-pattern list, and the difference is the whole module: a pattern is
  allover, so it has no alignment to notice and can run across a fold that
  creeps by an eighth of an inch, while a figure has a centre and a pair of
  wing tips and a reader can see that the fold has moved it. So a figure stops
  dead at the fold and the back cover keeps its plain ground — which is the
  invariant the tests pin, because the failure is not an error but a faint
  picture half-printed on the back of a book somebody has already bought. The
  tint is clamped rather than trusted: under about four per cent a
  print-on-demand press mottles instead of lightening, and past a fifth the
  figure stops being a ground and competes with the title. No new fitting code
  — `renderGroundImage` already covers and centre-crops, which is exactly what
  bleeding off three edges needs, so there is no second fit to disagree with
  the first. Shipped with two traces of the same artwork, because a ground at
  five per cent wants a **mass** and the same figure as a device at an inch
  wants the **detail**: fine hatching averages out to nothing at the one size
  and is the whole character of the thing at the other.

  **A figure is not centred by its bounding box** (`FIGURE_ANCHOR_X`,
  `coverOffsetX`). Isis is a symmetrical statue photographed slightly
  off-axis, so centre-cropping her box put the sun disc on her head a tenth of
  an inch right of the centre line the device above the title is printed on,
  which is plainly visible once the two are meant to agree. The artwork
  therefore declares which point of itself belongs on that line, and the crop
  shifts to honour it — clamped at the edges, because a ground pulled far
  enough to satisfy an anchor would come away from the trim and leave a band
  of bare cover, which is the one failure a bleeding ground exists to prevent.
  The number was measured wrongly first, and instructively: the ink centroid
  of the artwork's topmost band looks like the crown and is in fact the **wing
  tips**, which rise as high as the horns, so it overshot and moved her too
  far. Fitted instead against the disc's position on the finished cover, at
  two anchors, solved for the centre line and confirmed by eye with the tint
  stretched.

  **A ghost is not the ink, and a pale colour is the wrong way to make one
  yellow** (`CoverPalette.figure`). The figure was tinted with `palette.ink`,
  which on a cover with white type and a brown board is the one colour it
  cannot be: asked for a warm ground behind white lettering there was nothing
  to answer with. It has its own palette role now, falling back to the
  _incoming_ ink rather than the shipped default so a look banked before the
  field existed keeps the appearance it was banked with. Which colour to reach
  for was measured off the rendered PNG rather than judged: over `#3b2a1c` at
  three per cent, a pale gold (`#f0d890`) and a full gold (`#ffd700`) lift the
  ground by the same six points of luminance, and the pale one comes back two
  points warmer than the ground where the full one comes back six. So at a
  ground's tint the **saturated** colour is what has a hue at all — the
  opposite of the guess that went into the question's help text first, and
  visible in a picture only once the two were put side by side.

  **A plain back beside a figured front, and the fade that joins them**
  (`backFigureFrame`, `FIGURE_FADE_IN`, `groundFigureBack`). A figure stops at
  the fold, so the back was a bare board — which reads as an unfinished cover
  rather than a restrained one. The obvious repair is to carry the picture
  across the whole wrap and it is the one thing this module exists to refuse.
  So the back carries a **second** printing of the same artwork, mirrored, in
  its own box, and the two are joined by not meeting: each fades to nothing
  three quarters of an inch from the fold, which with the spine between them
  leaves about three inches of plain board around it. Nothing registers because
  nothing touches — the same bargain the allover patterns strike, reached from
  the other end.

  Two things were settled by measuring the sheet rather than by looking at it.
  **The box has to be the mirror of the front's**, not the back panel plus the
  spine: covering is a scale, so the wider box drew the same arcade 8.06 inches
  wide against the front's 6.43, and a binding showing one picture at two sizes
  is wrong at a glance whatever the tint. Equal boxes are equal scales by
  construction. And **the front has to fade too**: with only the companion
  faded, a column scan of the sheet read 4.8 points of spread across the back,
  zero for the six tenths of an inch before the fold, and 4.8 again the instant
  it crossed — the fade had moved the one visible join rather than removed it.
  Faded both sides, the scan is zero from 6.0 to 7.75 inches with the fold at
  7.68 inside it.

  The same scan settled a thing the eye got wrong in the other direction. The
  back's arcade plainly _looked_ stronger than the front's on the first render,
  and both measured 4.78 — what differs is that the front panel has a white
  frame and type beside it to adapt against, and the back has nothing. The
  fade itself is baked into the picture's own alpha rather than asked of the
  PDF, since it is rasterised here anyway and a soft edge in the pixels needs
  nothing of the writer, the composer or the KDP checks.

  **And a fade on one edge is a repair; on four it is a vignette**
  (`figureFade`). Faded at the fold and cut square at the other three, the
  figure announced that something had been fixed on that side: the eye meets
  three hard edges and one soft one and asks what is wrong with the soft one.
  The fade now reaches nothing at **every** trim edge — zero inset at the fold,
  which is already a trim edge, and the bleed on the other three — and it costs
  nothing at the cut while gaining something, since a tint already at nothing
  by the trim line cannot show a trim that wandered.

  Measuring it took three goes and each failure is a shape worth knowing. A
  **percentile spread** per band measures the picture, not the fade: the
  arcade's own content varies eightfold between a column of piers and an open
  doorway, which is far more than the thing being looked for. Dividing by an
  identical render with `FIGURE_FADE_IN` at zero removes that — but **mean
  luminance above the ground is linear in the tint where a median deviation is
  not**, and the first ratio, built on the deviation, had the ramp saturating a
  third of an inch in, which is not what a smoothstep over three quarters does.
  And the ground has to be the look's own colour rather than a corner of the
  sheet: sampled, the corner is bare in the faded render and carries the figure
  at full strength in the reference, so the two subtractions used different
  zeros and the ratios came back above one and below zero. With all three
  fixed, and the tint raised to the ceiling so the signal clears the metric's
  noise, the four edges agree within 0.05 at every distance and the ramp
  matches the smoothstep — 0.80 against 0.78 at half an inch, 0.97 against 0.95
  at two thirds, 1.00 by three quarters. The one band that disagrees is 0.35in,
  which reads near 1.00 on all four edges because the frame rule is struck at
  0.375in and sits inside it.

  **A subtitle can be the volume's name** (`CoverLook.subtitleRatio`). The
  subtitle set at 0.42 of the title, which is right for an explanatory phrase
  and wrong for a reprinted multi-volume work: _Isis Unveiled_ is "Science" and
  "Theology", _The Secret Doctrine_ "Cosmogenesis" and "Anthropogenesis", and a
  reader looking along a shelf for the second volume is looking for that word.
  A **share** rather than a size in points, because the title's own size is
  usually fitted — bank a look, give volume two a longer title, and a subtitle
  pinned in points would stay put while the title shrank past it.

  **A picture with no overflow cannot be positioned** (`FIGURE_ZOOM`,
  `coverScale`). Covering is the _minimum_ scale that fills the box, so a
  figure whose proportions are the panel's is drawn at very nearly its own size
  and has no slack — the arcade's are within half a per cent of a 6×9's, which
  left four pixels of travel on a twelve-hundred-pixel render, so an anchor
  asking for seventeen got four and nothing said so. A figure now declares how
  much larger than covering to draw it, paid for out of its own edges. The
  check is against **the artwork on disk**, not a number kept beside the
  anchor: what decides the slack is the file's own proportions, and a constant
  repeating them is a constant that can come to disagree with them.

  Finding where to put it took four measurements, three of them wrong in the
  same way. A band's ink centroid, the widest run clearing half a band's peak,
  and the largest connected mass each answered with the colonnade rather than
  the doorway — every band across that picture crosses piers, arch profiles and
  floor tiles too, and at a tracing threshold the whole scene is one connected
  shape. What separates the doorway is that it is **solid**: ink on every row
  of its band, where a pier is ink only at its edges. The measurement that
  worked draws the picture and reports the number **from the same pixels**, so
  the two cannot disagree — which is what the earlier ones could do, one of
  them confidently, by a quarter of an inch, in the wrong direction.

  **A book's own art may already be traced, and on the shelf.** Asked for a
  cover with "a trace of an eye" for the Hall manuscripts, this session drew one
  from geometry, on the reasoning that nothing had been supplied and the
  iconography is unowned. It was a good argument for the wrong act. The book's
  directory on the shelf carries an `art/` folder holding **Hall's own device**,
  already traced to 253 contours from the cover of his own magazine, beside a
  README naming four candidate sources with the emblem measured in pixels on
  each and saying which one is usable and why. None of that was looked at.

  **A radiance is not a stretched fan, and the trace has nothing in it to
  stretch.** Asked to carry the eye's rays out in every direction so the whole
  board is the pattern, the obvious move is a radial stretch of the ray
  contours — and there are none: the engraving is one connected mass of ink
  with the slits between its rays cut out of it, so the file is a single
  snaking contour and two hundred-odd specks, and no classification of them
  finds a ray. What there is, is the pattern the rays make where they reach the
  rim, which is read off the ink and carried outward, each run of ink becoming
  one ray on its own angle (`scripts/radiance.mjs`). Three measurements shaped
  it and each replaced a wrong one. The radiant point is found by minimising
  the share of gradient energy lying **along** the radius — every stroke points
  at the centre, so at the centre the gradient is square to it — after a
  least-squares pencil of contour axes and an angular-contrast search had both
  answered from contours that are not rays, the second drifting to the top edge
  of the picture. A ray is carried out as a **line**, not as the wedge a radial
  stretch gives: at its own angular width it keeps half the board inked at
  every radius, and the first emission covered a 7×10 in alternating black and
  ground to the corners. And a run far wider than the rest is **rays the trace
  lost** where the slits closed up, so the carried width is capped at the runs'
  ninth decile, which holds back 13 of 133.

  **The shape to remove was the fan's rim, not its mass — and it took three
  tries to hear that.** The engraving is an ellipse (953 px of ink at the sides
  against 464 at the foot), so the first reading was that the lozenge _is_ that
  ellipse of ink. It is not. What a reader sees is where the engraving's rays
  **stop**: a hundred and thirty-three blunt ends and the gaps between them,
  standing in an arc. Holding every ray at the fan's own width out to its
  longest reach makes the heavy zone a circle and the arc survived it. Fading
  the join does nothing, the join not being what shows. And not printing the
  hatching at all removes the arc and takes the emblem with it — the hatching
  round the eye and the seven stars is what the device is, and the editor asked
  for it back in those words.

  What works is **fading the ink to nothing across its own rim**, per angle,
  against the measured rim rather than a circle, with the carried rays running
  on through the band. The band's inner bound is set by the stars and not by
  taste: the top row sits at 0.84 of the rim in its own direction, so an earlier
  start takes the ink out from behind them and they stop reading as holes.

  **An edge is measurable where a mass is not.** Three photometric assays of
  evenness all failed — a twelve-sector spread reads the rays themselves, which
  are a hundred-and-thirty-third harmonic; the second harmonic, which is what an
  ellipse is, moved only 16 to 10 per cent; a half-peak edge per direction is
  pinned by the eye and the stars, both legitimately angular. But a rim is a
  _step_, so smooth the ink down each of 144 directions, differentiate, and take
  the steepest fall within a quarter inch of the rim: 10.06 to 7.01 per inch at
  the ninth decile, which is the directions where the edge showed most. **The
  smoothing has to be narrower than the thing being measured** — at an eighth of
  an inch either way the faded and unfaded artwork read 1.75 and 1.80, a
  difference of nothing, because the window blurred the step away. That is the
  general lesson: a smoothing window wide enough to quiet the texture is wide
  enough to erase the feature.

  **A figure can be lifted out of a trace that has no contour for it.** The
  seven stars are traced so that a carried ray does not run through one — on the
  paper a star is white, a shape the ink encloses. Neither they nor the eye come
  out by contour or by labelling: the eye's ink is one connected component with
  the whole fan, and the seventh star's white is one with the background,
  because on the paper both touch the hatching. What works is that a star and an
  eye are **star-shaped about their own centres**, so walking outward from a
  seed at every angle traces the true outline off the original pixels, contacts
  and all. Six stars give their own seeds; growing the ink by 11 px seals the
  seventh's contacts and gives one, and it is accepted on the same two
  measurements the six make — an area inside their range and a point-to-valley
  ratio inside theirs — so that it is admitted by measurement rather than by
  position. Exactly one candidate in the picture passes both.

  **The carried rays begin where the engraving's own do.** This fan sets
  seventeen strokes just outside the eye and ninety-four at the rim: the rays
  multiply outward, which is why it is open round the eye and dense at its edge.
  The count is measured at two dozen radii and each carried ray is given a
  radius to begin at from that curve, so the two agree rather than printing a
  collar of ink the engraving does not have.

  And **a mask or a clip-path must not share an element with a transform**: both
  are resolved in the user space of the element carrying them, so that element's
  own transform moves them too — which put the eye's outline an emblem's width
  away and drew nothing at all.

  **A carried ray has to be the same material as a cut one**, or the join shows
  wherever the two meet. Measured along the trace's own rays: a ray wanders
  sideways about half its own width over the fan's depth, and it is a chain of
  dashes 16 px long with 12 px gaps. Three things about reproducing that were
  printed wrong first and each is a general lesson. Every length along a ray is
  held in the **logarithm of the radius**, because a carried ray is ten times a
  cut one's depth and a wavelength fixed in pixels gives twenty-seven waves of
  hair down the board, or sixty beads on a string — and a length fixed as a
  fraction of the core radius is the same mistake under another name, which is
  the version that printed the foot of the cover as bamboo. The **gap is the one
  length that does not scale**, a break being where the burin left the plate. And
  a dash is a **lens, not a bar**: a square cut across a stroke a twentieth of an
  inch wide reads as a dash in a dashed line however narrow the gap is made, and
  no amount of shortening it helped.

  **A figure may cross the fold when it is one picture rather than two.** The
  rule this module opens with — a figure stops dead at the fold — forbids a
  _scene printed as two boxes_ either side of a fold that creeps by an eighth of
  an inch, because those are two halves that will not meet on the printed copy.
  A single picture over the whole sheet has no seam to misregister: a fold that
  lands out moves the crease, not the artwork. So `groundFigureWrap` runs the
  figure across the back, the spine and the front as one image, aimed by
  `wrapAnchorTarget` at the front panel's centre line rather than the sheet's
  (whose middle is the spine), with no companion behind it and no fold edge to
  hold the fade back from. What it costs is stated rather than hidden: the
  figure is positioned against the sheet, so a creeping fold carries the panel
  with it and the subject sits up to an eighth of an inch off the panel's centre
  line — invisible on a radiance, not on a face.

  Two things it settled about placing a figure. **The artwork's box is wider
  than any box it can be asked to fill** (2.6 wide to tall), because a picture
  wider than its box is scaled to the box's _height_ and cropped at the sides —
  so the fraction written into the file is the eye's height on the board,
  exactly, on every trim, and the emblem prints at the width it was written for,
  the only box height either placement has being the full height of the sheet. A
  box the shape of one panel would be exact on that book and wrong on the next.
  The number is set by the wrap rather than by the panel: across a whole 7×10
  cover the far corner of the back is 13.5 in from the eye, and the artwork's own
  half-width has to reach it. And **the type moves,
  not the figure**: the pupil is set under the title rule, which on a `label`
  cover is where the author's name goes, so `CoverLook.authorAtFoot` sends the
  name to the foot. Where the eye goes is the design and where a line of 13pt
  roman goes is not.

  The general rule is the one the shelf exists for: **the book's directory is
  the first place to look, not the last.** Before making anything for a book —
  art, a colour, a strapline — read what is already in its directory. A book
  well along carries `art/`, `covers/`, `illustrations.md`, `rulings.md` and a
  dozen other files, every one of them a decision somebody already made with the
  paper in front of them. The formatter repository cannot see any of it until
  the shelf is attached, which is one tool call, and the cost of not making it
  is work that duplicates better work and has to be thrown away.

  **A scene traces differently from an object**, which the arcade added to the
  library shows: one thing on white paper has a silhouette to find, and a
  colonnade has no background at all, so every mark comes out of local contrast
  and the first pass read marble veining and JPEG noise as detail. Raising the
  contrast a mark must clear and dropping contours under about forty square
  pixels is what turns flat stone white and spends the ink on the architecture.
  Such a trace is a quarter of a megabyte against a device's twenty kilobytes,
  which costs nothing as a ground — it is rasterised at the size it prints —
  and would matter inside a book file.

- **Also done**: **the book's own text as a ground** (`scripts/textground.mjs`,
  the `lexicon` pattern). Asked for a cover for _The Theosophical Glossary_, the
  editor wanted the volume's own words laid densely behind the type, across the
  whole wrap, at a low tint and turned a little off square. It belongs to the
  **pattern** family and not the figure family, and that is the whole of why it
  may cross the fold: a field of text is allover, so there is no centre and no
  pair of wing tips for a fold creeping an eighth of an inch to move. The
  figure's single-picture exception is not needed and is not used.

  Three things it turned out to need. The glyphs come out as **paths**, from the
  same font files pdf-lib embeds, because the artwork is rasterised from an
  `<img>` and an SVG loaded that way does not inherit the page's fonts — a
  `<text>` element would set in whatever the renderer felt like. Each distinct
  glyph is defined once and placed with `<use>`, which is a 965 KB file against
  a six-megabyte one; the `<g>` holding each definition carries its own
  `scale(k, -k)`, so positions stay in points, outlines stay in font units and
  the flip from y-up font space is written once per glyph rather than once per
  occurrence. And the book's **paragraphing is thrown away while its emphasis is
  kept** — the entries run together into one river, because a column of separated
  entries reads as a page that failed to print, while the bold headwords and
  italic language tags are what make the field recognisably a glossary rather
  than grey noise. They arrive as word indices from the reading, so no second
  reader decides what is marked.

  The tint was **measured, not chosen**: the field's ink coverage is 12.75%, the
  same order as the laid paper's lines, so it sits in the band those patterns do
  rather than at the figure's. The type is 10pt — setting it smaller to fit more
  of the book in is how to break this module's own rule 2, since Cardo's stems
  at 10pt are about 0.8pt and the floor is 0.5. What is new beside it is
  `groundPatternOpacity`, a book's answer overruling the pattern's own, mirroring
  `groundFigureOpacity` down to the clamp. It is `null` rather than a number
  where it has not been asked, because each pattern's default was measured
  against what that pattern is made of and a look banked before the question
  existed must keep deferring to it — and because `Number('')` is 0, which is a
  ground that prints nothing and warns about nothing.
