# MorphAPI — Project Description & How it's Made

Showcase-style writeup (voice modeled on [Reveal · ETHGlobal](https://ethglobal.com/showcase/undefined-k4mq7): problem-first narrative, concrete loops, stack on the critical path, honest tradeoffs).

**One-liner:** Hybrid AI + AST repair for API drift — the model proposes, the oracle forbids phantoms, the AST applies only where it should.

---

## Project Description

MorphAPI is a neurosymbolic migration agent for breaking API changes. You do not paste a whole file into a chat and hope the next model version “just gets it.” You run a bounded repair loop: find the call sites, ask a live LLM for a patch under constraints, reject any symbol the target SDK does not own, then surgically apply what survives. That verification is the product. Pure LLMs invent near-miss scaffolding that looks right in a diff and fails `tsc`. Pure AST/LST tools keep whitespace and refuse to hallucinate — and also refuse to invent Builder wrappers, JWKS verify, or dollars→cents without weeks of hand recipes. MorphAPI flips both failure modes at once. The model supplies fuzzy synthesis for paradigm shifts; the oracle and typecheck keep illegal API surface out of the tree.

The demo journey is built around that comparison. Guests open a React walkthrough, pick one of eleven live scenarios (MorphPay builders, Plaid enum casing, OpenAI `engine`→`model`, Stripe units, JWT→JWKS anti-cheat, payload envelopes, async contagion, multi-file mail, error hierarchies, discriminators, HMAC webhooks), and run **Without MorphAPI** beside **With MorphAPI**. Same fixture, same live model (default `gpt-4o-mini`), same docs that are intentionally incomplete the way real migration guides are. Left often typechecks-fail or sneaks past compile while behavioral / completeness / security gates fail. Right constrains the patch, inspects phantoms, and applies through AST spans so reviewers see a local diff instead of a whole-file rewrite.

Evaluation is the other half of the loop. An Evaluation tab scores Pure AST (estimated, plus measured pilots), Pure LLM (measured), and Hybrid (measured) against literature-shaped metrics — automation ceiling, setup effort, scaffolding hallucination, diff aesthetics, semantic/paradigm shifts — with a written why for every PASS/FAIL from the latest `report.json`. Cascade pilots (OpenAI, Envelope, Async, Mail) go further: each approach emits a repair report with **per-issue rubrics and citations**, a step log of “fix A → discover B,” and a secondary aggregator mean — so graders see the chain, not only a binary gate. On the current snapshot, Hybrid clears all eleven scenario gates; Pure LLM clears one; MorphAPI records ten strict wins (LLM fail → Hybrid pass) and one soft/tie where repair-loop LLM also passed but Hybrid still enforces anti-cheat.

Consumer loop: pick scenario → run live LLM-only → run hybrid → read phantoms and typecheck → open Evaluation for the gate story. Pipeline loop: AST scan → constrained LLM → Hallucination Inspector → span apply → `tsc` + scenario gate. Research loop: taxonomy of ten failure modes → live baselines → matrix that refuses to invent outcomes not on disk.

The whole point is one agent that keeps generative power for semantic rewrites without letting phantom APIs land — and proves it side-by-side, not as a slide claim.

Both sides of the tooling tradeoff win when they stay in their lane.

---

## How it's Made

MorphAPI is an npm workspaces monorepo. Synthetic but realistic v1/v2 SDK packages live under `packages/*` (MorphPay, Plaid-shaped enums, OpenAI chat, Stripe charge/errors, auth JWT, mail, webhooks, envelopes, async, discriminators). Client fixtures under `fixtures/*` start on v1. Trusted allow-lists sit in `oracle/*.json`; migration docs in `docs/*` are deliberately vague on the exact enum/member names models love to invent. `packages/morphapi-core` owns the critical path: TypeScript AST scan, prompt + OpenAI live call, Hallucination Inspector, surgical apply, typecheck harness, plus scenario gates (behavioral amount transform, mail completeness, HMAC security, async contagion, envelope/DFG-ish checks). `baselines/*` pair LLM-only vs hybrid runners that write `out/report.json`. `apps/demo-ui` is Vite + React + a small Express server that proxies live runs and builds the evaluation matrix from those reports.

The UX is intentional about evidence. Live demos never silently swap in recorded failures: every comparison hits a real model when `OPENAI_API_KEY` is set. Side-by-side panels highlight content-level diffs (constructor shape, not `openai` vs `client` renames). The Evaluation page is not a vanity dashboard — each scenario expands into Pure AST / Pure LLM / Hybrid cards with gate explainers generated from measured fields (`typecheckPass`, `phantomCount`, `behavioralPass`, `completenessPass`, `securityPass`, `testMutationBarrier`). Prior-art ranges (AST ~70–97%, LLM ~45–60%, Hybrid ~85–95%) stay labeled as literature, not MorphAPI percentages; this FYP uses binary gates on n≈1 live seeds and says so.

Money-of-truth for symbols is the oracle JSON plus `tsc`, not the LLM’s confidence. The inspector flags invented members (`CaptureMode.Automatic`, `CountryCode.US`, legacy `stripe.error.CardError`, leftover `sendEmail`). Hybrid prompts are constrained to allowed surface; failed proposals do not apply. Span apply keeps surrounding comments and layout so TypeScript diffs stay reviewable — whitespace is not Python-semantic here, but aesthetics for other developers still matter. Scenario-specific gates close the holes compile alone misses: ×100 / `amountCents` for Stripe units, all mail call sites for multi-file refactors, JWKS path plus test-mutation barrier for reward hacking, `verifyWebhookRequest` for HMAC.

Auth and “cheat” pressure are first-class. The JWT→JWKS scenario runs a repair-style loop on the LLM-only side so the demo can show how typecheck feedback invites `@ts-ignore` / `as any` / secret leftovers; Hybrid adds `testMutationBarrier` so passing tests by rewriting the test is not a silent win. That is the FYP answer to “won’t a bigger model obsolete this?” — smarter models can reward-hack more creatively; symbolic bounds still decide membership.

The evaluation scorer (`scripts/eval-matrix.mjs`) is the glue between research claims and the UI. It reads every baseline report, maps gate families (`tsc_phantoms`, `tsc_behavioral`, `tsc_completeness`, `tsc_security`, …), scores **per-issue first** when a `repairReport` exists (aggregator mean labeled secondary), estimates Pure AST conservatively except for four executed AST pilots, and emits both JSON for `/api/eval` and markdown for `docs/evaluation.md`. `npm run eval:repair-reports` attaches LLM/hybrid cascade JSON and renders `docs/repair/*.md`. ESM import cache-busting on the demo server keeps the Evaluation tab honest after scorer edits.

What is synthetic is labeled: MorphPay and sibling SDKs are controlled fixtures so the oracle is exact and the failure class matches real migrations (docs teach `US`, SDK wants `Us`). What is real is also labeled: live LLM calls, real `tsc`, real phantom inspection, real side-by-side UI. Put together, the AST decides *where*, the LLM proposes *what*, the oracle decides *if valid*, and the demo refuses to claim a PASS that is not in `report.json`.
