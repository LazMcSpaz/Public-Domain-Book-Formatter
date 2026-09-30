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
