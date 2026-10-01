# Repair report — openai-deprecated-bias (pure_ast)

Generated: `2026-09-17T06:55:53.042Z`

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
- **Root cause hint:** Pure AST recipe: rename call only
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Call-site rename applied surgically
- **Citations:**
  - `[tsc]` typecheckPass=false; bareCtor=true

### iss-2 — api_rename (initial)

- **Severity:** blocker
- **Location:** chat.ts:26
- **Symptom:** ChatCompletion.create / engine
- **Root cause hint:** Pure AST recipe: rename call only
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Call-site rename applied surgically
- **Citations:**
  - `[tsc]` typecheckPass=false; bareCtor=true

### iss-3 — constructor_shape (after_typecheck)

- **Severity:** blocker
- **Location:** chat.ts
- **Symptom:** Constructor still bare string — Pure AST recipe did not cover it
- **Root cause hint:** Cascade after call-site rename
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** FAIL: Pure AST stopped after primary rename; constructor cascade unfixed
- **Citations:**
  - `[tsc]` typecheckPass=false; bareCtor=true

## Repair process

1. **iss-2** — AST recipe: rename span L26 (deterministic_ast)
2. **iss-1** — AST recipe: rename span L11 (deterministic_ast) → discovered iss-3
   - typecheck/re-scan: constructor_shape remains (recipe incomplete)

## Summary

- Issues: 3 (passed 0, failed 3)
- Cascade edges: 1
- After primary fix: discovered 0 follow-up issue(s); completed 0; remaining 0
- All issues pass: false
- Aggregator mean (secondary): 0.667
- Narrative: Pure AST renamed ChatCompletion→completions but left new OpenAI(string). Cascade Issue B remains — recipe ceiling.
