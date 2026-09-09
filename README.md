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

### Browser UI (professor walkthrough)

```bash
npm run demo:ui   # http://localhost:5173
```

Primary nav:

| Tab | What you show |
|-----|----------------|
| **Landing** | Why hybrid / why scaling AI alone fails (SWE-Bench Pro cites) + neurosymbolic pitch |
| **Failure taxonomy** | 10 scenarios — **Live** badge only on MorphPay (1a) + Plaid (1b); others labeled **Taxonomy** |
| **Live demos** | MorphPay \| Plaid — run LLM-only vs hybrid, before/docs/explain |
| **Industry context** | Cursor vs MorphAPI AST, Stainless, OpenAPI limits, CLI vs GitHub-App deploy models |

Deep links: `#landing`, `#taxonomy/plaid-enum-scaffolding`, `#live/plaid`, `#context`.

**Accuracy:** only MorphPay + Plaid execute live LLM baselines. Scenarios 2–10 are thesis case studies with illustrative snippets and real provider doc links — not fake PASS/FAIL reports.

### Plaid Link baseline (real SDK enum names)

Second scenario using **real Plaid TypeScript enum shapes** from `plaid@30` (`CountryCode.Us`, `Products.Transactions` — not `US` / `TRANSACTIONS`):

```bash
npm run demo:plaid
```

Oracle: [`oracle/plaid-link-v2.json`](oracle/plaid-link-v2.json) (subset of published SDK enums).  
Vague docs: [`docs/plaid-link-v2.md`](docs/plaid-link-v2.md).

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
