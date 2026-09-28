"""One-leaf briefs and prompts for leaves a filtered reader could not finish.

    python3 scripts/reading-kit/nlp/singles.py <kit> <brief-name> [leaf...]

Splits <kit>/briefs/<brief-name>.json into briefs/NNN-NNN.json, one leaf
each (all its leaves unless some are named), with a prompt beside each.
"""
import json, os, sys

kit, name, *only = sys.argv[1:]
here = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(here, 'PROMPT.md')).read().replace('BOOKNOTES', open(os.path.join(kit, 'BOOK.md')).read().strip())
for leaf in json.load(open(os.path.join(kit, 'briefs', f'{name}.json'))):
    n = leaf['leaf']
    if only and str(n) not in only:
        continue
    b = f'{n:03d}-{n:03d}'
    json.dump([leaf], open(os.path.join(kit, 'briefs', f'{b}.json'), 'w'), ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(kit, 'work', b), exist_ok=True)
    s = tpl.replace('BRIEF', f'{kit}/briefs/{b}.json').replace('WORKDIR', f'{kit}/work/{b}/').replace('OUTFILE', f'{kit}/done/{b}.json').replace('up to ten leaves', 'one leaf')
    open(os.path.join(kit, 'work', b, 'prompt.md'), 'w').write(s)
    print(b)
