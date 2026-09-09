#!/usr/bin/env bash
# AWS S3 async contagion — live LLM-only vs Hybrid (Scenario 6).
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
echo " MorphAPI / Async Contagion Baseline Demo (Scenario 6)"
echo " getObject().promise() → client.send(GetObjectCommand)"
echo " Mode: LIVE LLM (${MODEL})"
echo "============================================================"
echo

npm run build -w @morphapi/core
npm run build -w aws-s3-v1
npm run build -w aws-s3-v2

echo
echo "------------------------------------------------------------"
echo " BEFORE: SDK v2 leaf (io.ts) + latent consumer contagion (app.ts)"
echo "------------------------------------------------------------"
echo "--- io.ts ---"
sed -n '1,40p' fixtures/aws-s3-client-v1/src/io.ts
echo
echo "--- app.ts ---"
sed -n '1,40p' fixtures/aws-s3-client-v1/src/app.ts
echo

echo "------------------------------------------------------------"
echo " BASELINE A — LLM-only (live)"
echo "------------------------------------------------------------"
# exit 2 = unexpectedly clean; still continue to hybrid
set +e
npm run demo:async-llm-only
llm_ec=$?
set -e
if [[ "$llm_ec" -ne 0 && "$llm_ec" -ne 2 ]]; then
  exit "$llm_ec"
fi
echo

echo "------------------------------------------------------------"
echo " BASELINE B — Hybrid (live LLM + AST + contagion gate)"
echo "------------------------------------------------------------"
npm run demo:async-hybrid
echo

echo "============================================================"
echo " SUMMARY"
echo "============================================================"

python3 - <<'PY'
import json, pathlib
root = pathlib.Path(".")
a = json.loads((root / "baselines/async_llm_only/out/report.json").read_text())
b = json.loads((root / "baselines/async_hybrid/out/report.json").read_text())
print(f"LLM-only : mode={a.get('mode')}  model={a.get('model')}  typecheck={'PASS' if a['typecheckPass'] else 'FAIL'}  phantoms={a['phantomCount']}")
print(f"Hybrid   : mode={b.get('mode')}  typecheck={'PASS' if b['typecheckPass'] else 'FAIL'}  phantoms={b['phantomCount']}  spans={b.get('spansFound')}  fallback={b.get('usedOracleFallback')}")
if a.get("phantoms"):
    print("LLM-only findings:")
    for p in a["phantoms"]:
        print(f"  - [{p.get('tier')}] {p.get('symbol')}: {p.get('reason')}")
print()
if a.get("mode") != "live":
    raise SystemExit("NOT VERIFIED — LLM-only was not live")
llm_failed = (not a["typecheckPass"]) or a["phantomCount"] > 0
hybrid_ok = b["typecheckPass"] and b["phantomCount"] == 0
if llm_failed and hybrid_ok:
    print("Evidence: LIVE model vs MorphAPI async coloring gate.")
    print("Demo claim: VERIFIED — pure AI fails/contagion; hybrid passes.")
else:
    print("Demo claim: NOT VERIFIED — inspect baselines/async_*/out/")
    raise SystemExit(1)
PY
