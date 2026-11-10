#!/usr/bin/env python3
"""A KDP cover as one opaque picture, at the cover file's own page size.

    python3 scripts/flatten-cover.py <cover.pdf> <cover-flat.pdf> [--dpi 300]

The cover composer writes a cover with a soft mask in it (the ground figure is
drawn translucent), and KDP's processor stalled on the Manuscript Lectures'
cover for an hour and a half before erroring, as it had on the first upload.
The same cover rendered to one 300 DPI image laid on white and wrapped back at
the original page size went through. So the file KDP is given is the flat one,
and the composed PDF stays beside it as the source.

This existed once before as a script in one session's scratch space, and went
when the session did; the shelf's cover READMEs still named it. It is here so
the next cover does not have to rebuild it from that description.

What it does, and nothing else: `pdftoppm` renders the one page at `--dpi`,
any transparency is composited onto white, the picture is written as a JPEG
(the existing flat covers are one RGB JPEG each), and `img2pdf` wraps it at
exactly the page size the cover file declares, so the spine and the bleed
stay where the composer put them. It refuses a cover file of more than one
page, since a KDP cover is always a single flat sheet.

Needs poppler's `pdftoppm` and `pdfinfo`, Pillow and img2pdf
(`pip install img2pdf`).
"""

import argparse
import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import img2pdf
from PIL import Image


def page_size_pt(pdf: Path) -> tuple[float, float, int]:
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    size = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", info)
    pages = re.search(r"Pages:\s+(\d+)", info)
    if not size or not pages:
        raise SystemExit(f"pdfinfo gave no page size for {pdf}")
    return float(size.group(1)), float(size.group(2)), int(pages.group(1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cover")
    ap.add_argument("out")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    src, out = Path(args.cover), Path(args.out)
    width_pt, height_pt, pages = page_size_pt(src)
    if pages != 1:
        raise SystemExit(f"{src} has {pages} pages; a KDP cover is one flat sheet")

    with tempfile.TemporaryDirectory() as tmp:
        stem = Path(tmp) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(args.dpi), "-png", "-singlefile", str(src), str(stem)],
            check=True,
        )
        picture = Image.open(f"{stem}.png")
        picture.load()

    if picture.mode in ("RGBA", "LA", "P"):
        rgba = picture.convert("RGBA")
        white = Image.new("RGB", rgba.size, (255, 255, 255))
        white.paste(rgba, mask=rgba.split()[3])
        picture = white
    else:
        picture = picture.convert("RGB")

    jpeg = io.BytesIO()
    picture.save(jpeg, format="JPEG", quality=args.quality, dpi=(args.dpi, args.dpi))
    layout = img2pdf.get_layout_fun(pagesize=(width_pt, height_pt), fit=img2pdf.FitMode.exact)
    out.write_bytes(img2pdf.convert(jpeg.getvalue(), layout_fun=layout))

    w2, h2, _ = page_size_pt(out)
    if abs(w2 - width_pt) > 0.05 or abs(h2 - height_pt) > 0.05:
        raise SystemExit(f"wrote {w2} x {h2} pt where the cover is {width_pt} x {height_pt}")
    print(f"{out}: {picture.width} x {picture.height} px at {args.dpi} DPI, {w2} x {h2} pt")


if __name__ == "__main__":
    sys.exit(main())
