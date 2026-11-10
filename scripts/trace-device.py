#!/usr/bin/env python3
"""Trace a line drawing from a scan into a device SVG: filled outlines, evenodd.

    python3 scripts/trace-device.py <scan.png> <out.svg> [--crop x0,y0,x1,y1] \
        [--paper 160] [--ink 70] [--scale 3] [--speck 40]

Made for the chain-of-globes diagram in Barker's facsimiles of *The Mahatma
Letters* (1923), whose scan holds about 4.7 in of drawing at 300 DPI: enough
for the page, not for a 7 × 10 cover, where it would print soft. Traced, the
lines are outlines and print sharp at any size, which is the rule every other
device in `public/devices` follows.

The scan is cleaned as the handwriting ground is (paper to white, ink to
black, a linear ramp between), cut to `--crop`, enlarged `--scale` times with
a smooth filter so a one-pixel stroke traces as a stroke rather than a stair,
thresholded at the middle, and handed to potrace (`pip install potracer`, the
pure-Python port). `--speck` is potrace's turdsize in enlarged pixels: dust
on the scan smaller than that is dropped. Output coordinates are in source
pixels, so a viewBox measured off the scan is the viewBox of the trace, and
`--viewbox` sets one: a device is framed by its box, so padding the box until a
measured centre is its centre is how a figure is made to sit square on.
"""

import argparse

import numpy as np
import potrace
from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scan")
    ap.add_argument("out")
    ap.add_argument("--crop")
    ap.add_argument("--paper", type=int, default=160)
    ap.add_argument("--ink", type=int, default=70)
    ap.add_argument("--scale", type=int, default=3)
    ap.add_argument("--speck", type=int, default=40)
    ap.add_argument("--title", default="")
    ap.add_argument("--viewbox", help="'x y w h' in source pixels; the drawing's own box if left out")
    args = ap.parse_args()

    page = Image.open(args.scan).convert("L")
    if args.crop:
        page = page.crop(tuple(int(v) for v in args.crop.split(",")))
    ramp = [max(0, min(255, round((v - args.ink) * 255 / (args.paper - args.ink)))) for v in range(256)]
    page = page.point(ramp)
    big = page.resize((page.width * args.scale, page.height * args.scale), Image.LANCZOS)
    # potracer fills where the array is false, so the ink is passed as the
    # complement: traced the plain way round, it fills the paper and leaves
    # the lines as holes.
    ink = np.asarray(big) >= 128

    path = potrace.Bitmap(ink).trace(
        turdsize=args.speck, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
        alphamax=1.0, opticurve=True, opttolerance=0.2,
    )

    k = 1.0 / args.scale
    f = lambda p: f"{p.x * k:.2f} {p.y * k:.2f}"  # noqa: E731
    parts = []
    for curve in path:
        parts.append(f"M{f(curve.start_point)}")
        for seg in curve.segments:
            if seg.is_corner:
                parts.append(f"L{f(seg.c)}L{f(seg.end_point)}")
            else:
                parts.append(f"C{f(seg.c1)} {f(seg.c2)} {f(seg.end_point)}")
        parts.append("Z")

    title = f"\n  <title>{args.title}</title>" if args.title else ""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{args.viewbox or f"0 0 {page.width} {page.height}"}">{title}\n'
        f'  <path fill="#141414" fill-rule="evenodd" d="{"".join(parts)}"/>\n</svg>\n'
    )
    with open(args.out, "w") as out:
        out.write(svg)
    print(f"{args.out}: {len(path)} outlines over {page.width} x {page.height}, {len(svg) // 1024} KB")


if __name__ == "__main__":
    main()
