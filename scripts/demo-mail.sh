#!/usr/bin/env bash
# Scenario 7 — Incomplete multi-site refactoring (mail sendEmail → send).
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
echo " MorphAPI / Scenario 7 · Widespread scope"
echo " Incomplete multi-site: notify + cron + seed"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build
npm run build -w mail-send-v1
npm run build -w mail-send-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: flat sendEmail across 3 files"
echo "------------------------------------------------------------"
echo "--- notify.ts ---"
sed -n '1,40p' fixtures/mail-client-v1/src/notify.ts
echo
echo "--- cron.ts ---"
cat fixtures/mail-client-v1/src/cron.ts
echo
echo "--- seed.ts ---"
cat fixtures/mail-client-v1/src/seed.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
set +e
npm run demo:mail-llm-only
LLM_EC=$?
set -e
if [[ "$LLM_EC" -ne 0 && "$LLM_EC" -ne 2 ]]; then
  exit "$LLM_EC"
fi
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (AST checklist + per-span migrate)"
echo "------------------------------------------------------------"
npm run demo:mail-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/mail_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/mail_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  completeness={'PASS' if a.get('completenessPass') else 'FAIL'}  leftover={a.get('leftoverCount')}  migrated={a.get('migratedCount')}  files={a.get('filesReturned')}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  completeness={'PASS' if b.get('completenessPass') else 'FAIL'}  leftover={b.get('leftoverCount')}  migrated={b.get('migratedCount')}  spans={b.get('spansFound')}  oracle_fallback={b.get('usedOracleFallback')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_incomplete = not a.get("completenessPass")
hybrid_ok = b["typecheckPass"] and b.get("completenessPass") and b["phantomCount"] == 0
if llm_incomplete and hybrid_ok:
    print("Evidence: LIVE model + multi-file sendEmail→send reshape.")
    print("Demo claim: VERIFIED — pure AI incomplete; hybrid AST checklist completes all sites.")
elif (not llm_incomplete) and hybrid_ok:
    print("Demo claim: PARTIAL — LLM-only finished all sites this run; hybrid still correct. Re-run for miss rate.")
    raise SystemExit(2)
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/mail_*/out/")
    raise SystemExit(1)
PY
