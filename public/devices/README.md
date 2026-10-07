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

## The all-seeing eye

`all-seeing-eye.svg` (the trace as it came), `all-seeing-eye-ground.svg` (the
same paths in a box a portrait cover can cover whole).

Manly P. Hall's own device — the one he put on the manuscript-lecture wrappers
and on the masthead of his magazine. A fan of fine rays, seven seven-pointed
stars, an open eye.

**It was not traced here.** It was traced on the shelf, where it belongs, from
*The All-Seeing Eye* Vol. 2 No. 5 (Los Angeles, March 1924), and the source of
record is `books/ManlyPalmerHall-CollectedManuscriptLectures-7qk2m4/art/` in the
storage repository, whose README carries the provenance, the four candidate
sources with the emblem measured in pixels on each, and why this one is the only
usable one — not because it has the most pixels, but because it is a letterpress
impression on a flat page rather than a photograph of a curled wrapper, so each
ray is a separate black line instead of a grey wash. These two files are copies,
for the app to serve. **Re-trace on the shelf, not here.**

**The padding carries two numbers so the library does not have to.**
Horizontally the box is extended until the emblem's measured axis of symmetry is
its centre, which makes `FIGURE_ANCHOR_X` exactly 0.5 and `FIGURE_ZOOM` 1 —
the one anchor value that cannot drift away from its file. Vertically it is
extended to a portrait proportion, because covering is the minimum scale that
fills the box and a 1.63-wide emblem on a 0.70 panel would otherwise be drawn to
fill the height and lose two thirds of its width off the sides; the extra room
also sets the emblem below the middle, under the type.

**The axis was measured twice and the first answer was wrong.** Folding the ink
profile onto itself and scoring the agreement *over the overlap alone* answers
0.642, because the overlap shrinks as the axis moves outward and the sparse ray
tips near an edge agree with almost nothing. Scored over the whole profile, with
anything past the end counted as no ink, it answers **0.5369** — against 0.531
from the midpoint of the two flanking stars and 0.535 from the star below the
eye, both measured independently on the shelf. Three methods within six
thousandths of the width.

`all-seeing-eye-radiant.svg` — the same engraving with every one of its rays
carried on to the edges of the board, so the whole cover is the radiance and the
eye sits in the middle of it rather than in a half-disc at the foot. Written by
`scripts/radiance.mjs` from `all-seeing-eye.svg`, which is the file to re-run if
the trace is ever redone.

Shipped at `--width 3.6 --at 0.4883`. `--at` is the pupil's height as a
fraction of the cover sheet, and it is how the emblem is aimed vertically: a
wrap figure is scaled to the sheet's height, so the composer has no slack to
shift it in and the artwork has to carry the position itself. 0.4883 sets the
pupil 1.435 in below the title rule of a three-line 42 pt title on a 7x10,
which is the gap the one-line 30 pt title had at 0.32. It has been re-fitted
twice, once for the stack and once for the larger type. Re-run it if the title's line count
changes, taking the rule's y off `composeCover`'s own items rather than off a
render.

Three things about it are measurements and not choices, and each replaced a
wrong answer. **The point it radiates from** is the pupil, found by minimising
the share of gradient energy lying along the radius — every stroke of a sunburst
points at the centre, so at the centre the gradient is square to it. Two contour
measurements answered first and neither could be believed: the trace is one
snaking contour, the engraving being a single mass of ink with the slits cut out
of it, so there is no such thing as a ray to measure. **A ray goes out as a
line**, not as the wedge a radial stretch would give: carried out at its own
angular width every ray keeps half the board inked at every radius, which is a
wash, and the first emission covered a 7×10 in alternating black and ground to
the corners. **A run far wider than the rest is rays the trace lost**, where the
slits closed up under the bottom star and in three other places, so the carried
width is capped at the runs' ninth decile and 13 of the 133 are held back.

**The shape to remove is the fan's rim, not its mass.** The engraving is an
ellipse — its ink reaches 953 px at the sides and 464 at the foot — and the
first guess was that the lozenge was that ellipse of ink. It is not. What a
reader sees is where the engraving's rays **stop**: a hundred and thirty-three
blunt ends and the gaps between them, standing in an arc. Three repairs went in
before that was understood. Holding every ray at the fan's own width out to its
longest reach makes the heavy zone a circle, and the arc survived it. Fading the
*join* does nothing, because the join is not what shows. And not printing the
hatching at all removes the arc and takes the emblem with it — the hatching
round the eye and the seven stars is what the device is.

So the ink is **faded to nothing across its own rim**, per angle, against the
measured `env` rather than a circle, and the carried rays run on through the
band and out. What the eye meets at the rim is a ray getting on with it rather
than a row of stops. The band is 0.84 to 0.98 of the rim; its inner bound is set
by the stars and not by taste, the top row sitting at 0.84 of the rim in its own
direction, so an earlier start takes the ink out from behind them and they stop
reading as holes. Three bands were rendered and measured: 0.80 is a shade better
at the rim and visibly thinner behind the top stars, which is the wrong trade.
The fade is a greyscale raster rather than a radial gradient, because the rim is
not an ellipse — it is whatever the press cut, and `env` is the measurement of
it.

