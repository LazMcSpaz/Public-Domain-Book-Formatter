# After land.mjs, before transcribe: page roles, a note's mark spaced and
# declared as `marker`, and blocks a reader reported as two paragraphs split
# at the words the second opens with (rule 8 of PROMPT.md).
#   python3 scripts/reading-kit/lostkeys/post.py <kit> <NNN-NNN> '<spec json>'
#   spec: {"openings": [leaf…], "roles": {"leaf": role}, "splits": [[leaf, "words"]]}
import json,re,sys
# 2) the landed batch: roles, note marks, and named splits
K,tag=sys.argv[1],sys.argv[2]
spec=json.loads(sys.argv[3])   # {"openings":[..], "roles":{leaf:role}, "splits":[[leaf, "words the new paragraph opens with"]]}
p=f'{K}/batch-{tag}.json'
d=json.load(open(p))
openings=set(spec.get('openings',[])); roles={int(k):v for k,v in spec.get('roles',{}).items()}
for pg in d:
    pg['role']=roles.get(pg['pageIndex'], 'chapter-opening' if pg['pageIndex'] in openings else 'body')
    for b in pg['blocks']:
        if b['kind']=='footnote':
            b['text']=re.sub(r'^(\*{1,3}|†{1,2}|‡{1,2})(?=\S)', r'\1 ', b['text'])
            m=re.match(r'^(\*{1,3}|†{1,2}|‡{1,2}) ', b['text'])
            if m and not b.get('marker'): b['marker']=m.group(1)
for leaf,words in spec.get('splits',[]):
    pg=next(x for x in d if x['pageIndex']==leaf)
    hits=[(i,b) for i,b in enumerate(pg['blocks']) if words in b['text'] and not b['text'].startswith(words)]
    assert len(hits)==1, (leaf,words,len(hits))
    i,b=hits[0]; k=b['text'].index(words)
    assert 'emphasis' not in b and 'strong' not in b and 'parts' not in b
    pg['blocks'][i:i+1]=[dict(b,text=b['text'][:k].rstrip()),{'kind':b['kind'],'text':b['text'][k:]}]
    print('  split', leaf, repr(b['text'][max(0,k-30):k+30]))
json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
print('roles:', {r:sum(1 for x in d if x['role']==r) for r in set(x['role'] for x in d)})
