#!/usr/bin/env bash
# OpenAI chat baseline — live LLM-only vs Hybrid (engine → model).
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
echo " MorphAPI / OpenAI Chat Baseline Demo"
echo " Legacy ChatCompletion.create({ engine }) → v1 model"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build -w @morphapi/core
npm run build -w openai-chat-v0
npm run build -w openai-chat-v1

echo
echo "------------------------------------------------------------"
echo " BEFORE: ChatCompletion.create({ engine })"
echo "------------------------------------------------------------"
sed -n '1,40p' fixtures/openai-client-v0/src/chat.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
npm run demo:openai-llm-only
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + Inspector)"
echo "------------------------------------------------------------"
npm run demo:openai-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/openai_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/openai_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}")
if a.get("phantoms"):
    print("LLM-only phantoms:")
    for p in a["phantoms"]:
        print(f"  - [{p.get('tier')}] {p.get('symbol')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
if (not a["typecheckPass"] or a["phantomCount"] > 0) and b["typecheckPass"] and b["phantomCount"] == 0:
    print("Evidence: LIVE model + OpenAI-shaped engine→model migration.")
    print("Demo claim: VERIFIED — pure AI fails; hybrid passes.")
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/openai_*/out/")
    raise SystemExit(1)
PY
