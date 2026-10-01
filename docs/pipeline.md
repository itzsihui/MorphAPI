# Migration pipeline (`runMigration`)

One generic pipeline migrates every live scenario. It works on the fixture's real `ts.Program`, sends the LLM one call site at a time, and lets the TypeScript checker decide what is accepted. Nothing in it is scenario-specific: a scenario is described only by its tsconfig, the deprecated symbol, the successor module and the prose migration guide (`apps/demo-ui/scenarioMeta.mjs`).

Code: `packages/morphapi-core/src/pipeline.ts`, with the mechanisms in `program.ts`, `sliceMetadata.ts`, `oracleExtract.ts`, `gate.ts`, `importReconcile.ts`, `dataflow.ts` and `impactProgram.ts`.

## Steps

1. **Session.** `ProjectSession.open(tsconfig)` builds an incremental program. Proposals are spliced in memory (`session.update`) and re-checked without touching disk; unchanged files and their diagnostics are reused.
2. **Find call sites.** `findDeprecatedReferences(session, "module#Export.member")` resolves the spec through the checker and returns every call that resolves to it, including through renamed imports, `paths` aliases, NodeNext `.js` imports and namespace imports.
3. **Oracle.** `extractOracle()` reads the successor package's declarations: exports, members of reachable types, and how to obtain each type (constructor or factory signature). No hand-written oracle JSON is used.
4. **Shared imports.** Names exported by both versions with the same name (a client factory such as `createS3Client`, a type such as `GatewayEvent`) have their imports moved to the successor in every project file first, so values they produce get successor types.
5. **Slice and prompt.** Each call site becomes an expression slice (the call and its member chain) or, for builder / constructor / multi-step successors, the enclosing statement. The prompt carries the slice, the slice facts from the Code Property Graph, the successor API and the migration guide. It never carries the whole file.
6. **Gate.** The proposal is spliced in and only diagnostics inside the patched range are judged:
   - missing names or members are **phantoms**, rejected with valid options (successor exports, in-scope variables of successor types, or the members of the receiver);
   - a successor member called on a deprecated value says which successor type owns it and how to construct one;
   - `obj["x"]` and implicit-any index access are warnings, not rejections;
   - `@ts-ignore`, `as any` and similar are rejected as evasion; a call that still resolves to the deprecated symbol is rejected as a leftover.
   Up to 3 attempts with that feedback. If the output does not parse as an expression, or the receiver is the wrong type, the site escalates once to a statement slice. There is no template fallback.
7. **Async.** If an accepted proposal uses `await` inside a non-async function, the function becomes `async` and its declared return type becomes `Promise<…>`. Callers are left to impact analysis.
8. **Imports.** Successor imports the proposal needs are added in the file's quote style; imports from the deprecated module that are no longer used are removed.
9. **Data flow.** If the result type changed (for example a page envelope instead of an array), `propagateResponseShape` tries an adapter at the call, then read-path rewrites on the binding, and keeps whichever brings diagnostics back to baseline.
10. **Impact (1 hop).** Compares function signatures before and after, then reports `missing_await` (a function became async and a caller does not await it), `same_api_leftover`, `deprecated_module_use` (anything still used from the deprecated module), `stale_import` and `new_type_error` (diagnostics in changed files, their callers and importers that were not in the baseline). Missing awaits are fixed deterministically; the rest go back to the LLM as statement repairs, gated the same way, and a repair must reduce the file's error count. Up to 2 repair rounds.
11. **Completion.** A run is complete when every call site was accepted, no call resolves to the deprecated symbol, nothing is used from the deprecated module, and there are no diagnostics beyond the baseline.

## Arms

The same code path runs every arm; each switches mechanisms off.

| Arm | Context | Gate + feedback | Impact repair |
|---|---|---|---|
| `arm1_morphapi` | slice + facts | yes | yes |
| `arm0_llm_only` | whole file, one rewrite | no | no |
| `ablA_no_slices` | whole file instead of facts | yes | yes |
| `ablB_no_oracle` | slice + facts | measured, never rejects; 1 attempt | yes |
| `ablC_no_impact` | slice + facts | yes | no |

## Results (gpt-4o-mini, temperature 0.2)

Complete runs out of the 11 live scenarios:

| Arm | Complete | Fails on |
|---|---|---|
| `arm1_morphapi` | **11 / 11** | none (same result on three consecutive full runs) |
| `arm0_llm_only` | 5 / 11 | morphpay, plaid, auth, envelope, mail, discriminator (new type errors); the 5 that pass rewrite 45–89% unrelated lines |
| `ablA_no_slices` | 10 / 11 | stripe-errors (keeps calling `paymentIntents` on the v1 client) |
| `ablB_no_oracle` | 7 / 11 | morphpay, openai, stripe-errors, async (phantoms accepted without feedback) |
| `ablC_no_impact` | 5 / 11 | morphpay, openai, stripe-errors, mail, discriminator (breakage one hop away is never repaired) |

Churn is the share of changed lines that belong to neither a migrated call site, an impact repair, an import, nor a deterministic follow-up (async conversion, data-flow rewrite). It is 0% on every `arm1_morphapi` run.

Token use is not lower than a whole-file prompt on these fixtures: the facts JSON and successor API list are often longer than a 30-line file. What the slice buys is locality (no unrelated edits) and information the file does not state.

The frontier profile (Claude) is wired but has not been run yet; it needs an Anthropic key (see below).

## Running it

```bash
npm run build -w @morphapi/core
npm run morph:run -- mail async envelope --verbose   # or: all
npm run morph:run -- all --arm arm0_llm_only
npm run morph:run -- all --model frontier
```

Each run writes `out/pipeline/<scenario>.<arm>.<model>.json` (steps, attempts with gate findings, impact, repairs, metrics, before/after files) and prints one line per scenario. The Code Graph page shows the saved run in card 6 and can start a live one (`GET /api/pipeline/last`, `GET /api/pipeline/stream`, both with `scenario`, `arm`, `model`).

### Models

| Profile | Model | Environment |
|---|---|---|
| `mini` (default) | `MORPHAPI_LLM_MODEL`, default `gpt-4o-mini` | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` |
| `frontier` | `MORPHAPI_FRONTIER_MODEL`, default `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` (or `MORPHAPI_FRONTIER_API_KEY`), optional `MORPHAPI_FRONTIER_BASE_URL` (default Anthropic's OpenAI-compatible endpoint) |

`MORPHAPI_TEMPERATURE` sets the temperature for both (default 0.2).

## Known limits

- The generic finder only migrates **calls** that resolve to the deprecated symbol. Three scenarios also have hand-written finders for non-call sites (a `catch` clause, a `switch`, an inline token compare). The pipeline reaches the first two through impact (`deprecated_module_use`, `new_type_error`) but does not touch the inline `token === process.env.WEBHOOK_TOKEN` compare in hmac, because it never mentions the deprecated API.
- Completion is a type-level judgement. A migration that compiles but changes behaviour (for example a unit change that the types do not encode) is not caught here; that needs the behavioural checks in the scenario baselines.
- Impact is one hop. A break two calls away is only found if it shows up as a diagnostic in a one-hop file.
- Data-flow rewrites are rarely needed in practice: the model usually adapts the result at the call site itself because the facts show how the result is consumed.
