#!/usr/bin/env bash
# MorphPay baseline demo — live LLM-only fails compile; Hybrid AI+AST passes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load repo-root .env (KEY=VALUE), without overriding already-exported vars
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${OPENAI_API_KEY:-}" && -z "${MORPHAPI_LLM_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY is required in .env (offline fixtures were removed)."
  echo "Add: OPENAI_API_KEY=sk-..."
  exit 1
fi

MODEL="${MORPHAPI_LLM_MODEL:-gpt-4o-mini}"

echo "============================================================"
echo " MorphAPI / MorphPay Baseline Demo"
echo " Claim: live LLM-only fails typecheck (scaffolding hallucination);"
echo "        Hybrid AI+AST passes typecheck with 0 phantoms."
echo " Mode:  LIVE LLM (${MODEL}) — always real model calls"
echo "============================================================"
echo

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Building packages..."
npm run build

echo
echo "------------------------------------------------------------"
echo " BEFORE: client-v1 (morphpay.charges.create)"
echo "------------------------------------------------------------"
sed -n '1,40p' fixtures/client-v1/src/checkout.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
npm run demo:llm-only
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + Inspector)"
echo "------------------------------------------------------------"
npm run demo:hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}")
if a.get("phantoms"):
    print("LLM-only phantoms:")
    for p in a["phantoms"]:
        print(f"  - [{p.get('tier')}] {p.get('symbol')}")
print()
if a.get("mode") != "live":
    print("Demo claim: NOT VERIFIED — LLM-only was not live")
    raise SystemExit(1)
if (not a["typecheckPass"] or a["phantomCount"] > 0) and b["typecheckPass"] and b["phantomCount"] == 0:
    print("Evidence: LIVE model calls only (no recorded fixtures).")
    print("Demo claim: VERIFIED — pure AI fails; hybrid passes.")
else:
    print("Demo claim: NOT VERIFIED — inspect reports under baselines/*/out/")
    raise SystemExit(1)
PY

echo
echo "Reports:"
echo "  baselines/llm_only/out/report.json"
echo "  baselines/hybrid/out/report.json"
echo "Live LLM output: baselines/llm_only/out/checkout.ts"
echo "Talk track: see README.md"
