"""The assembled book as one Markdown file, for study and synthesis.

    python3 scripts/reading-kit/nlp/text-md.py <body.json> <book.json> <out.md> "<title line>"

Reads `drive.mjs body` output (the edited blocks, in reading order) and
writes headings as #/##/###, paragraphs as paragraphs, boxes as block
quotes, captions in italics. Emphasis tags are kept as Markdown. The book's
own footnotes follow the paragraph that carries their mark, as `body`
reports it from the engine's pairing; any it could not place close the file. A view of
book.json, regenerated after every stretch; nothing reads it back.
"""
import json, re, sys

body, book, out, title = sys.argv[1:5]
b = json.load(open(body))
# `body` carries no heading level; the transcriptions do. A block id is
# `p<leaf>b<index>` into that leaf's transcribed blocks, so each heading is
# looked up by its own id: pairing the two lists by position broke the day
# one heading in the book was not a heading in the body (a run of headings
# joined into one chapter, a retype).
run = json.load(open(book))['run']
by_leaf = {p['pageIndex']: p['blocks'] for p in run['transcriptions']}
# A `retype` edit is the later word on a heading's level, so it wins.
retyped = {e['blockId']: e.get('level') for e in run.get('edits', []) if e.get('kind') == 'retype'}
for x in b['edited']:
    if x['kind'] != 'heading':
        continue
    m = re.match(r'p(\d+)b(\d+)', x['id'])
    blocks = by_leaf.get(int(m[1]), []) if m else []
    i = int(m[2]) if m else -1
    if x['id'] in retyped:
        x['level'] = retyped[x['id']]
    elif 0 <= i < len(blocks) and blocks[i].get('kind') == 'heading':
        x['level'] = blocks[i].get('level')
def md(t):
    t = re.sub(r'</?i>', '*', t)
    t = re.sub(r'</?b>', '**', t)
    return t.strip()
notes = (b.get('notes') or {}).get('edited') or []
under = {}
for n in notes:
    if n.get('block'):
        under.setdefault(n['block'], []).append(n)
lines = [f'# {title}', '', '_Transcribed for study from the scan; read at the study standard (words and structure checked against the page; spacing, quotation style and most italics not). Not for publication._', '']
for x in b['edited']:
    t = md(x['text'])
    if not t:
        continue
    k = x['kind']
    if k == 'heading':
        lv = min(int(x.get('level') or 2), 3)
        lines += ['#' * (lv + 1) + ' ' + t, '']
    elif k == 'blockquote':
        lines += ['> ' + t.replace('\n', '\n> '), '']
    elif k == 'caption':
        lines += [f'_{t}_', '']
    elif k == 'footnote':
        lines += [f'> Note: {t}', '']
    else:
        lines += [t, '']
    for n in under.get(x['id'], []):
        lines += [f"> {n.get('marker', '')} {md(n['text'])}", '']
loose = [n for n in notes if 'block' in n and not n['block']]
if loose:
    lines += ['## Notes the text does not mark', '']
    for n in loose:
        lines += [f"> {n.get('marker', '')} {md(n['text'])}", '']
open(out, 'w').write('\n'.join(lines))
print(out, sum(len(l.split()) for l in lines), 'words')
