"""The assembled book as one Markdown file, for study and synthesis.

    python3 scripts/reading-kit/nlp/text-md.py <body.json> <book.json> <out.md> "<title line>"

Reads `drive.mjs body` output (the edited blocks, in reading order) and
writes headings as #/##/###, paragraphs as paragraphs, boxes as block
quotes, captions in italics. Emphasis tags are kept as Markdown. A view of
book.json, regenerated after every stretch; nothing reads it back.
"""
import json, re, sys

body, book, out, title = sys.argv[1:5]
b = json.load(open(body))
# `body` carries no heading level; the transcriptions do, in the same order.
levels = [bl.get('level') for p in json.load(open(book))['run']['transcriptions'] for bl in p['blocks'] if bl['kind'] == 'heading' and bl['text'].strip()]
heads = [x for x in b['edited'] if x['kind'] == 'heading']
if len(levels) != len(heads):
    sys.exit(f'{len(heads)} headings in the body, {len(levels)} in the book: cannot pair levels')
for x, lv in zip(heads, levels):
    x['level'] = lv
def md(t):
    t = re.sub(r'</?i>', '*', t)
    t = re.sub(r'</?b>', '**', t)
    return t.strip()
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
open(out, 'w').write('\n'.join(lines))
print(out, sum(len(l.split()) for l in lines), 'words')
