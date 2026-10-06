# Before land.mjs: close up any space a reader set before ; : ? !, which
# on this book is the glyph's sidebearing (lostkeys/PROMPT.md).
#   python3 scripts/reading-kit/lostkeys/norm.py <kit> <from> <to>
import json,re,sys,glob
# 1) readers' output: no space before ; : ? !
K,frm,to=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
n=0
for p in sorted(glob.glob(K+'/done/*.json')):
    a,b=map(int,p.split('/')[-1][:-5].split('-'))
    if a<frm or b>to: continue
    d=json.load(open(p))
    for page in d:
        for blk in page.get('blocks',[])+page.get('add',[]):
            t=blk['text']; t2=re.sub(r'(?<=[\w’”\)\]>]) +(?=[;:?!])','',t)
            if t2!=t: n+=1; print('  space closed', page['leaf'], re.findall(r'\S+ [;:?!]',t)); blk['text']=t2
    json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
print('blocks with a space closed:',n)