**The seven stars are traced so the carried rays do not cross them.** On the
paper a star is white, a shape the ink encloses, so a ray running through one
would fill it. Neither the stars nor the eye can be lifted out by contour, and
neither by labelling: the eye's ink is one connected component with the whole
fan and the seventh star's white is one with the background, because on the
paper both touch the hatching. They come out by **walking outward from a seed at
every angle** instead — a star and an eye are star-shaped about their own
centres, so the first ink traces the true outline off the original pixels,
contacts and all. Six stars give their own seeds; growing the ink by 11 px seals
the seventh's contacts and gives one, and it is then accepted on the same two
measurements the six make — an area inside their range (20,371 against
18,135–25,877) and a point-to-valley ratio inside theirs. Exactly one candidate
in the picture passes both.

**The carried rays begin where the engraving's own do.** This fan sets seventeen
strokes just outside the eye and ninety-four at the rim: the rays multiply
outward, which is why it is open round the eye and dense at its edge. `counts`
measures that at two dozen radii and each carried ray is given a radius to begin
at from the curve, so the two agree instead of printing a collar of ink the
engraving does not have.

**Measuring the evenness photometrically does not work, and measuring the rim
does.** A twelve-sector spread reads the rays themselves, which are a
hundred-and-thirty-third harmonic; the second harmonic, which is what an ellipse
is, moves only from 16 to 10 per cent; a half-peak edge per direction is pinned
by the eye and the stars. No assay separates a star from a shape. But an *edge*
is a step in the ink, and that is measurable: smoothed down each of 144
directions and differentiated, the steepest fall within a quarter inch of the
rim goes from 10.06 to 7.01 per inch at the ninth decile — the directions where
the edge showed most. The smoothing has to be narrower than the fade band or it
blurs away the step it is for; at an eighth of an inch either way the two
readings came back 1.80 and 1.75, which says nothing. A test pins the structure
beside it: the engraving enters the artwork exactly once, under the rim mask.

**The texture is the engraving's, measured along its own rays.** A carried ray
was a clean polygon, which reads as a different material from a cut one and puts
a visible join between them. Followed outward run by run, a ray of this fan
wanders sideways about half its own width over the fan's depth, and along its
length it is a chain of dashes — 16 px of ink to a 12 px gap at the median. Three
things had to be got right and each was printed wrong first: every length along
a ray is held in the **logarithm** of the radius, because a carried ray is ten
times a cut one's depth and a fixed wavelength gives twenty-seven waves of hair
or sixty beads on a string; the **gap does not scale**, a break being where the
burin left the plate; and a dash is a **lens, not a bar**, because a square cut
across a stroke a twentieth of an inch wide reads as a dash however narrow the
gap is made.

**Its box is wider than any box it can be asked to fill** — 2.6 wide to tall. A
picture wider than its box is scaled to the box's *height* and cropped at the
sides, so two things hold exactly on every trim and in both placements: the
eye's height on the board is the fraction written into the file, and the emblem
prints at the width it was written for, the only box height either placement has
being the full height of the cover sheet. 2.6 is set by the **wrap**: across a
whole 7×10 cover the eye stands on the front panel and the far corner of the
back is 13.5 in away, which the artwork's own half-width has to reach. A test
measures that against the file rather than against a number kept beside it.

**It prints over the type and the type has to move.** The pupil is set under the
title rule, which on a `label` cover is where the author's name goes, so the
look carries `authorAtFoot` and the name goes to the foot of the board. Moving
the type is the repair rather than moving the eye: where the eye goes is the
design and where a line of 13pt roman goes is not.

**And it is the one figure that may cross the fold.** `groundFigureWrap` prints
it as a single picture over the whole sheet, so the rays run left through the
spine and across the back. The rule at the head of `figures.ts` has not moved:
what it forbids is a scene printed as *two boxes* either side of a fold that
creeps by an eighth of an inch, which is two halves that do not meet. One
picture on one sheet has no seam to misregister — a fold that lands out moves
the crease, not the artwork. The cost is said rather than hidden: the figure is
positioned against the sheet, so a creeping fold carries the front panel with it
and the subject sits up to an eighth of an inch off the panel's centre line.
Invisible on a radiance whose rays cross the fold as straight lines; it would
not be on a figure with a face in it, which is why it is a choice a look makes.

**It is a device and prints like one.** At a ground's three to five per cent the
rays merge into exactly the grey wash the trace exists to avoid, so this one
wants ten per cent and up. The reverse of the Isis, where the massed silhouette
is what survives a faint tint: this emblem is nothing but fine lines, and they
have to be dark enough to stay lines. It is also too detailed to work as a press
mark — at the inch a device prints on a board, the whole fan closes up.
