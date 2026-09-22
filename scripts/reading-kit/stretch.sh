#!/bin/bash
# Prepare one stretch of leaves for the readers: draft, rules, 400 DPI
# renders, briefs, prompts. Dispatch is the one step that is not here — a
# reader is a subagent, one per brief, given `<kit>/work/<batch>/prompt.md`.
#
#   scripts/reading-kit/stretch.sh <kit> <book-kit-dir> <from> <to>
#
# `<book-kit-dir>` holds the book's PROMPT.md (scripts/reading-kit/glossary).
# Needs the driver up on DRIVE_PORT with the book open (`drive.mjs use`).
set -u
KIT=$(cd "$1" && pwd); BOOK=$2; FROM=$3; TO=$4
pad() { printf '%03d' "$1"; }
TAG=$(pad $FROM)-$(pad $TO)
mkdir -p "$KIT/shots" "$KIT/done" "$KIT/work"
node scripts/drive.mjs draft "$KIT/draft-$TAG.json" $(seq $FROM $TO) >/dev/null 2>&1 || { echo "draft failed"; exit 1; }
node scripts/reading-kit/rules.mjs "$KIT/draft-$TAG.json" "$KIT/ruled-$TAG.json" | head -1
for n in $(seq $FROM $TO); do
  f="$KIT/shots/hi-$(pad $n).png"; [ -s "$f" ] && continue
  node scripts/drive.mjs leaf $n "hi-$n" 400 >/dev/null 2>&1
  # `leaf` writes under the driver's DRIVE_OUT; bring the render into the kit.
  src=$(ls -t ${DRIVE_OUT:-screenshots}/hi-$n.png 2>/dev/null | head -1)
  [ -n "$src" ] && cp "$src" "$f"
done
node scripts/reading-kit/brief.mjs "$KIT" "$KIT/ruled-$TAG.json" $FROM $TO 5 || exit 1
for s in $(seq $FROM 5 $TO); do
  e=$(( s + 4 > TO ? TO : s + 4 )); b=$(pad $s)-$(pad $e)
  mkdir -p "$KIT/work/$b"
  sed -e "s|BRIEF|$KIT/briefs/$b.json|; s|WORKDIR|$KIT/work/$b/|; s|OUT|$KIT/done/$b.json|" "$BOOK/PROMPT.md" > "$KIT/work/$b/prompt.md"
done
echo "$TAG briefed: $(ls $KIT/work | grep -c .) prompt(s) under $KIT/work"
