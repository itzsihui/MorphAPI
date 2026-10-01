# Repair report — multi-site (pure_ast)

Generated: `2026-09-17T07:59:23.868Z`

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
- **Location:** notify.ts:15
- **Symptom:** sendEmail in notify.ts
- **Root cause hint:** Pure AST primary file only
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** notify.ts migrated
- **Citations:**
  - `[report_field]` completenessPass=false, leftover=2, callers=1

### iss-2 — api_rename (initial)

- **Severity:** blocker
- **Location:** notify.ts:28
- **Symptom:** sendEmail in notify.ts
- **Root cause hint:** Pure AST primary file only
- **Pass:** FAIL
- **Scores:** compile=0 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** notify.ts migrated
- **Citations:**
  - `[report_field]` completenessPass=false, leftover=2, callers=1

### iss-6 — multi_site_leftover (impact_1hop)

- **Severity:** major
- **Location:** cron.ts:7
- **Symptom:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Root cause hint:** Cascaded from iss-1 (1° impact: same_api_leftover)
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=1 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** FAIL: leftover sites outside recipe
- **Citations:**
  - `[report_field]` completenessPass=false, leftover=2, callers=1

### iss-7 — multi_site_leftover (impact_1hop)

- **Severity:** major
- **Location:** seed.ts:9
- **Symptom:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Root cause hint:** Cascaded from iss-1 (1° impact: same_api_leftover)
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=1 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** FAIL: leftover sites outside recipe
- **Citations:**
  - `[report_field]` completenessPass=false, leftover=2, callers=1

### iss-8 — caller_contract (impact_1hop)

- **Severity:** major
- **Location:** onboarding.ts:12
- **Symptom:** Direct caller still treats notifyUser() return as string; needs SendResult.messageId
- **Root cause hint:** Cascaded from iss-1 (1° impact: caller_contract)
- **Caused by:** iss-1
- **Pass:** FAIL
- **Scores:** compile=1 oracle=1 semantic=0 locality=1 cascade=0
- **Rationale:** FAIL: 1° caller contract not adapted
- **Citations:**
  - `[report_field]` completenessPass=false, leftover=2, callers=1

## Repair process

1. **iss-1** — AST recipe: migrate notify.ts sendEmail + return SendResult (no caller/leftover fixes) (deterministic_ast) → discovered iss-6, iss-7, iss-8
   - 1° impact: 2 leftovers + 1 callers (not fixed by Pure AST)

## Impact analysis (1°)

- **imp-3** from iss-1: cron.ts:7 — same_api_leftover: Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **imp-4** from iss-1: seed.ts:9 — same_api_leftover: Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **imp-5** from iss-1: onboarding.ts:12 — caller_contract: Direct caller still treats notifyUser() return as string; needs SendResult.messageId

## Summary

- Issues: 5 (passed 0, failed 5)
- Cascade edges: 3
- After primary fix: discovered 3 follow-up issue(s); completed 0; remaining 3
- All issues pass: false
- Aggregator mean (secondary): 0.68
- Narrative: Pure AST migrated notify.ts only; 2 leftover sendEmail site(s) and 1 1° caller(s) remain.
