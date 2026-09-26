"""decisions.py <decisions.json> <sweep|rule|standing|propose> — run a decided query pass against the driver: sweeps (dry run, then apply only on
exactly one match), then the rulings, the standing rulings and the proposals."""
import json, subprocess, sys, time, os
CWD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DRIVE = ['node', os.path.join(CWD, 'scripts', 'drive.mjs')]
def drive(*args):
    for attempt in range(3):
        r = subprocess.run(DRIVE + list(args), cwd=CWD, capture_output=True, text=True, timeout=180)
        out = (r.stdout or '') + (r.stderr or '')
        if 'browser has been closed' in out or 'Nothing is listening' in out:
            time.sleep(3); continue
        return out
    return out
def js(out):
    try: return json.loads(out[out.index('{'):])
    except Exception: return None
D = json.load(open(sys.argv[1]))
phase = sys.argv[2]
log = open(f'{sys.argv[1]}.{phase}.log', 'a')
def say(*a):
    print(*a); print(*a, file=log); log.flush()
if phase == 'sweep':
    ok = skipped = refused = 0
    for s in D['sweeps']:
        dry = js(drive('sweep', '--was', s['was'], '--case'))
        n = dry.get('matches') if dry else None
        if n != 1:
            (skipped if n == 0 else refused).__class__  # no-op
            if n == 0: skipped += 1; say('SKIP 0', s['where'], repr(s['was'][:60]))
            else: refused += 1; say('REFUSE', n, s['where'], repr(s['was'][:60]))
            continue
        res = js(drive('sweep', '--was', s['was'], '--now', s['now'], '--case'))
        if res and res.get('replaced') == 1: ok += 1
        else: refused += 1; say('FAILED', s['where'], repr(s['was'][:60]), str(res)[:200])
    say(f'sweeps applied {ok}, skipped (0 matches) {skipped}, refused/failed {refused}')
elif phase == 'rule':
    ok = bad = 0
    for r in D['rulings']:
        out = drive('rule', str(r['leaf']), r['quote'], r['decision'], r['correction'] or '-', r['because'])
        if '"error"' in out: bad += 1; say('FAILED', r['leaf'], repr(r['quote'][:50]), out[:200])
        else: ok += 1
    say(f'rulings filed {ok}, failed {bad}')
elif phase == 'standing':
    ok = bad = 0
    for r in D['standing']:
        out = drive('rule', 'standing', r['quote'], 'corrected', r['correction'], r['because'], 'kind:inconsistent')
        if '"error"' in out: bad += 1; say('FAILED', r['quote'], out[:200])
        else: ok += 1
    say(f'standing rulings filed {ok}, failed {bad}')
elif phase == 'propose':
    json.dump(D['proposals'], open(f'{sys.argv[1]}.proposals.json', 'w'), ensure_ascii=False, indent=1)
    say(drive('propose', f'{sys.argv[1]}.proposals.json', '--by=the query pass, 2026-09-26')[:600])
