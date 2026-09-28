#!/bin/bash
# One stretch for the NLP books, at the lighter standard: draft, the
# mechanical rules, 300 DPI renders, ten leaves to a brief, prompts from
# nlp/PROMPT.md with the book's own notes (<kit>/BOOK.md) spliced in.
# No second reader: an empty second.json and witness.json stand in.
#
#   scripts/reading-kit/nlp/stretch.sh <kit> <from> <to>
set -u
KIT=$(cd "$1" && pwd); FROM=$2; TO=$3
HERE=$(cd "$(dirname "$0")" && pwd)
pad() { printf '%03d' "$1"; }
TAG=$(pad $FROM)-$(pad $TO)
mkdir -p "$KIT/shots" "$KIT/done" "$KIT/work"
[ -f "$KIT/second.json" ] || echo '{}' > "$KIT/second.json"
[ -f "$KIT/witness.json" ] || echo '{"leaves":[]}' > "$KIT/witness.json"
node scripts/drive.mjs draft "$KIT/draft-$TAG.json" $(seq $FROM $TO) >/dev/null 2>&1 || { echo "draft failed"; exit 1; }
node "$HERE/rules.mjs" "$KIT/draft-$TAG.json" "$KIT/ruled-$TAG.json"
for n in $(seq $FROM $TO); do
  f="$KIT/shots/hi-$(pad $n).png"; [ -s "$f" ] && continue
  node scripts/drive.mjs leaf $n "hi-$n" 300 >/dev/null 2>&1
  src=$(ls -t ${DRIVE_OUT:-screenshots}/hi-$n.png 2>/dev/null | head -1)
  [ -n "$src" ] && mv "$src" "$f"
done
node scripts/reading-kit/brief.mjs "$KIT" "$KIT/ruled-$TAG.json" $FROM $TO 10 || exit 1
for s in $(seq $FROM 10 $TO); do
  e=$(( s + 9 > TO ? TO : s + 9 )); b=$(pad $s)-$(pad $e)
  mkdir -p "$KIT/work/$b"
  python3 - "$HERE/PROMPT.md" "$KIT/BOOK.md" "$KIT/work/$b/prompt.md" "$KIT/briefs/$b.json" "$KIT/work/$b/" "$KIT/done/$b.json" <<'PY'
import sys
tpl, book, out, brief, wd, done = sys.argv[1:]
s = open(tpl).read().replace('BOOKNOTES', open(book).read().strip())
s = s.replace('BRIEF', brief).replace('WORKDIR', wd).replace('OUTFILE', done)
open(out, 'w').write(s)
PY
done
echo "$TAG briefed: $(ls $KIT/work | grep -c .) prompt(s) under $KIT/work"
