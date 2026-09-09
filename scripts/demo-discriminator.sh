#!/usr/bin/env bash
# Scenario 9 — Polymorphic discriminator mutation. Live LLM-only vs Hybrid.
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
echo " MorphAPI / Scenario 9 · Type system & schema discriminators"
echo " Polymorphic discriminator mutation"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build -w @morphapi/core
npm run build -w events-gateway-v1
npm run build -w events-gateway-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: subscribe intents + router switch(event.type)"
echo "------------------------------------------------------------"
echo "--- fixtures/events-client-v1/src/subscribe.ts ---"
sed -n '1,40p' fixtures/events-client-v1/src/subscribe.ts
echo
echo "--- fixtures/events-client-v1/src/router.ts ---"
sed -n '1,40p' fixtures/events-client-v1/src/router.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live; only sees subscribe.ts)"
echo "------------------------------------------------------------"
set +e
npm run demo:discriminator-llm-only
LLM_RC=$?
set -e
if [[ "$LLM_RC" -ne 0 && "$LLM_RC" -ne 2 ]]; then
  exit "$LLM_RC"
fi
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST switch + oracle map)"
echo "------------------------------------------------------------"
npm run demo:discriminator-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/discriminator_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/discriminator_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  discriminator={'PASS' if a.get('behavioralPass') else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  discriminator={'PASS' if b.get('behavioralPass') else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}  oracle_fallback={b.get('usedOracleFallback')}")
if a.get("discriminatorSites"):
    print("LLM-only discriminator sites:")
    for s in a["discriminatorSites"]:
        print(f"  - L{s.get('startLine')} [{s.get('kind')}] {'ok' if s.get('ok') else 'FAIL'}: {s.get('reason')}")
if b.get("discriminatorSites"):
    print("Hybrid discriminator sites:")
    for s in b["discriminatorSites"]:
        print(f"  - L{s.get('startLine')} [{s.get('kind')}] {'ok' if s.get('ok') else 'FAIL'}: {s.get('reason')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_miss = (not a.get("behavioralPass")) or (not a.get("typecheckPass"))
hybrid_ok = b["typecheckPass"] and b.get("behavioralPass") and b["phantomCount"] == 0
if llm_miss and hybrid_ok:
    print("Evidence: LIVE model + discriminator type→event_type trap (cross-file router).")
    print("Demo claim: VERIFIED — pure AI misses switch/case migration; hybrid applies/verifies it.")
elif (not llm_miss) and hybrid_ok:
    print("Demo claim: PARTIAL — LLM-only happened to look clean; hybrid still correct. Re-run.")
    raise SystemExit(2)
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/discriminator_*/out/")
    raise SystemExit(1)
PY
