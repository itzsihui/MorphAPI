# Repair report — async-contagion (hybrid)

Generated: `2026-09-17T07:47:48.737Z`

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
- **Location:** io.ts
- **Symptom:** getObject().promise → send(GetObjectCommand)
- **Root cause hint:** Leaf AST
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Leaf migrated
- **Citations:**
  - `[tsc]` hybrid claim check

### iss-2 — missing_await (impact_1hop)

- **Severity:** blocker
- **Location:** app.ts
- **Symptom:** 1° caller contagion
- **Root cause hint:** impact_1hop
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Callers fixed
- **Citations:**
  - `[tsc]` hybrid claim check

## Repair process

1. **iss-1** — Migrate io.ts spans (live) → discovered iss-2
   - 1° impact on app.ts
2. **iss-2** — Rewrite app.ts async coloring (oracle_fallback)

## Summary

- Issues: 2 (passed 2, failed 0)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 1; remaining 0
- All issues pass: true
- Aggregator mean (secondary): 1
- Narrative: Hybrid cascade: leaf I/O then 1° app.ts async propagation.
