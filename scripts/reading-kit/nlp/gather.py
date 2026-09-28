"""Gather reader output of any batch size into the ten-leaf files land.mjs reads.

    python3 scripts/reading-kit/nlp/gather.py <kit> <from> <to>

An output filter stops some readers of a copyrighted book, and a stretch is
then re-read as halves or single leaves (done/140-144.json, done/145-145.json).
This folds every done/*.json whose leaves fall in <from>..<to> into
done/NNN-NNN.json by tens, the later file winning where two cover one leaf,
and names every leaf no reader covered: land.mjs keeps the cleaned draft for
those, which is the study standard's floor.
"""
import glob, json, os, re, sys

kit, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
pages = {}
files = []
for f in glob.glob(os.path.join(kit, 'done', '*.json')):
    m = re.search(r'(\d{3})-(\d{3})\.json$', f)
    if not m:
        continue
    a, b = int(m.group(1)), int(m.group(2))
    if b < lo or a > hi:
        continue
    files.append((b - a, os.path.getmtime(f), f))
# Wider files first, so a narrower re-read of the same leaves wins.
for _, _, f in sorted(files, key=lambda t: (-t[0], t[1])):
    try:
        for p in json.load(open(f)):
            if lo <= p['leaf'] <= hi:
                pages[p['leaf']] = p
    except Exception as e:
        print('unreadable', f, e)
for s in range(lo, hi + 1, 10):
    e = min(s + 9, hi)
    out = [pages[n] for n in range(s, e + 1) if n in pages]
    json.dump(out, open(os.path.join(kit, 'done', f'{s:03d}-{e:03d}.json'), 'w'), ensure_ascii=False, indent=1)
missing = [n for n in range(lo, hi + 1) if n not in pages]
print(f'{hi - lo + 1 - len(missing)} of {hi - lo + 1} leaves read', f'— draft kept for {missing}' if missing else '')
