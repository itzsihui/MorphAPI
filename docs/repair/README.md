# Cascade repair reports

Professor-facing evidence: **per-issue rubrics** with citations, then a secondary aggregator.

## Pilots

| Scenario | Pure LLM | Pure AST | Hybrid |
|----------|----------|----------|--------|
| OpenAI (2) | [openai_llm_only.md](./openai_llm_only.md) | [openai_ast.md](./openai_ast.md) | [openai_hybrid.md](./openai_hybrid.md) |
| Envelope (5) | [envelope_llm_only.md](./envelope_llm_only.md) | [envelope_ast.md](./envelope_ast.md) | [envelope_hybrid.md](./envelope_hybrid.md) |
| Async (6) | [async_llm_only.md](./async_llm_only.md) | [async_ast.md](./async_ast.md) | [async_hybrid.md](./async_hybrid.md) |
| Mail (7) | [mail_llm_only.md](./mail_llm_only.md) | [mail_ast.md](./mail_ast.md) | [mail_hybrid.md](./mail_hybrid.md) |

## Cascade idea

Fix issue A → re-verify (typecheck / inspector / 1° impact) → issue B may appear → score B on its own rubric → continue.

Professor metric in each report summary:

- **After primary fix: discovered N follow-up issue(s); completed K; remaining R**

Scenario 7 (mail) is the Workbench showcase for this (`#live/mail`).

The **Code Graph** tab in the demo UI shows the type-resolved graph behind each call site (types, data flow, callers, v1 → v2 symbol mapping) — see [`docs/code-graph.md`](../code-graph.md). These reports do not consume that graph yet.

## Regenerate

```bash
npm run demo:openai-ast   # etc.
npm run demo:mail-ast && npm run demo:mail-llm-only && npm run demo:mail-hybrid
npm run eval:repair-reports
npm run eval:matrix
```

JSON sources live under `baselines/*/out/repair-report.json`.

## PDF (Scenario 7)

```bash
npm run eval:repair-pdf
# → docs/repair/pdf/mail_ast.pdf
# → docs/repair/pdf/mail_llm_only.pdf
# → docs/repair/pdf/mail_hybrid.pdf
```
