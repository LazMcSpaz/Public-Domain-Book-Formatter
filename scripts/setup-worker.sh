#!/usr/bin/env bash
#
# Set this machine up to do the browser work: render, OCR, second reader,
# layout, export. Written for Ubuntu under WSL2 on Windows, which is where
# it is used, and it will run on any Debian-ish Linux.
#
# It checks rather than assumes, and stops at the first thing that is wrong
# instead of carrying on and failing later somewhere confusing.
#
#   bash setup-worker.sh
#
set -euo pipefail

FORMATTER=https://github.com/LazMcSpaz/Public-Domain-Book-Formatter.git
SHELF=https://github.com/LazMcSpaz/Public-Domain-Books-Storage.git
ROOT="${WORKER_ROOT:-$HOME/books}"

say () { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die () { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- where am I
say "Checking the machine"
[ -f /proc/version ] || die "this is not Linux. Run it inside Ubuntu, not PowerShell."
grep -qi microsoft /proc/version && echo "  WSL2 detected" || echo "  native Linux"
case "$ROOT" in
  /mnt/*) die "$ROOT is a Windows drive. WSL2 reads those slowly and a git repo
       with thousands of small files will crawl. Use a path under \$HOME
       (the default), and keep the external drive for bulky files." ;;
esac
echo "  cores: $(nproc)   memory: $(free -g | awk '/^Mem:/{print $2}') GB"
echo "  installing into: $ROOT"

# ------------------------------------------------------------------- node 22
say "Node 22"
# 22 and not newer: the shelf scripts read TypeScript through Node's
# strip-only mode, which landed behind a flag in 22.6. Ubuntu's own apt node
# is far older than that, so nvm is used rather than the distro package.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
else
  echo "  already on $(node -v)"
fi
command -v node >/dev/null || die "node still not on PATH. Open a new terminal and run this again."

# ------------------------------------------------------------ system packages
# Kept as its own step, and loudly, because of what it asks for. This used to
# sit under the "GitHub access" heading below, so the screen announced GitHub
# and the very next line was a password prompt — from `sudo`, wanting the
# Ubuntu account password. Typing the GitHub one there is the only reasonable
# thing to do, and it fails three times and aborts the run.
if ! command -v gh >/dev/null; then
  say "Installing gh — sudo will ask for your UBUNTU password"
  cat <<'NOTE'
  This is the password you chose when Ubuntu first started on this machine.
  It is NOT your GitHub password. GitHub is signed into further down, in a
  browser, and never asks for a password here at all.

  Nothing is shown as you type — no dots, no stars. That is normal.
NOTE
  sudo apt-get update -qq
  sudo apt-get install -y -qq gh git
fi

# -------------------------------------------------------------------- github
say "GitHub access"
# The shelf is private, so a clone needs credentials. `gh` is used because it
# also wires up git's credential helper, which nothing else here has to know
# about afterwards. It signs in through a browser and a one-time code; GitHub
# has not accepted a password for git operations since 2021.
gh auth status >/dev/null 2>&1 || {
  echo "  a browser window will open — sign in, then come back here"
  gh auth login -h github.com -p https -w
}
gh auth setup-git

# CRLF would rewrite every one of the 1.9 million words in reference/.
git config --global core.autocrlf false
git config --global core.eol lf

# -------------------------------------------------------------------- clones
say "Cloning"
mkdir -p "$ROOT"
cd "$ROOT"
[ -d Public-Domain-Book-Formatter ] || git clone "$FORMATTER"
[ -d Public-Domain-Books-Storage ]  || git clone "$SHELF"

# --------------------------------------------------------------- the browser
say "Dependencies and Chromium"
cd "$ROOT/Public-Domain-Book-Formatter"
npm install
# Playwright's own copy, in its own cache. `drive.mjs` finds it on its own
# now: CHROMIUM_PATH wins if set, the sandbox's vendored browser is used when
# it exists, and otherwise Playwright launches what it installed.
npx playwright install --with-deps chromium

# --------------------------------------------------------------------- prove
say "Proving it works"
npm test
echo
echo "  2,330 tests is the whole suite and it needs no browser."

say "Done"
cat <<EOF
  Everything is at $ROOT

  Start a driver:
    cd $ROOT/Public-Domain-Book-Formatter
    npm run dev &
    node scripts/drive.mjs serve &

  Start several, one per job, each with its own port and profile:
    DRIVE_PORT=7788 DRIVE_PROFILE=.drive-1 node scripts/drive.mjs serve &
    DRIVE_PORT=7789 DRIVE_PROFILE=.drive-2 node scripts/drive.mjs serve &

  On $(nproc) cores, about $(( $(nproc) / 2 )) drivers at once is comfortable.
  Give each one roughly two cores and two gigabytes.
EOF
