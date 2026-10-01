# Repair report — payload-envelope (pure_ast)

Generated: `2026-09-17T06:55:55.645Z`

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

- **Severity:** major
- **Location:** api.ts:9
- **Symptom:** Import bumped to users-list-v2
- **Root cause hint:** Pure AST import rewrite
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Import bumped to users-list-v2
- **Citations:**
  - `[report_field]` behavioralPass=false expected without .data

### iss-2 — envelope_unwrap (after_fix)

- **Severity:** blocker
- **Location:** api.ts
- **Symptom:** No .data unwrap — consumers cascade-break
- **Root cause hint:** Recipe lacked DFG edge adapter
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** No .data unwrap — consumers cascade-break
- **Citations:**
  - `[report_field]` behavioralPass=false expected without .data

## Repair process

1. **iss-1** — Deterministic import users-list-v1 → v2 (deterministic_ast) → discovered iss-2

## Summary

- Issues: 2 (passed 0, failed 2)
- Cascade edges: 1
- After primary fix: discovered 0 follow-up issue(s); completed 0; remaining 0
- All issues pass: false
- Aggregator mean (secondary): 0.6
- Narrative: Pure AST bumped package import only. Envelope unwrap cascade left open.
