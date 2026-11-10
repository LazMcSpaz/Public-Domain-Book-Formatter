#!/usr/bin/env python3
"""A cover ground of the Masters' own handwriting, from Barker's facsimiles.

    python3 scripts/make-handwriting-ground.py <m.png> <kh.png> <out.png> \
        [--kh-crop 0,740,1236,1683] [--width-in 17] [--height-in 11.5] [--dpi 300]

The Mahatma Letters (1923) prints facsimiles of the hands of M. and of K.H.
The book on the shelf carries them as supplied pictures; this lays the two
Masters' pages out as a field the size of a whole cover sheet, ink on white,
for the cover composer to tint down as a ground figure.

Only the Masters' writing is used. The K.H. facsimile shares its page with a
covering note in Damodar's hand above the Master's reply, so it is cropped to
the reply (`--kh-crop`, in source pixels); the diagram facsimile is not
handwriting and is not used.

Each page is cleaned the same way: grey paper to white, ink to black, a
linear ramp between, and anything left lighter than `CLEAR_ABOVE` cleared (`PAPER` and `INK`, measured off the two scans: paper sits
at 186 to 198, ink under 60). Pages are set at their printed size, 300 DPI
being what the scans are at the width the book prints them, staggered a
half-step row to row and each tilted a few degrees from a fixed list, so the
repeats do not line up into a grid. Deterministic: the same inputs give the
same bytes.
"""

import argparse

from PIL import Image

PAPER = 165
INK = 60
# After the ramp, anything this light is the scan's paper or the shadow along
# a page edge (M.'s page has one down its left side), never a stroke: cleared
# to white so a tinted ground does not print a faint grey bar beside a page.
CLEAR_ABOVE = 200
TILTS = (-4.0, 2.5, -1.5, 3.5, -3.0, 1.5)


def clean(path: str, box: tuple[int, int, int, int] | None) -> Image.Image:
    page = Image.open(path).convert("L")
    if box:
        page = page.crop(box)
    ramp = [max(0, min(255, round((v - INK) * 255 / (PAPER - INK)))) for v in range(256)]
    lut = [255 if t > CLEAR_ABOVE else t for t in ramp]
    return page.point(lut)


def trim(page: Image.Image) -> Image.Image:
    """Cut the page to its ink, plus a margin, so blocks space by what is written."""
    ink = page.point(lambda v: 255 if v < 128 else 0)
    box = ink.getbbox()
    if not box:
        return page
    m = 30
    x0, y0, x1, y1 = box
    return page.crop((max(0, x0 - m), max(0, y0 - m), min(page.width, x1 + m), min(page.height, y1 + m)))


def tilted(page: Image.Image, degrees: float) -> Image.Image:
    return page.rotate(degrees, resample=Image.BICUBIC, expand=True, fillcolor=255)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("m")
    ap.add_argument("kh")
    ap.add_argument("out")
    ap.add_argument("--kh-crop", default="0,740,1236,1683")
    ap.add_argument("--m-crop", default="0,0,1221,1900")
    ap.add_argument("--width-in", type=float, default=17.0)
    ap.add_argument("--height-in", type=float, default=11.5)
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--gap", type=int, default=90, help="pixels between pages")
    args = ap.parse_args()

    box = lambda s: tuple(int(v) for v in s.split(","))  # noqa: E731
    m = trim(clean(args.m, box(args.m_crop)))
    kh = trim(clean(args.kh, box(args.kh_crop)))

    width, height = round(args.width_in * args.dpi), round(args.height_in * args.dpi)
    field = Image.new("L", (width, height), 255)

    # One column of the pattern is an M. page beside two K.H. replies stacked;
    # their heights nearly agree, which is what lets the brick close up.
    col_w = m.width + kh.width + args.gap * 2
    row_h = max(m.height, kh.height * 2 + args.gap) + args.gap
    k = 0
    row = 0
    y = -row_h // 3
    while y < height:
        x = -(col_w // 2) * (row % 2) - col_w // 4
        while x < width:
            for page, dx, dy in (
                (m, 0, 0),
                (kh, m.width + args.gap, 0),
                (kh, m.width + args.gap, kh.height + args.gap),
            ):
                t = tilted(page, TILTS[k % len(TILTS)])
                k += 1
                cx = x + dx + page.width // 2 - t.width // 2
                cy = y + dy + page.height // 2 - t.height // 2
                # Darken-only paste: where two tilted pages overlap, ink wins.
                region = field.crop((cx, cy, cx + t.width, cy + t.height))
                field.paste(Image.composite(t, region, t.point(lambda v: 255 if v < 250 else 0)), (cx, cy))
            x += col_w
        y += row_h
        row += 1

    field.save(args.out, dpi=(args.dpi, args.dpi), optimize=True)
    print(f"{args.out}: {width} x {height} px at {args.dpi} DPI")


if __name__ == "__main__":
    main()
