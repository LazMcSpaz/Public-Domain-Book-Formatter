#!/bin/bash
# Prepare one stretch of The Secret Doctrine for the readers: draft off the
# text layer, the conversion's damage taken off (rules.mjs), briefs carrying
# the second reading and no image, prompts. The route for a book with no
# pixels (docs/FLOW.md): nothing is rendered, because a render of a ClearScan
# leaf is the text layer drawn again.
#
#   scripts/reading-kit/sd/stretch.sh <kit> <from> <to>
#
# `<kit>` holds second.json (the second reading, keyed by leaf) and
# witness.json (`drive.mjs witness`). Needs the driver up with the book open.
set -u
KIT=$(cd "$1" && pwd); FROM=$2; TO=$3
HERE=$(dirname "$0")
pad() { printf '%03d' "$1"; }
TAG=$(pad $FROM)-$(pad $TO)
mkdir -p "$KIT/done" "$KIT/work"
node scripts/drive.mjs draft "$KIT/draft-$TAG.json" $(seq $FROM $TO) >/dev/null 2>&1 || { echo "draft failed"; exit 1; }
node "$HERE/rules.mjs" "$KIT" "$KIT/draft-$TAG.json" "$KIT/ruled-$TAG.json" | head -1
node scripts/reading-kit/brief.mjs "$KIT" "$KIT/ruled-$TAG.json" $FROM $TO 5 --text-only || exit 1
for s in $(seq $FROM 5 $TO); do
  e=$(( s + 4 > TO ? TO : s + 4 )); b=$(pad $s)-$(pad $e)
  mkdir -p "$KIT/work/$b"
  sed -e "s|BRIEF|$KIT/briefs/$b.json|; s|WORKDIR|$KIT/work/$b/|; s|OUT|$KIT/done/$b.json|; s|KITDIR|$KIT|" "$HERE/PROMPT.md" > "$KIT/work/$b/prompt.md"
done
echo "$TAG briefed: $(ls $KIT/work | grep -c .) prompt(s) under $KIT/work"
