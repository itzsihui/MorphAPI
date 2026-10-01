# Repair report — payload-envelope (hybrid)

Generated: `2026-09-17T07:47:48.738Z`

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
- **Location:** api.ts
- **Symptom:** listUsers edge
- **Root cause hint:** AST span
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Edge adapted
- **Citations:**
  - `[tsc]` hybrid claim check

### iss-2 — envelope_unwrap (after_fix)

- **Severity:** blocker
- **Location:** users.ts
- **Symptom:** .data unwrap for consumers
- **Root cause hint:** DFG cascade
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Consumers safe
- **Citations:**
  - `[tsc]` hybrid claim check

## Repair process

1. **iss-1** — Edge adapter with .data (live) → discovered iss-2

## Summary

- Issues: 2 (passed 2, failed 0)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 1; remaining 0
- All issues pass: true
- Aggregator mean (secondary): 1
- Narrative: Hybrid cascade: unwrap .data at edge so users.ts stays User[].
