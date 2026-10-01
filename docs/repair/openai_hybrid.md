# Repair report — openai-deprecated-bias (hybrid)

Generated: `2026-09-17T07:47:48.734Z`

## Metrics glossary (rubric dimensions)

| Dimension | Meaning |
|-----------|---------|
| compile | typecheck for this issue |
| oracle | no phantoms / allow-list |
| semantic | behavioral / completeness / security fragment |
| locality | surgical AST vs whole-file |
| cascade | secondary issues detected after this fix |

## Issues

### iss-1 — api_rename (initial)

- **Severity:** blocker
- **Location:** chat.ts:11
- **Symptom:** ChatCompletion.create / engine
- **Root cause hint:** AST span rename
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Call site migrated
- **Citations:**
  - `[tsc]` hybrid claim check

### iss-2 — api_rename (initial)

- **Severity:** blocker
- **Location:** chat.ts:26
- **Symptom:** Second ChatCompletion.create site
- **Root cause hint:** AST span rename
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Call site migrated
- **Citations:**
  - `[tsc]` hybrid claim check

### iss-3 — constructor_shape (after_typecheck)

- **Severity:** blocker
- **Location:** chat.ts
- **Symptom:** new OpenAI(string) → { apiKey }
- **Root cause hint:** Cascade after call-site fix
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Constructor cascade fixed
- **Citations:**
  - `[tsc]` hybrid claim check

## Repair process

1. **iss-1** — AST span replace completions.create (live)
2. **iss-2** — AST span replace completions.create (live) → discovered iss-3
   - Re-verify surfaced constructor_shape
3. **iss-3** — Deterministic ctor rewrite { apiKey } (deterministic_ast)

## Summary

- Issues: 3 (passed 3, failed 0)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 1; remaining 0
- All issues pass: true
- Aggregator mean (secondary): 1
- Narrative: Hybrid cascade: renamed ChatCompletion spans, discovered bare ctor, fixed { apiKey }.
