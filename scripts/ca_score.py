#!/usr/bin/env python3
"""Score the CA re-run (out/ca_ast): completion, phantoms rejected, unneeded line changes (vs the complete hand-written
codemod as reference migration), tokens, cost, time. Written before looking at the per-arm results."""
import json, glob, os, difflib, collections, sys
D = '/home/claude/itzsihui/morphapi/out/ca_ast'
PRICE = {'gpt-4o-mini': (0.15, 0.60, 0.15, 0.075), 'claude-haiku-4-5': (1.0, 5.0, 1.25, 0.10), 'claude-sonnet-4-5': (3.0, 15.0, 3.75, 0.30)}
IDS = ["morphpay", "plaid", "openai", "stripe", "stripe-errors", "auth", "envelope", "async", "mail", "hmac", "discriminator"]
ref = {id: json.load(open(f'{D}/{id}.arm_codemod.json'))['patches'] for id in IDS}
def changed_old(before, after):
    a, b = before.split('\n'), after.split('\n'); s = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag in ('replace', 'delete'): s |= {i for i in range(i1, i2) if a[i].strip()}
        if tag == 'insert': s.add(('ins', i1))
    return s
def unneeded(id, patches):
    n = 0
    for f, p in patches.items():
        mine = changed_old(p['before'], p['after'])
        r = ref[id].get(f); theirs = changed_old(r['before'], r['after']) if r else set()
        near = {x for x in theirs if not isinstance(x, tuple)} | {x[1] for x in theirs if isinstance(x, tuple)}
        for x in mine:
            if isinstance(x, tuple):
                if not any(abs(x[1] - k) <= 1 for k in near): n += 1
            elif x not in theirs: n += 1
    return n
rows = []
for f in sorted(glob.glob(f'{D}/*.r[0-9].json')):
    b = os.path.basename(f)[:-5]; id, arm, model, r = b.rsplit('.', 3) if b.count('.') == 3 else (None,)*4
    if id is None:  # model names contain '-' not '.', so split works; ids contain '-'
        continue
    d = json.load(open(f)); m = d['metrics']; p = PRICE[model]
    cost = (m['promptTokens'] * p[0] + m['completionTokens'] * p[1] + (m.get('cacheWriteTokens') or 0) * p[2] + (m.get('cacheReadTokens') or 0) * p[3]) / 1e6
    rows.append(dict(id=id, arm=arm, model=model, run=r, complete=d['final']['complete'], phantoms=m['phantomRejections'],
                     newdiags=len(d['final']['newDiagnostics']), leftovers=d['final']['leftovers'] + d['final']['deprecatedModuleUses'],
                     unneeded=unneeded(id, d['patches']), changed=m['changedLines'], tokens=m['promptTokens'] + m['completionTokens'], cost=cost, sec=d['ms'] / 1000))
json.dump(rows, open(f'{D}/scored.json', 'w'), indent=1)
by = collections.defaultdict(list)
for x in rows: by[(x['arm'], x['model'])].append(x)
print('| arm | model | runs | complete (of 33) | phantoms rejected | unneeded line changes (mean/run) | tokens/run | cost total | median s |')
for (arm, model), xs in sorted(by.items()):
    xs2 = sorted(x['sec'] for x in xs)
    print(f"| {arm} | {model} | {len(xs)} | {sum(x['complete'] for x in xs)} | {sum(x['phantoms'] for x in xs)} | {sum(x['unneeded'] for x in xs)/len(xs)*11:.1f} per 11 | {sum(x['tokens'] for x in xs)/len(xs):.0f} | ${sum(x['cost'] for x in xs):.3f} | {xs2[len(xs2)//2]:.1f} |")
print('\nIncomplete scenario-runs per arm/model:')
for (arm, model), xs in sorted(by.items()):
    c = collections.Counter(x['id'] for x in xs if not x['complete'])
    print(arm, model, dict(c))
ref_rows = json.load(open(f'{D}/codemod_summary.json'))
print('\nCodemod reference: complete', sum(r['complete'] for r in ref_rows), '/ 11; rule LOC total', sum(r['loc'] for r in ref_rows), {r['id']: r['loc'] for r in ref_rows})
print('total cost all runs: $%.2f' % sum(x['cost'] for x in rows))
