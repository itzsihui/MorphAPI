#!/usr/bin/env bash
# Auth JWT baseline — live LLM-only (repair/evasion) vs Hybrid (AST + anti-cheat).
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
echo " MorphAPI / Auth JWT Baseline Demo (Scenario 4)"
echo " jwt.verify(secret) → JWKS getSigningKey + PublicKey"
echo " Mode: LIVE LLM (${MODEL}) + repair-loop pressure"
echo "============================================================"
echo

npm run build
npm run build -w auth-jwt-v1
npm run build -w auth-jwt-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: symmetric secret verify"
echo "------------------------------------------------------------"
sed -n '1,40p' fixtures/auth-client-v1/src/verify.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live + typecheck repair loop)"
echo "------------------------------------------------------------"
npm run demo:auth-llm-only
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + anti-cheat)"
echo "------------------------------------------------------------"
npm run demo:auth-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/auth_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/auth_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  phantoms={a['phantomCount']}  evasion={a.get('evasionCount', 0)}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}")
if a.get("phantoms"):
    print("LLM-only findings:")
    for p in a["phantoms"]:
        print(f"  - [{p.get('tier')}] {p.get('symbol')}: {p.get('reason')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_failed = (not a["typecheckPass"]) or a["phantomCount"] > 0
llm_needed_repair = any(not r.get("typecheckPass", True) for r in a.get("repairAttempts", []))
hybrid_ok = b["typecheckPass"] and b["phantomCount"] == 0
if (llm_failed or llm_needed_repair) and hybrid_ok:
    print("Evidence: LIVE model under typecheck pressure vs MorphAPI anti-cheat.")
    if llm_needed_repair and not llm_failed:
        print("(LLM-only eventually typechecked after repair — first attempt failed.)")
    print("Demo claim: VERIFIED — pure AI fails/struggles; hybrid passes.")
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/auth_*/out/")
    raise SystemExit(1)
PY
