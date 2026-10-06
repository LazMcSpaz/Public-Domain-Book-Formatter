# Devices

Vector art a book's cover or interior can carry, shipped with the app like the
fonts and the ornament library rather than stored with any one book.

## The Theosophical Society's seal

`theosophical-seal-full.svg`, `theosophical-seal-no-svastika.svg`,
`theosophical-ring-motto.svg`.

Traced from a 472 px raster, which is why they are here as outlines rather than
as the picture: at 300 DPI that source prints 1.57 in wide and no larger, and a
device on a cover wants to be bigger than that. The trace is marching squares
over a four-times supersampled threshold, with Douglas-Peucker run on each
closed loop after cutting it at its far point — run straight, DP anchors a
closed loop on two coincident points, measures every distance to a zero-length
baseline and collapses the contour to two points.

**Three files, not one, and the reason is the svastika.** The Society has used
it in the seal since the 1880s and uses it still; it is the Indic svastika and
long predates its appropriation. It is also, on a cover sold today, a mark a
great many buyers will read as something else. That is a judgement for the
editor and not for this repository, so the parts are separable and the
decision is one file name.

Splitting them needed a containment tree rather than positions: the svastika's
own strokes are *holes* in the disc at the crown, so dropping them by bounding
box fills the disc solid, and the serpent's scale-holes near the rim classify
as motto letters. Depth by point-in-polygon says which contour is ink and which
is a hole, and the disc's inner edge is kept when the svastika is not.

The Om is welded to the disc in the source and is not separable without cutting
the outline geometrically. It is present in all three.

## Isis, winged

`isis-winged.svg` (the engraved trace), `isis-winged-solid.svg` (the massed
silhouette).

Traced from a photograph of a modern resin statue, cut at the hem — the plinth
is not in it. The pose and the iconography are ancient and nobody owns them;
the drape, the wing curve and the proportions are that sculptor's, so a close
trace is not as unencumbered as a redrawing from the ancient sources would be.
Worth knowing before one goes on a cover for sale.

**A global threshold cannot trace this and the reason generalises.** The
statue's gold is dark ochre, so the ridges of the feathers and the valleys
between them both fall under any level that separates the figure from the
paper, and the wings come out as two black blobs. What separates them is
*local* contrast — each pixel against the mean of its neighbourhood — with the
truly black areas forced solid underneath, and the outline traced separately at
the paper threshold and stroked, or the gold skirt dissolves into the white
background.

Two files because a ground at five per cent wants a mass and a device at an
inch wants the detail: the hatching averages out to nothing at the first size
and is the whole character of the thing at the second. `FIGURE_SRC` in
`src/core/cover/figures.ts` points the ground figure at whichever is chosen.

## The arcade

`arcade.svg` (the cleaner cut), `arcade-detailed.svg` (more of the stonework).

Traced from a photograph of a colonnade of horseshoe arches, used as a **ground
figure** rather than a device: it fills the board and draws the eye down the
middle where a device holds one shape in the centre. Its proportions are within
half a per cent of a 6×9 front panel's, so it prints very nearly whole — which
also means there is almost no overflow for `FIGURE_ANCHOR_X` to spend, and the
anchor clamps. That is the clamp working, not failing.

**A scene is harder to trace than an object, and for a reason worth
remembering.** The Isis is one thing on white paper, so there is a silhouette to
find; a colonnade has no background at all and every mark has to come out of
local contrast. The first pass read the marble's own veining and the JPEG's
noise as detail and came back sandblasted. What fixed it was raising the
contrast a mark must clear — bias 20 to 24 against a 28-pixel neighbourhood —
and dropping any contour under about forty square pixels, which turns the flat
stone white and spends the ink on the arch profiles, the muqarnas, the zellij
and the floor. The blotching that remains is real: sun falling across stone,
kept because it gives the stone some body.

They are big for SVGs — a quarter of a megabyte each, where a device is twenty
kilobytes — because a scene has two orders of magnitude more contours than an
emblem. That costs nothing as a ground, which is rasterised at the size it
prints, and would matter if one ever travelled inside a book file.

## The radiant eye

`eye-radiant.svg` and `eye-radiant-triangle.svg` (the ground figures, padded),
`eye-radiant-mark.svg` (the square cut, for a device on the fold or the board).

**Drawn, not traced — the only artwork here that is.** Everything above is a
trace of a photograph, which is what you do when the thing already exists as a
picture. Nothing existed here, and that turns out to be the better position
rather than the worse one: the iconography is ancient and unowned, while the
Isis above carries one sculptor's drape and wing curve, and the arcade one
photographer's light. A construction from geometry is encumbered by nobody, on
a book that is for sale.

It is generated rather than hand-written, which is how the proportions were
arrived at — the lid is one cubic reflected, the glory is computed from the
lid's own radial reach, and every constant was moved and re-rendered rather
than guessed at once.

**The glory's tips lie on a circle, and the first version's did not.** Rays
built as "start at the lid, run N units outward" come out as a lozenge: the
lid's radial reach at the corners is twice what it is above the pupil, so a
fixed length throws the horizontal rays half as far again as the vertical ones.
Rendered, it reads as a set of spears rather than as a glory. The start still
follows the lid — the rays should hug the eye — and only the tips are held to a
circle.

**A drawn figure needs no anchor fitting and no zoom slack.** `FIGURE_ANCHOR_X`
exists because a traced photograph's subject is not at its bounding box's
centre, and three separate measurements of the arcade's doorway were wrong
before one was right. This is symmetric about x = 0 by construction and padded
vertically only, so its subject *is* the box's centre: the anchor is exactly
0.5, `FIGURE_ZOOM` is 1, and there is nothing for a clamp to cut short.

**Two boxes for two jobs**, as with the Isis. The ground figures are padded to
a 0.66 aspect so the whole glory survives covering a portrait panel — covering
is the minimum scale that fills the box, so the square cut on a 7×10 front is
drawn to fill the height and loses a third of its width off each side. That is
a fine effect and a different one. `eye-radiant-mark.svg` is that square cut,
unpadded, for use as a press mark, where the surrounding white is the
composer's to give.

The triangle is a separate file for the same reason the svastika is: it is
squarely the emblem a reader expects on a book that names it, and squarely the
wrong one on a book that does not. That is the editor's call and not this
repository's, and the decision is one file name.
