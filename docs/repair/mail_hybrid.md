# Repair report — multi-site (hybrid)

Generated: `2026-09-17T07:58:26.802Z`

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
- **Symptom:** sendEmail call in notify.ts
- **Root cause hint:** mail-send v1→v2 object form
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** sendEmail call in notify.ts
- **Citations:**
  - `[report_field]` completenessPass=true, leftover=0

### iss-2 — api_rename (initial)

- **Severity:** blocker
- **Location:** notify.ts:28
- **Symptom:** sendEmail call in notify.ts
- **Root cause hint:** mail-send v1→v2 object form
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** sendEmail call in notify.ts
- **Citations:**
  - `[report_field]` completenessPass=true, leftover=0

### iss-6 — multi_site_leftover (impact_1hop)

- **Severity:** major
- **Location:** cron.ts:7
- **Symptom:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Root cause hint:** Cascaded from iss-1 (1° impact: same_api_leftover)
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Citations:**
  - `[report_field]` completenessPass=true, leftover=0

### iss-7 — multi_site_leftover (impact_1hop)

- **Severity:** major
- **Location:** seed.ts:9
- **Symptom:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Root cause hint:** Cascaded from iss-1 (1° impact: same_api_leftover)
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **Citations:**
  - `[report_field]` completenessPass=true, leftover=0

### iss-8 — caller_contract (impact_1hop)

- **Severity:** major
- **Location:** onboarding.ts:12
- **Symptom:** onboardNewUser calls notifyUser and treated return as string; SendResult.messageId required
- **Root cause hint:** Cascaded from iss-1 (1° impact: caller_contract)
- **Caused by:** iss-1
- **Pass:** PASS
- **Scores:** compile=1 oracle=1 semantic=1 locality=1 cascade=1
- **Rationale:** onboardNewUser calls notifyUser and treated return as string; SendResult.messageId required
- **Citations:**
  - `[report_field]` caller_contract fixed=true

## Repair process

1. **iss-2** — Migrate sendEmail in notify.ts:L28 (live)
2. **iss-1** — Migrate sendEmail in notify.ts:L15 (live)
3. **iss-1** — Adapt notifyUser/notifyPasswordReset to return SendResult (messageId) (oracle_fallback) → discovered iss-6, iss-7, iss-8
   - 1° impact: 2 leftover sendEmail site(s) + 1 direct caller(s) of notifyUser
4. **iss-6** — Migrate sendEmail in cron.ts:L7 (live)
5. **iss-7** — Migrate sendEmail in seed.ts:L9 (live)
6. **iss-8** — Adapt caller onboarding.ts:L12 to SendResult.messageId (oracle_fallback)

## Impact analysis (1°)

- **imp-3** from iss-1: cron.ts:7 — same_api_leftover: Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **imp-4** from iss-1: seed.ts:9 — same_api_leftover: Leftover API pattern /\bsendEmail\s*\(/g still present after primary fix
- **imp-5** from iss-1: onboarding.ts:12 — caller_contract: onboardNewUser calls notifyUser and treated return as string; SendResult.messageId required

## Summary

- Issues: 5 (passed 5, failed 0)
- Cascade edges: 3
- After primary fix: discovered 3 follow-up issue(s); completed 3; remaining 0
- All issues pass: true
- Aggregator mean (secondary): 1
- Narrative: Hybrid cascade: fixed notify.ts (leaf + SendResult return), discovered 2 leftover sendEmail site(s) and 1 1° caller(s), then completed all follow-ups. completeness=true.
