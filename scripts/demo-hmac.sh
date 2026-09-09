#!/usr/bin/env bash
# Scenario 10 — Security & auth scheme overhaul (static token → HMAC).
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
echo " MorphAPI / Scenario 10 · Cryptographic & protocol evolution"
echo " Static token → HMAC-SHA256 + timingSafeEqual"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build
npm run build -w webhook-auth-v1
npm run build -w webhook-auth-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: static query token"
echo "------------------------------------------------------------"
sed -n '1,40p' fixtures/webhook-client-v1/src/webhook.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
set +e
npm run demo:hmac-llm-only
LLM_EC=$?
set -e
if [[ "$LLM_EC" -ne 0 && "$LLM_EC" -ne 2 ]]; then
  exit "$LLM_EC"
fi
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (AST + security gate)"
echo "------------------------------------------------------------"
npm run demo:hmac-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/hmac_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/hmac_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  security={'PASS' if a.get('securityPass') else 'FAIL'}  phantoms={a['phantomCount']}  static={a.get('staticTokenCount')}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  security={'PASS' if b.get('securityPass') else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}  oracle_fallback={b.get('usedOracleFallback')}")
if a.get("securityFindings"):
    print("LLM-only security findings:")
    for f in a["securityFindings"]:
        if not f.get("ok", True):
            print(f"  - [{f.get('kind')}] {f.get('detail')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_miss = not a.get("securityPass")
hybrid_ok = b["typecheckPass"] and b.get("securityPass") and b["phantomCount"] == 0
if llm_miss and hybrid_ok:
    print("Evidence: LIVE model + static-token → HMAC trap.")
    print("Demo claim: VERIFIED — pure AI fails security gate; hybrid applies/verifies HMAC scheme.")
elif (not llm_miss) and hybrid_ok:
    print("Demo claim: PARTIAL — LLM-only passed security this run; hybrid still correct. Re-run for miss rate.")
    raise SystemExit(2)
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/hmac_*/out/")
    raise SystemExit(1)
PY
