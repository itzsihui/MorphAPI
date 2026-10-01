# Repair report — async-contagion (pure_llm)

Generated: `2026-09-17T07:47:48.697Z`

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
- **Symptom:** getObject().promise leaf migration
- **Root cause hint:** Whole-file / partial LLM
- **Pass:** FAIL
- **Scores:** compile=0 oracle=0 semantic=1 locality=0 cascade=0
- **Rationale:** Leaf migration attempt (LLM-only)
- **Citations:**
  - `[tsc]` typecheckPass=false, phantoms=1

### iss-2 — missing_await (after_fix)

- **Severity:** blocker
- **Location:** app.ts
- **Symptom:** Caller contagion after leaf async
- **Root cause hint:** 1° impact — often missed by LLM-only
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=0 oracle=0 semantic=0 locality=0 cascade=0
- **Rationale:** Cascade caller fix usually missing in LLM-only
- **Citations:**
  - `[impact]` app.ts contagion typically remains

## Repair process

1. **iss-1** — LLM rewrite io.ts (whole_file) → discovered iss-2

## Summary

- Issues: 2 (passed 0, failed 2)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 0; remaining 1
- All issues pass: false
- Aggregator mean (secondary): 0.1
- Narrative: LLM-only often migrates leaf I/O then leaves app.ts contagion open.
