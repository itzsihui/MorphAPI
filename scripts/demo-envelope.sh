#!/usr/bin/env bash
# Scenario 5 — Downstream payload wrapping / DFG blindness. Live LLM-only vs Hybrid.
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
echo " MorphAPI / Scenario 5 · Structural redesign & data-flow"
echo " Downstream payload wrapping / DFG blindness"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build -w @morphapi/core
npm run build -w users-list-v1
npm run build -w users-list-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: network edge (api.ts) + consumers (users.ts)"
echo "------------------------------------------------------------"
echo "--- fixtures/users-client-v1/src/api.ts ---"
sed -n '1,40p' fixtures/users-client-v1/src/api.ts
echo
echo "--- fixtures/users-client-v1/src/users.ts ---"
sed -n '1,40p' fixtures/users-client-v1/src/users.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live; only sees api.ts)"
echo "------------------------------------------------------------"
set +e
npm run demo:envelope-llm-only
LLM_RC=$?
set -e
if [[ "$LLM_RC" -ne 0 && "$LLM_RC" -ne 2 ]]; then
  exit "$LLM_RC"
fi
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + DFG .data adapter)"
echo "------------------------------------------------------------"
npm run demo:envelope-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/envelope_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/envelope_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  envelope={'PASS' if a.get('behavioralPass') else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  envelope={'PASS' if b.get('behavioralPass') else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}  oracle_fallback={b.get('usedOracleFallback')}")
if a.get("envelopeSites"):
    print("LLM-only envelope sites:")
    for s in a["envelopeSites"]:
        print(f"  - L{s.get('startLine')}: {s.get('binding') or '(expr)'} → {'unwrapped' if s.get('unwrapped') else 'BLIND'}")
if b.get("envelopeSites"):
    print("Hybrid envelope sites:")
    for s in b["envelopeSites"]:
        print(f"  - L{s.get('startLine')}: {s.get('binding') or '(expr)'} → {'unwrapped' if s.get('unwrapped') else 'BLIND'}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_miss = (not a.get("behavioralPass")) or (not a.get("typecheckPass"))
hybrid_ok = b["typecheckPass"] and b.get("behavioralPass") and b["phantomCount"] == 0
if llm_miss and hybrid_ok:
    print("Evidence: LIVE model + flat→envelope DFG trap (cross-file consumers).")
    print("Demo claim: VERIFIED — pure AI misses .data edge adapter; hybrid applies/verifies it.")
elif (not llm_miss) and hybrid_ok:
    print("Demo claim: PARTIAL — LLM-only happened to unwrap at edge this run; hybrid still correct. Re-run for miss rate.")
    raise SystemExit(2)
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/envelope_*/out/")
    raise SystemExit(1)
PY
