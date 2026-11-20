/**
 * The cover composer's fixed measures: the ids the renderer fills, the frame,
 * the type sizes and the shares they are set at. Each carries its reason.
 *
 * Pure: numbers only.
 */

/**
 * The id the press mark is placed under.
 *
 * A fixed id rather than one derived from the file, because the mark is a
 * property of the look and the renderer has to find its pixels without knowing
 * which book it is setting.
 */
export const PRESS_MARK_ID = '__press-mark__'

/**
 * The narrowest a press mark may print and still be a device.
 *
 * Worth knowing what this implies, because it is not obvious: a fold wide
 * enough for a mark is always wide enough for text too. With KDP's clearance
 * either side this needs a 0.305 in fold — 122 pages on cream, 136 on white —
 * and KDP's own floor for spine text is seventy-nine, so "a mark on a spine
 * too thin for type" is a case that cannot arise, and the two are still
 * decided separately because that is a fact about today's numbers rather
 * than a rule.
 *
 * It was 0.2, a judgement rather than a measurement, and it left the mark off
 * the 128-page *Human Aura and Astral World* by five thousandths of an inch:
 * the one spine of the collection without the device, on a book whose
 * hardcover carries it. The inkball is one silhouette with no counters, and at
 * 0.185 in — 55 pixels across at 300 DPI — it reads as the same mark the
 * thicker spines beside it print.
 */
export const MIN_MARK_WIDTH_IN = 0.18

/**
 * The id the front cover's device is placed under.
 *
 * Its own id rather than the spine's, although both draw the same artwork.
 * The two print at very different sizes — a third of an inch on the fold
 * against an inch or more on the board — and the renderer rasterises a mark at
 * the size it was placed at, so one raster serving both would be wrong at
 * whichever it was not made for.
 */
export const FRONT_MARK_ID = '__front-mark__'

/**
 * The barcode's own items, so the checks can tell it from an intruder.
 *
 * The barcode area is the one rectangle on the sheet where the rule is
 * "nothing may be drawn", because KDP prints over whatever is there. A cover
 * that carries its *own* barcode is the exception that proves it, and without
 * an id the check would fire on exactly the covers that got it right.
 */
export const BARCODE_ID = '__barcode__'

/**
 * How far in from the trim the frame is struck.
 *
 * Not the quarter inch the safe area asks for. Trim varies by up to a
 * sixteenth, and on a line parallel to the edge that variation is the one
 * place it is plainly visible — a border a sixteenth narrower down one side
 * than the other reads as a crooked book. An eighth of an inch inside the safe
 * line, the same wobble is a sixteenth in three eighths and nobody sees it.
 */
export const FRAME_INSET_IN = 0.375

/**
 * How far the edition statement sits below the title's rule, as a share of its
 * own size. A hair, by request: enough to read as a separate line and not
 * enough to float free of the title it belongs to.
 */
/**
 * How much of the subtitle's size the edition line takes when both are set.
 *
 * On a cover with no subtitle the edition line is the subtitle slot and takes
 * its full size. With one, it is the line underneath that says what *this*
 * printing is — "Annotated", "Illustrated", a volume number — and at the same
 * size the two read as two subtitles. Two thirds is plainly subordinate and
 * still sets at 10 to 11 pt against this collection's 16, which is readable
 * on a board at arm's length.
 */
export const EDITION_LABEL_SHARE = 0.66

export const EDITION_DROP = 0.45

/**
 * How much clear space the frame keeps between itself and the type.
 *
 * Without it the type box is still the safe area, which is *outside* the
 * frame — so a centred line long enough to fill the measure would be struck
 * through by the frame's own sides.
 */
export const FRAME_CLEARANCE_IN = 0.14

export const FRAME_PLAIN_PT = 1.25
export const FRAME_DOUBLE_OUTER_PT = 1.5
export const FRAME_DOUBLE_INNER_PT = 0.6
export const FRAME_DOUBLE_GAP_PT = 3.5

/** How wide the front's device prints, as a share of the type's own measure. */
export const FRONT_MARK_FRACTION = 0.2

/** And never wider than this, however wide the trim is. */
export const FRONT_MARK_MAX_IN = 1.4

/**
 * The deepest a front device may be, as a share of the safe area's height.
 *
 * A quarter leaves the title and what follows it three quarters of the board,
 * which is the proportion the `label` arrangement is built around. Without it
 * only the width was bounded, so a device six times as tall as it is wide
 * drew past the trim and took the type with it.
 */
export const FRONT_MARK_MAX_HEIGHT_SHARE = 0.25

