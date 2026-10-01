# Repair report — openai-deprecated-bias (pure_llm)

Generated: `2026-09-17T06:56:40.423Z`

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
- **Location:** chat.ts
- **Symptom:** ChatCompletion migration
- **Root cause hint:** whole-file LLM
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=0 cascade=0
- **Rationale:** Primary rewrite

### iss-2 — constructor_shape (after_fix)

- **Severity:** blocker
- **Location:** chat.ts
- **Symptom:** Bare ctor remains
- **Root cause hint:** cascade
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=0 locality=0 cascade=0
- **Rationale:** FAIL ctor cascade

## Repair process

1. **iss-1** — Whole-file LLM (whole_file) → discovered iss-2

## Summary

- Issues: 2 (passed 0, failed 2)
- Cascade edges: 1
- After primary fix: discovered 0 follow-up issue(s); completed 0; remaining 0
- All issues pass: false
- Aggregator mean (secondary): 0.3
- Narrative: LLM-only openai: tsc=false, phantoms=0, bareCtor=true.
