# MorphAPI Workbench — professor demo script

Open `npm run demo:ui` → **Workbench** (`#live/…`).

## What each pane proves

| Pane | What they see | Academic claim |
|------|---------------|----------------|
| Contract & Oracle | Clickable `oracle/*.json` (allowed symbols + known phantoms) | Oracle is a deterministic artifact, not a prompt |
| AST span visualizer | Glowing call-site bounds + byte offsets (TS compiler API) | LLM is scoped to surgical spans |
| Comparative arena | AI-alone · Pure AST · MorphAPI hybrid | Thesis baselines on one screen |
| Cascade & impact | Steps with “→ discovered iss-…” + **After primary: +N issues** | Fix A surfaces B; blast-radius counted |
| Live telemetry | SSE: AST → LLM → (AST) → inspector → gate | Closed-loop pipeline |

## Scenario 7 cascade script (recommended)

Scenario 7 (**Multi-site mail**, `#live/mail`) is the cascade showcase:

1. **Problem:** `sendEmail` lives in `notify.ts`, `cron.ts`, and `seed.ts` (4 sites). Helpers return a bare **string id**. `onboarding.ts` **calls** `notifyUser` and treats that string as the message id.
2. **Oracle / v2 contract:** `send({...})` plus `SendResult { messageId, accepted }` — helpers should return `SendResult`, so **1° callers** must adapt.
3. **AST pane:** spans in notify/cron/seed; onboarding has no `sendEmail` but is still in the blast radius.
4. **Run live comparison** — LLM-only → Pure AST → Hybrid.
5. **Impact chip:** *After primary: +3 issue(s)* (2 leftovers + 1 caller) · Hybrid completed 3 · AST remaining 3.
6. **Arena / cascade:**
   - Fix notify leaf + change return to `SendResult`
   - 1° impact finds leftover `sendEmail` in cron/seed **and** `onboardNewUser` (caller_contract)
   - Pure AST discovers them, does not finish; Hybrid completes leftovers + caller (`result.messageId`)
7. **PDF reports:** `npm run eval:repair-pdf` → `docs/repair/pdf/mail_*.pdf`

Full written reports: [`docs/repair/mail_ast.md`](./repair/mail_ast.md), [`mail_llm_only.md`](./repair/mail_llm_only.md), [`mail_hybrid.md`](./repair/mail_hybrid.md).

### Spoken one-liners

- “When we change `notifyUser`’s return from a string id to `SendResult`, impact analysis finds the **direct caller** in `onboarding.ts` — one hop on the call graph.”
- “We also find leftover same-API sites in cron/seed. Hybrid finishes all three follow-ups; Pure AST stops at the recipe ceiling.”
- “PDF evidence is under `docs/repair/pdf/`.”
- If they ask “what does the LLM actually see?”: click **Code graph →** (or open `#graph/mail`) and follow [`code-graph.md`](./code-graph.md). It shows the finder span inside the TypeScript AST, the typed data-flow graph, the Code Property Graph linking the call to the deprecated v1 symbol and its v2 successor, and the slice-facts JSON built from it.

## Flip through other scenarios

`morphpay` → `plaid` → `openai` → `stripe` → `auth` → `envelope` → `async` → `mail` → `stripe-errors` → `discriminator` → `hmac`

For non-mail scenarios, Pure AST may still show as **estimated** until that scenario’s `*_ast` arm is wired into Workbench. Cascade pilots also live under **Evaluation**.

## Regenerate Scenario 7 artifacts

```bash
npm run demo:mail-ast
npm run demo:mail-llm-only
npm run demo:mail-hybrid
npm run eval:repair-reports
npm run eval:matrix
```
