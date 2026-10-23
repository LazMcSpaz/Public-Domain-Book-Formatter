#!/usr/bin/env python3
"""Turn an unpacked EPUB's PNG pictures into JPEGs sized for a screen.

    python3 scripts/epub-shrink-images.py <epub-dir> [--max-width 1600] [--quality 85]

The shelf keeps a picture as the PNG it was cut or supplied as, at print
resolution, because the printed page needs every pixel. A Kindle does not, and
Kindle delivery is charged by the megabyte at the 70% royalty: the twenty-five
plates of the Hall lectures are 15 MB as PNG and well under 2 MB as JPEG at
1600 pixels, which is wider than any phone and most tablets draw them. The
cover (`images/cover.jpg`) is left as it came.

Every reference is rewritten with the file — the `src` in each page and the
manifest item's `href` and `media-type` — so the package stays valid. A
picture with no colour in it is written as a grey JPEG, which is smaller
still and prints the same on a grey screen.
"""
import argparse
import os
import re
import sys

from PIL import Image, ImageChops

ap = argparse.ArgumentParser()
ap.add_argument('epub_dir')
ap.add_argument('--max-width', type=int, default=1600)
ap.add_argument('--quality', type=int, default=85)
args = ap.parse_args()

oebps = os.path.join(args.epub_dir, 'OEBPS')
images = os.path.join(oebps, 'images')
if not os.path.isdir(images):
    sys.exit(f'no images directory under {oebps}')

renamed: dict[str, str] = {}
before = after = 0
for name in sorted(os.listdir(images)):
    if not name.lower().endswith('.png'):
        continue
    src = os.path.join(images, name)
    before += os.path.getsize(src)
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'P'):
        # Flatten any transparency onto white: a JPEG has no alpha, and the
        # page behind a plate is white.
        bg = Image.new('RGB', im.size, 'white')
        bg.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[-1])
        im = bg
    rgb = im.convert('RGB')
    # Grey if no pixel has colour worth keeping: the widest gap between any
    # two channels, over the whole picture, under a scanner's own tint.
    r, g, b = rgb.split()
    spread = max(
        ImageChops.difference(r, g).getextrema()[1],
        ImageChops.difference(g, b).getextrema()[1],
        ImageChops.difference(r, b).getextrema()[1],
    )
    out_im = rgb if spread > 24 else rgb.convert('L')
    if out_im.width > args.max_width:
        h = round(out_im.height * args.max_width / out_im.width)
        out_im = out_im.resize((args.max_width, h), Image.LANCZOS)
    new_name = name[:-4] + '.jpg'
    dst = os.path.join(images, new_name)
    out_im.save(dst, 'JPEG', quality=args.quality, optimize=True, progressive=False)
    os.remove(src)
    after += os.path.getsize(dst)
    renamed[name] = new_name

if not renamed:
    print('no PNG pictures to convert')
    sys.exit(0)

for root, _dirs, files in os.walk(oebps):
    for f in files:
        if not (f.endswith('.xhtml') or f.endswith('.opf')):
            continue
        p = os.path.join(root, f)
        text = open(p, encoding='utf-8').read()
        new = text
        for old, nn in renamed.items():
            new = new.replace(f'images/{old}', f'images/{nn}')
        if f.endswith('.opf'):
            new = re.sub(
                r'(<item id="img\d+" href="images/[^"]+\.jpg" media-type=")image/png(")',
                r'\1image/jpeg\2',
                new,
            )
        if new != text:
            open(p, 'w', encoding='utf-8').write(new)

print(f'{len(renamed)} pictures: {before / 1048576:.1f} MB as PNG -> {after / 1048576:.1f} MB as JPEG')
