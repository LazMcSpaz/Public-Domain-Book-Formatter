# A second machine to do the work

Every job on this shelf that touches a browser — render, OCR, the second
reader, layout, writing the PDF — runs headlessly and takes its port, its
profile and its output directory from the environment. So it runs anywhere,
and more than one of it runs at once.

This is how to set up an always-on machine to be that worker.

## What it buys, and what it does not

**It buys throughput.** The container these sessions run in has four cores
and holds one driver comfortably. A desktop holds several, and they do not
interfere: measured here, two drivers on different ports with different
profiles ran side by side, each with its own book store, and a job on the
first never noticed the second.

On a twelve-core machine, five or six drivers is comfortable — about two
cores and two gigabytes each, since Chromium and a Tesseract worker will
happily eat a whole one between them. The work currently queued behind a
single driver is around four thousand leaf operations, which is three hours
here and closer to thirty minutes there.

**It buys durability.** This container reverts its checkouts without warning
and reclaims itself when idle. Work in a scratchpad on it is work waiting to
be lost, which is why `reference/blavatsky` was pushed to the shelf the hour
it existed.

**It does not, by itself, reduce Claude usage.** That is driven by how many
turns the assistant takes, not by where the compute runs; a chunk OCR'd on
your machine costs the same turn as one OCR'd here. The saving comes from
the machine running a job **unattended** and pushing the result to the shelf,
so the assistant starts it once and reads it once instead of supervising it.
Always-on is what makes that worth doing.

## Windows: use WSL2

Everything here is POSIX — bash scripts, forward slashes, a Linux Chromium.
Node and Playwright do run natively on Windows, and the cost of that is two
versions of every script from now on. WSL2 removes the question.

It is a built-in Windows feature and technically a virtual machine, but not
the kind with a window and a boot sequence: a terminal opens in about two
seconds, memory is shared rather than reserved, and the Windows drives are
mounted under `/mnt/`. One command installs it, as administrator in
PowerShell, followed by one reboot:

```powershell
wsl --install
```

That installs Ubuntu by default and asks for a username and password.

**Keep the repositories inside WSL, not on a Windows drive.** WSL2 reads
`/mnt/c` and `/mnt/e` slowly, and a repository of thousands of small files
is the worst case for it. The two repositories are about 1.6 GB together,
which is nothing; an external drive is the right home for bulky things that
are not in git, such as the _Isis Unveiled_ scans that are too large for
GitHub to hold at all.

## Setting it up

```bash
bash scripts/setup-worker.sh
```

It installs Node 22 through nvm, installs and authenticates `gh`, clones
both repositories, installs the dependencies and Playwright's Chromium, and
then runs the full test suite to prove the checkout is sound. It refuses to
install onto a `/mnt/` path, and it stops at the first thing that is wrong
rather than failing later somewhere confusing.

**Node 22 specifically, not newer and not older.** Several shelf scripts
read TypeScript modules through Node's strip-only mode, which arrived behind
a flag in 22.6; Ubuntu's own packaged Node is far older. `nvm` is used rather
than the distribution package for that reason.

**`core.autocrlf` is set to false** before anything is cloned. The shelf
carries `reference/blavatsky` as plain text, and Windows line endings would
rewrite all 1.9 million words of it.

## Running several drivers

```bash
npm run dev &
DRIVE_PORT=7788 DRIVE_PROFILE=.drive-1 DRIVE_OUT=out-1 node scripts/drive.mjs serve &
DRIVE_PORT=7789 DRIVE_PROFILE=.drive-2 DRIVE_OUT=out-2 node scripts/drive.mjs serve &
```

One Vite server serves them all. **The separate profile is the part that
matters**: the profile directory holds IndexedDB, which is where a book's
run lives, so two drivers sharing one profile would be two browsers editing
one store. Separate profiles make them independent — which also means each
driver must be told which book it is working on.

`CHROMIUM_PATH` overrides which browser is launched. It is rarely needed:
the driver uses the sandbox's vendored Chromium when that exists and
otherwise lets Playwright launch the copy it installed. Before that check
existed the sandbox path was hardcoded, which was invisible here and fatal
on any other machine — the launch failed with a missing executable, which
reads like a broken install rather than a path that was only ever right in
one place.
