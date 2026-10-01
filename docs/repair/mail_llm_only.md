# Repair report — multi-site (pure_llm)

Generated: `2026-09-17T07:47:48.702Z`

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
- **Location:** notify.ts
- **Symptom:** Primary sendEmail migration
- **Root cause hint:** LLM often rewrites one file
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=0 cascade=0
- **Rationale:** Partial migration may typecheck
- **Citations:**
  - `[report_field]` completenessPass=false

### iss-2 — multi_site_leftover (impact_1hop)

- **Severity:** major
- **Location:** cron.ts|seed.ts
- **Symptom:** Leftover sendEmail sites (2)
- **Root cause hint:** Multi-site cascade
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=1 oracle=0 semantic=0 locality=0 cascade=0
- **Rationale:** FAIL: leftover call sites after primary file fix
- **Citations:**
  - `[report_field]` leftoverCount=2

## Repair process

1. **iss-1** — LLM rewrite (often incomplete) (whole_file) → discovered iss-2

## Summary

- Issues: 2 (passed 1, failed 1)
- Cascade edges: 1
- After primary fix: discovered 1 follow-up issue(s); completed 0; remaining 1
- All issues pass: false
- Aggregator mean (secondary): 0.4
- Narrative: LLM-only completenessPass=false, leftover=2.
