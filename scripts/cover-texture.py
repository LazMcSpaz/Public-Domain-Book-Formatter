#!/usr/bin/env python3
"""Prepare a picture as a cover's ground texture: ink on white, on a canvas the size of its box.

    python3 scripts/cover-texture.py <in> <out.png> --box <w>x<h> [--crop x0,y0,x1,y1]
        [--levels 70,205] [--drop-red 55] [--fade-top 0.07] [--height-in 8.79]
        [--align 0,1] [--dpi 300]

The cover composer tints a texture like every ground figure: its dark is the
ink, its white is the board. So the file it is given is greyscale ink on
white, and when the picture should sit in its box at a size and place of its
own (not simply cover the box), it is laid on a white canvas of the box's own
proportions first, so the composer's `scale: 1` puts it exactly there.

The box's size is printed by `node scripts/cover-front.mjs` as "ground figure
box" for the spec's placement (for example the box inside the frame's inner
rule for `on-rule`). The picture itself stays with the book on the shelf or
in storage; neither it nor what this makes goes into the tools repository.

In order, each step only when asked:

- `--crop x0,y0,x1,y1`: cut the picture out of a larger scan, in its pixels.
- greyscale, then `--levels lo,hi` (default 70,205): at or below `lo` is ink,
  at or above `hi` is paper, a straight ramp between.
- `--drop-red d`: pixels whose red exceeds their green by more than `d`
  (red lettering printed over a drawing) are turned to paper first.
- `--fade-top f`: the top `f` of the picture (a fraction of its height) fades
  in from paper, for a picture cut through at its head.
- `--height-in h` with `--box`: the picture is set `h` inches tall on a white
  canvas of the box, at `--align x,y` (0 to 1 each way; `0,1` is its left edge
  and foot on the box's, the default `0.5,0.5` centred). The resolution is the
  picture's own (its height in pixels over `h`), so nothing is enlarged;
  `--dpi` instead resamples to that many pixels per inch.

Without `--height-in` the toned picture is written as it is, and the spec's
`scale` and `align` place it.

Needs Pillow.
"""

import argparse
import sys

from PIL import Image, ImageChops


def pair(text, kind=float):
    parts = [kind(p) for p in text.split(',')]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f'want two numbers separated by a comma: {text}')
    return tuple(parts)


def box_size(text):
    try:
        w, h = (float(p) for p in text.lower().split('x'))
    except ValueError:
        raise argparse.ArgumentTypeError(f'want <width>x<height> in inches: {text}')
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError(f'a box has a width and a height: {text}')
    return w, h


def crop_box(text):
    parts = [int(p) for p in text.split(',')]
    if len(parts) != 4 or parts[2] <= parts[0] or parts[3] <= parts[1]:
        raise argparse.ArgumentTypeError(f'want x0,y0,x1,y1 with x1 > x0 and y1 > y0: {text}')
    return tuple(parts)


def tone(im, lo, hi, drop_red):
    """Greyscale with paper to white and ink to black; red lettering to paper first."""
    rgb = im.convert('RGB')
    grey = rgb.convert('L')
    if drop_red is not None:
        r, g, _ = rgb.split()
        red = ImageChops.subtract(r, g).point(lambda v: 255 if v > drop_red else 0)
        grey = Image.composite(Image.new('L', grey.size, 255), grey, red)
    span = max(1, hi - lo)
    return grey.point(lambda v: 0 if v <= lo else 255 if v >= hi else round((v - lo) * 255 / span))


def fade_top(im, fraction):
    """The top `fraction` of the picture rises from paper to its full ink."""
    n = round(im.height * fraction)
    if n <= 0:
        return im
    ramp = Image.linear_gradient('L').resize((im.width, n))  # 0 at the top, 255 at the foot
    head = im.crop((0, 0, im.width, n))
    paper = Image.new('L', head.size, 255)
    out = im.copy()
    out.paste(Image.composite(head, paper, ramp), (0, 0))
    return out


def place(im, box_in, height_in, align, dpi):
    """The picture `height_in` tall on a white canvas of the box, at `align`."""
    ppi = dpi if dpi else im.height / height_in
    if dpi:
        width = max(1, round(im.width * (height_in * ppi) / im.height))
        im = im.resize((width, round(height_in * ppi)), Image.LANCZOS)
    canvas = Image.new('L', (round(box_in[0] * ppi), round(box_in[1] * ppi)), 255)
    x = round((canvas.width - im.width) * align[0])
    y = round((canvas.height - im.height) * align[1])
    canvas.paste(im, (x, y))
    return canvas, ppi


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--box', type=box_size, help='the box the texture fills, <w>x<h> inches')
    ap.add_argument('--crop', type=crop_box)
    ap.add_argument('--levels', type=lambda t: pair(t, int), default=(70, 205))
    ap.add_argument('--drop-red', type=int, default=None)
    ap.add_argument('--fade-top', type=float, default=0.0)
    ap.add_argument('--height-in', type=float, default=None)
    ap.add_argument('--align', type=pair, default=(0.5, 0.5))
    ap.add_argument('--dpi', type=float, default=None)
    a = ap.parse_args(argv)

    if a.height_in is not None and a.box is None:
        ap.error('--height-in sets the picture in a box: give --box too')
    if not all(0 <= v <= 1 for v in a.align):
        ap.error('--align wants two fractions from 0 to 1')
    if not 0 <= a.fade_top < 1:
        ap.error('--fade-top is a fraction of the height, from 0 to under 1')

    im = Image.open(a.src)
    if a.crop:
        im = im.crop(a.crop)
    im = tone(im, a.levels[0], a.levels[1], a.drop_red)
    if a.fade_top:
        im = fade_top(im, a.fade_top)
    if a.height_in is not None:
        if a.height_in > a.box[1]:
            ap.error('--height-in is taller than the box')
        im, ppi = place(im, a.box, a.height_in, a.align, a.dpi)
        print(f'{a.out}: {im.width} x {im.height} px, {ppi:.1f} px per inch, box {a.box[0]} x {a.box[1]} in')
    else:
        print(f'{a.out}: {im.width} x {im.height} px')
    im.save(a.out, optimize=True)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
