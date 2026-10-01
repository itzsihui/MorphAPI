# Repair report — payload-envelope (pure_llm)

Generated: `2026-09-17T07:47:48.701Z`

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
- **Location:** api.ts
- **Symptom:** listUsers package bump
- **Root cause hint:** LLM whole-file
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=0 locality=0 cascade=0
- **Rationale:** Import/API rewrite
- **Citations:**
  - `[report_field]` behavioralPass=false

### iss-2 — envelope_unwrap (after_fix)

- **Severity:** blocker
- **Location:** api.ts
- **Symptom:** .data unwrap at edge
- **Root cause hint:** DFG cascade
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=0 locality=0 cascade=0
- **Rationale:** FAIL: envelope unwrap missed — consumers cascade
- **Citations:**
  - `[report_field]` behavioralPass=false

## Repair process

1. **iss-1** — LLM rewrite (whole_file) → discovered iss-2

## Summary

- Issues: 2 (passed 0, failed 2)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 0; remaining 1
- All issues pass: false
- Aggregator mean (secondary): 0.2
- Narrative: LLM-only may bump import without .data edge adapter.
