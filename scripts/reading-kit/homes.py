"""homes.py <pairs.json> <notes.json> — every footnote whose mark is not on
the leaf that prints the note, or the one before it (a paragraph joined across
a seam puts its mark a leaf early). `drive.mjs pairs` counts marks against
notes, and a book with every count balanced and nothing orphaned can still set
its notes under the wrong marks: three footnotes typed as body text did that to
93 of 123 on Isis Vol. II. The drift shows here as a run of rows, and the first
row is where to look."""
import json, re, sys
pairs = json.load(open(sys.argv[1])); notes = json.load(open(sys.argv[2]))
strip = lambda s: re.sub(r'<[^>]+>', '', s)
# Every leaf that prints a note with these words: a short citation ("Paul
# and Plato.") recurs, and keying on its first setting reported a false drift.
homes = {}
for n in notes: homes.setdefault(strip(n['text'])[:60], set()).add(n['pageIndex'])
off = [(r['leaf'], r['printed'], sorted(homes.get(strip(r['note'])[:60], [])), r['note'][:50])
       for r in pairs['rows']
       if not homes.get(strip(r['note'])[:60], set()) & {r['leaf'], r['leaf'] + 1}]
print(f"{pairs['references']} references, {pairs['notes']} notes, {pairs.get('orphaned', len(pairs.get('orphans', [])))} orphaned; {len(off)} off their leaf")
for o in off[:20]: print('  mark on', o[0], o[1], '→ note on', o[2], '|', o[3])
sys.exit(1 if off or pairs.get('orphaned', len(pairs.get('orphans', []))) else 0)
