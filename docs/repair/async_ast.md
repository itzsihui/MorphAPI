# Repair report — async-contagion (pure_ast)

Generated: `2026-09-17T06:55:54.317Z`

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
- **Location:** io.ts:13
- **Symptom:** getObject().promise()
- **Root cause hint:** Pure AST leaf recipe
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Leaf AST recipe applied
- **Citations:**
  - `[impact]` Pure AST leaf recipe

### iss-2 — api_rename (initial)

- **Severity:** blocker
- **Location:** io.ts:19
- **Symptom:** getObject().promise()
- **Root cause hint:** Pure AST leaf recipe
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Leaf AST recipe applied
- **Citations:**
  - `[impact]` Pure AST leaf recipe

### iss-4 — missing_await (impact_1hop)

- **Severity:** major
- **Location:** app.ts:14
- **Symptom:** Call to fetchObjectBody() has no await/.then after callee became async / Promise-returning
- **Root cause hint:** Cascaded from iss-1 (1° impact: missing_await)
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=1 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** FAIL: caller contagion not in recipe
- **Citations:**
  - `[impact]` Cascaded from iss-1 (1° impact: missing_await)

## Repair process

1. **iss-1** — AST recipe io.ts L19 (deterministic_ast)
2. **iss-1** — AST recipe io.ts L13 (deterministic_ast) → discovered iss-4

## Impact analysis (1°)

- **imp-3** from iss-1: app.ts:14 — missing_await: Call to fetchObjectBody() has no await/.then after callee became async / Promise-returning

## Summary

- Issues: 3 (passed 2, failed 1)
- Cascade edges: 1
- After primary fix: discovered 0 follow-up issue(s); completed 0; remaining 0
- All issues pass: false
- Aggregator mean (secondary): 0.867
- Narrative: Pure AST migrated io.ts only. 1° app.ts contagion discovered but unfixed — recipe ceiling.
