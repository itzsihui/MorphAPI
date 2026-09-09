#!/usr/bin/env bash
# Scenario 8 — Exception hierarchy drift. Live LLM-only vs Hybrid.
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
echo " MorphAPI / Scenario 8 · Error-contract breakage"
echo " Exception hierarchy drift (stripe.error.CardError → Stripe.errors)"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build -w @morphapi/core
npm run build -w stripe-errors-v1
npm run build -w stripe-errors-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: charges.create + stripe.error.CardError"
echo "------------------------------------------------------------"
sed -n '1,45p' fixtures/stripe-errors-client-v1/src/charge.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
npm run demo:stripe-errors-llm-only
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST try/catch + Inspector)"
echo "------------------------------------------------------------"
npm run demo:stripe-errors-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/stripe_errors_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/stripe_errors_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  phantoms={a['phantomCount']}  leftoverCatch={a.get('leftoverLegacyCatch')}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}")
if a.get("phantoms"):
    print("LLM-only phantoms:")
    for p in a["phantoms"]:
        print(f"  - [{p.get('tier')}] {p.get('symbol')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_failed = (
    (not a["typecheckPass"])
    or a["phantomCount"] > 0
    or a.get("leftoverLegacyCatch")
    or a.get("leftoverCharges")
)
if llm_failed and b["typecheckPass"] and b["phantomCount"] == 0:
    print("Evidence: LIVE model + Stripe error-hierarchy migration.")
    print("Demo claim: VERIFIED — pure AI fails; hybrid passes.")
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/stripe_errors_*/out/")
    raise SystemExit(1)
PY
