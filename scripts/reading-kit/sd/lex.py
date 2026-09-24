#!/usr/bin/env python3
"""How often the Secret Doctrine sets a word, counted off the second reading
(Tesseract over ClearScan's render: whole words, few splits) of Vol. I and
Vol. II, and off Vol. I's ClearScan layer as it stands (which splits words, so
its count is a floor).

  python3 lex.py word [word ...]         counts, case-insensitive, whole words
  python3 lex.py --ctx "phrase" [n]      up to n (default 8) places in Vol. I's
                                         second reading, with the leaf number
"""
import re, sys, json, functools, os
S = os.environ.get('SHELF', '/home/user/Public-Domain-Books-Storage') + '/reference/blavatsky/'
K = os.environ.get('SD_KIT', '/tmp/claude-0/sdk').rstrip('/') + '/'

@functools.lru_cache(None)
def text(name):
    return open(S + name, encoding='utf-8').read()

def leaves():
    return json.load(open(K + 'second.json'))

def count(word, t):
    return len(re.findall(r'(?<![\w])' + re.escape(word) + r'(?![\w])', t, re.I))

args = sys.argv[1:]
if args and args[0] == '--ctx':
    phrase = args[1]; n = int(args[2]) if len(args) > 2 else 8
    shown = 0
    for leaf, t in sorted(leaves().items(), key=lambda kv: int(kv[0])):
        for m in re.finditer(re.escape(phrase), t, re.I):
            print(f'leaf {leaf}: …{t[max(0,m.start()-80):m.end()+80]}…'.replace('\n', ' '))
            shown += 1
            if shown >= n: sys.exit(0)
    if not shown: print('not found')
    sys.exit(0)
w1 = text('secret-doctrine-sd1.txt'); w2 = text('secret-doctrine-sd2.txt')
l1 = text('secret-doctrine-sd1-clearscan.txt')
for w in args:
    print(f'{w!r}: Vol. I {count(w, w1)} (its ClearScan layer {count(w, l1)}), Vol. II {count(w, w2)}')
