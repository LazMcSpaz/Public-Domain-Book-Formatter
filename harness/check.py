#!/usr/bin/env python3
"""Harness check. Run from anywhere: python3 harness/check.py  (exit 1 on any failure).
Every failure message says how to fix it."""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "harness" / "rules.json").read_text(encoding="utf-8"))
SKIP = set(R.get("ignore_dirs", [])) | {".git", "node_modules", "target", "build", "dist", "__pycache__", "archive", "harness"}
EXTS = tuple(R.get("source_extensions", []))
fails = []

def walk(pattern="*", base=ROOT):
    for p in base.rglob(pattern):
        if p.is_file() and not any(part in SKIP for part in p.relative_to(ROOT).parts):
            yield p

def rel(p):
    return p.relative_to(ROOT).as_posix()

# 1. Guidance files stay short
lim = R.get("doc_line_limits", {"root": 120, "folder": 60})
for p in walk("CLAUDE.md"):
    n = len(p.read_text(encoding="utf-8").splitlines())
    cap = lim["root"] if p.parent == ROOT else lim["folder"]
    if n > cap:
        fails.append(f"{rel(p)} is {n} lines (limit {cap}). Move detail into docs/ and link to it.")

# 2. Doc links point at real files
for p in walk("*.md"):
    text = re.sub(r"```.*?```", "", p.read_text(encoding="utf-8"), flags=re.S)
    for target in re.findall(r"\]\(([^)#\s]+)", text):
        if "://" in target or target.startswith("mailto:"):
            continue
        if not (p.parent / target).exists():
            fails.append(f"{rel(p)} links to missing '{target}'. Fix the link or restore the file.")

# 3. Every module has its own CLAUDE.md
for m in R.get("modules", []):
    if not (ROOT / m / "CLAUDE.md").exists():
        fails.append(f"Module '{m}' has no CLAUDE.md. Add one from the module template.")

# 4. Source files stay a manageable size
maxl = R.get("max_source_lines", 400)
for p in walk():
    if EXTS and p.suffix in EXTS:
        n = len(p.read_text(encoding="utf-8", errors="ignore").splitlines())
        if n > maxl:
            fails.append(f"{rel(p)} is {n} lines (limit {maxl}). Split it along one clear responsibility.")

# 5. Module boundaries
for b in R.get("boundaries", []):
    base = ROOT / b["from"]
    if not base.exists():
        fails.append(f"Boundary rule refers to missing folder '{b['from']}'. Update rules.json.")
        continue
    rx = re.compile(b["forbid_regex"])
    for p in walk(base=base):
        if p.suffix in EXTS:
            for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if rx.search(line):
                    fails.append(f"{rel(p)}:{i} breaks a boundary ({b['why']}). Move the logic or route it through an allowed module.")

# 6. Only approved packages
allowed, found = set(R.get("allowed_dependencies", [])), set()
pj = ROOT / "package.json"
if pj.exists():
    d = json.loads(pj.read_text(encoding="utf-8"))
    for k in ("dependencies", "devDependencies"):
        found |= set(d.get(k, {}))
ct = ROOT / "Cargo.toml"
if ct.exists():
    sec = ""
    for line in ct.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("["):
            sec = s
            m = re.match(r"\[(?:.*\.)?(?:dev-|build-)?dependencies\.([^\]]+)\]", s)
            if m:
                found.add(m.group(1).strip())
                sec = ""
            continue
        if re.match(r"\[(?:.*\.)?(?:dev-|build-)?dependencies\]", sec) and "=" in s and not s.startswith("#"):
            found.add(s.split("=")[0].strip())
rq = ROOT / "requirements.txt"
if rq.exists():
    for line in rq.read_text(encoding="utf-8").splitlines():
        s = line.split("#")[0].strip()
        if s:
            found.add(re.split(r"[<>=!~\[; ]", s)[0])
addons = ROOT / "addons"
if addons.is_dir():
    found |= {p.name for p in addons.iterdir() if p.is_dir()}
for dep in sorted(found - allowed):
    fails.append(f"Package '{dep}' isn't approved. Remove it, or add a decision record and list it in rules.json.")

# Ratchet: known old problems live in harness/baseline.json and are tolerated.
# New problems fail. Fixed problems drop out of the baseline automatically.
def key(msg):
    msg = re.sub(r":\d+ breaks", " breaks", msg)
    return re.sub(r"is \d+ lines", "is too long", msg)

BL = ROOT / "harness" / "baseline.json"
current = sorted({key(f) for f in fails})
if "--write-baseline" in sys.argv:
    BL.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    print(f"Baseline written with {len(current)} known problem(s).")
    sys.exit(0)
known = set(json.loads(BL.read_text(encoding="utf-8"))) if BL.exists() else set()
new = [f for f in fails if key(f) not in known]
fixed = known - set(current)
if fixed:
    BL.write_text(json.dumps(sorted(known - fixed), indent=2) + "\n", encoding="utf-8")
    print(f"Ratchet: {len(fixed)} old problem(s) fixed and removed from the baseline.")
for f in new:
    print("FAIL:", f)
if known - fixed:
    print(f"({len(known - fixed)} known old problem(s) tolerated; see harness/baseline.json)")
print(f"Harness check: {len(new)} new problem(s)" if new else "Harness check passed")
sys.exit(1 if new else 0)