/** Title sizes are searched in this range, largest first. */
export const TITLE_MAX_PT = 64
export const TITLE_MIN_PT = 14
export const SUBTITLE_RATIO = 0.42

/**
 * The most of the title a *pinned* subtitle size may take.
 *
 * A share may ask for more, and that is the case the share exists for: on a
 * reprinted multi-volume work the subtitle names the volume and is read as
 * hard as the title. A pinned size is a collection's one number applied to
 * every board, so on a book whose title came out small it can arrive level
 * with the title and print as two titles. Three quarters keeps it plainly
 * subordinate without making the pinned number useless.
 */
export const SUBTITLE_MAX_SHARE = 0.75
/**
 * The author's size, as a share of the title's.
 *
 * Raised from 0.38, then again, on the editor's standing note that the name
 * was coming out small on every cover this arm has made. At 0.38 a 30 pt title
 * set its author at 11.4 pt, which is a caption, and the author of a book is
 * not a caption: a reader scanning a shelf is often looking for the name
 * rather than the title.
 *
 * 0.62 was chosen against the test a cover actually faces first — rendered at
 * a 160 px search thumbnail, where the name has to resolve at all. At 0.52 it
 * was legible only just; at 0.62 it reads, and it still does not compete with
 * the title.
 */
export const AUTHOR_RATIO = 0.62

/**
 * And never smaller than this, whatever the title does.
 *
 * A share alone fails at the small end — a short title fitted to a narrow trim
 * can come out at 20 pt, and a fifth of that is unreadable from the distance a
 * cover is first seen at. 16 pt is the floor the thumbnail test settles on.
 */
export const AUTHOR_MIN_PT = 16

/**
 * The largest the spine may set, however thick the book is.
 *
 * Raised from 14 with the author's size and for the same reason: a spine is
 * read edge-on from a shelf, at a distance and usually at an angle, and 14 pt
 * was the quietest line on the whole cover. The thickness bound below is what
 * actually protects a thin spine, so this ceiling only ever binds on a book
 * fat enough to carry the type.
 */
/**
 * The default ceiling on spine type, where a collection has banked none.
 *
 * It is a backstop and not the usual bound: `maxByThickness` already holds
 * the type to 0.62 of the fold, which is what actually keeps a spine from
 * looking wrong. At 16 the backstop was doing the binding instead — measured
 * across this shelf, three spines of about 1.1 in could each carry 27 to 33
 * pt and all three set at 16, leaving two thirds of the fold empty on the one
 * part of a book a shelf shows. Raised to a size no ordinary fold reaches, so
 * that what decides a spine is the fold and the length of the line on it.
 */
/**
 * How much of the safe fold the spine's type may fill.
 *
 * `spineSafe` is already inset by KDP's sixteenth of an inch on each edge, so
 * part of this is white and part of it is slack against the metrics.
 *
 * A hair under 1.0 rather than a design choice: the box is now the same one
 * `itemBounds` reports and `withinSafe` tests, so at exactly 1.0 a line would
 * sit on the boundary and `contains` would turn on a rounding error. Five per
 * cent is enough to keep it inside and costs well under a point.
 */
export const SPINE_FOLD_MARGIN = 0.95

export const SPINE_MAX_PT = 36

/** What the back-cover copy sets at when the look names no size. */
export const BLURB_PT = 10.5

/**
 * The white between the copy and the box drawn round it.
 *
 * Generous on purpose: a rule struck close to type reads as a table cell, and
 * the thing this imitates is a paper label, where the ink stands well in from
 * the border. There is room for it because the copy's measure is already far
 * narrower than the panel.
 */
export const BLURB_FRAME_PAD_IN = 0.28

/**
 * How far the back-cover copy sits in from each trimmed edge.
 *
 * Far more than the quarter inch the safe area requires, and not for safety.
 * It is the **measure**. Set to the full safe width of a 6×9 back cover, this
 * copy runs about ninety-five characters to the line, where comfortable
 * reading is forty-five to seventy-five: the eye loses its place on the return
 * sweep and the block reads as dense before a word of it has been taken in.
 * An inch brings a 6×9 to roughly seventy.
 */
export const BLURB_SIDE_INSET_IN = 1

/**
 * The widest the copy is allowed to set, whatever the trim.
 *
 * A fixed inset alone does not generalise: an inch either side of an 8.5×11
 * back cover still leaves six and a half inches, which is a hundred and
 * thirteen characters and worse than what this was meant to fix. So the inset
 * is a floor and this is a ceiling, and on a wide trim the block is centred in
 * what is left rather than stretched across it.
 */
export const BLURB_MAX_MEASURE_IN = 4.6
export const IMPRINT_PT = 9
export const LEADING = 1.25
