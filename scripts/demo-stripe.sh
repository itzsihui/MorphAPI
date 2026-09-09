#!/usr/bin/env bash
# Scenario 3 — Silent unit shift (dollars → cents). Live LLM-only vs Hybrid.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${OPENAI_API_KEY:-}" && -z "${MORPHAPI_LLM_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY required in .env"
  exit 1
fi

MODEL="${MORPHAPI_LLM_MODEL:-gpt-4o-mini}"

echo "============================================================"
echo " MorphAPI / Scenario 3 · Behavioral break"
echo " Silent unit shift: amount dollars → cents (same param name)"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build
npm run build -w stripe-charge-v1
npm run build -w stripe-charge-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: amounts in dollars"
echo "------------------------------------------------------------"
sed -n '1,40p' fixtures/stripe-client-v1/src/charge.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
npm run demo:stripe-llm-only
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + amount transform)"
echo "------------------------------------------------------------"
npm run demo:stripe-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/stripe_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/stripe_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  behavioral={'PASS' if a.get('behavioralPass') else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  behavioral={'PASS' if b.get('behavioralPass') else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}  oracle_fallback={b.get('usedOracleFallback')}")
if a.get("amountSites"):
    print("LLM-only amount sites:")
    for s in a["amountSites"]:
        print(f"  - L{s.get('startLine')}: {s.get('amountExpr')} → {'scaled' if s.get('scaled') else 'UNSCALED'}")
if b.get("amountSites"):
    print("Hybrid amount sites:")
    for s in b["amountSites"]:
        print(f"  - L{s.get('startLine')}: {s.get('amountExpr')} → {'scaled' if s.get('scaled') else 'UNSCALED'}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
# Scenario 3 claim: LLM-only misses scale (behavioral fail) while often typechecking;
# hybrid scales all sites and typechecks.
llm_miss = not a.get("behavioralPass")
hybrid_ok = b["typecheckPass"] and b.get("behavioralPass") and b["phantomCount"] == 0
if llm_miss and hybrid_ok:
    print("Evidence: LIVE model + dollars→cents semantic trap.")
    print("Demo claim: VERIFIED — pure AI misses unit shift (types may still pass); hybrid applies/verifies ×100.")
elif (not llm_miss) and hybrid_ok:
    print("Demo claim: PARTIAL — LLM-only happened to scale this run; hybrid still correct. Re-run for miss rate.")
    raise SystemExit(2)
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/stripe_*/out/")
    raise SystemExit(1)
PY
