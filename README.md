# MorphAPI

Hybrid **AI + AST** agent for self-maintaining API migrations. Baseline demo proves scaffolding hallucination with **live LLM calls only** (no recorded failure fixtures).

| Route | Result |
|-------|--------|
| **LLM-only** | Live model migrates MorphPay v1→v2 → phantoms / **typecheck FAIL** |
| **Hybrid (AI + AST)** | AST finds usage → live constrained patch → Hallucination Inspector → surgical apply → **typecheck PASS** |

## Quick demo

```bash
npm install
cp .env.example .env   # set OPENAI_API_KEY=sk-...
npm run demo           # CLI side-by-side
npm run demo:ui        # browser UI → http://localhost:5173
```

### Browser UI

`npm run demo:ui` opens a frontend that shows:

1. **Without MorphAPI** — live LLM-only output + phantoms + typecheck FAIL  
2. **With MorphAPI** — hybrid output + typecheck PASS  
3. Diff hints + a short explanation of why the “errors” are the evidence

Click **Run live comparison** to re-call the model.

Requires `OPENAI_API_KEY` in `.env`. Every CLI/UI run calls a real model (default `gpt-4o-mini`).

## What is real vs synthetic?

| Piece | Real? |
|-------|--------|
| LLM call | **Yes — always** |
| Typecheck / phantom detection | **Yes** |
| MorphPay API / client | **Synthetic** FYP fixture (controlled oracle; same failure class as real migrations) |

## 60-second talk track (interim meeting)

1. **Problem:** Pure LLMs invent scaffolding symbols that look right but do not compile.
2. **Baseline:** Synthetic MorphPay v1→v2; model call is live.
3. **Evidence:** Same client. Live LLM-only fails `tsc`. Hybrid AST-bounds + oracle verify → `tsc` passes.
4. **Next:** Scale inspector + LST apply beyond this fixture.

## Layout

```
packages/morphpay-v1/     # deprecated charges.create API
packages/morphpay-v2/     # PaymentIntent.Builder (real symbols only)
packages/morphapi-core/   # AST scan, Hallucination Inspector, apply, typecheck
fixtures/client-v1/       # sample client on v1
oracle/morphpay-v2.json   # trusted symbol membership set
docs/morphpay-v2.md       # migration docs (intentionally incomplete on enum names)
baselines/llm_only/       # Baseline A — live LLM only
baselines/hybrid/         # Baseline B — live LLM + AST + inspector
apps/demo-ui/             # Browser comparison UI
scripts/demo.sh
```

## MorphPay traps (near-miss API design)

**Real v2 symbols:** `PaymentIntent.Builder`, `setAmount`, `setCurrency`, `setPaymentMethod`, `setCaptureMode(CaptureMode.AUTOMATIC|MANUAL)`, `build`, `morphpay.intents.confirm`.

**Common model mistakes:** wrong-cased enum members (`Automatic`/`Manual`), invented helpers, leftover v1 fields like `captured`.
