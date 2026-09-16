#!/bin/sh
# Restart the dev server and the driver, by killing both first.
#
# "Restart" means kill vite, not check whether the port answers. A script that
# starts vite only when :5173 is silent never restarts it at all, so the
# process that came up at the start of a session goes on serving hours later
# with an in-memory transform cache holding every module as it was before each
# `src/core` edit since (CLAUDE.md, "What has actually gone wrong"). And
# `pkill -f vite` matches the shell running it, so everything here is killed
# by pid from a listing, and the two servers are started detached so they
# outlive this shell.
#
# Usage: sh scripts/restart-servers.sh        then wait ~20s before the first verb.
# The first driver command after a restart often dies with "Target page,
# context or browser has been closed" — retry it once.
cd "$(dirname "$0")/.." || exit 1
LOGS="${PDBF_LOGS:-${TMPDIR:-/tmp}}"
for pattern in "[d]rive.mjs serve" "[p]w-browsers/chromium" "[v]ite --host"; do
  for p in $(ps -eo pid,args | grep "$pattern" | awk '{print $1}'); do kill -9 "$p" 2>/dev/null; done
done
sleep 2
rm -f .drive-profile/SingletonLock .drive-profile/SingletonCookie .drive-profile/SingletonSocket
setsid nohup npx vite --host 127.0.0.1 --port 5173 > "$LOGS/pdbf-vite.log" 2>&1 < /dev/null &
sleep 6
setsid nohup node scripts/drive.mjs serve > "$LOGS/pdbf-drive.log" 2>&1 < /dev/null &
echo "vite and the driver are starting; logs in $LOGS/pdbf-vite.log and $LOGS/pdbf-drive.log"
