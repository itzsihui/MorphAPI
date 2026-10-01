import * as path from "path";
import {
  applySpanReplacement,
  assertMailMigrationComplete,
  buildApproachReport,
  emptyRubric,
  findDirectCallers,
  findOneHopImpact,
  findSendEmailSpans,
  impactToIssues,
  nextIssueId,
  oracleMailReplacementForSpan,
  readUtf8,
  resetIssueSeq,
  runTypecheck,
  scoreIssuePass,
  spanToLocation,
  usageSpansToReportSpans,
  writeRepairReportJson,
  writeUtf8,
  type IssueEval,
  type RepairIssue,
  type RepairStep,
} from "@morphapi/core";

/** Pure AST: migrate notify.ts leaf only — leftovers + 1° callers cascade. */
const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = path.join(ROOT, "fixtures/mail-client-v1/src");
const OUT_DIR = path.join(__dirname, "../out");
const REPORT_FILE = path.join(OUT_DIR, "report.json");
const REPAIR_REPORT_FILE = path.join(OUT_DIR, "repair-report.json");
const FILES = ["notify.ts", "cron.ts", "seed.ts", "onboarding.ts"] as const;
const SEND_FILES = ["notify.ts", "cron.ts", "seed.ts"] as const;

function adaptNotifyReturnContract(code: string): string {
  let out = code;
  if (!/SendResult/.test(out.split("\n").slice(0, 5).join("\n"))) {
    out = out.replace(
      /import send from ["']mail-send-v2["']\s*;?/,
      `import send, { type SendResult } from "mail-send-v2";`
    );
  }
  out = out.replace(/Promise<string>/g, "Promise<SendResult>");
  out = out.replace(
    /const r = await (send\(\{[\s\S]*?\}\));\s*\n\s*return r\.id;/g,
    "return await $1;"
  );
  out = out.replace(/return r\.id;/g, "return r;");
  return out;
}

async function main() {
  resetIssueSeq(0);
  const working: Record<string, string> = {};
  for (const f of FILES) working[f] = readUtf8(path.join(FIXTURE, f));

  const notifySpans = findSendEmailSpans("notify.ts", working["notify.ts"]);
  const issues: RepairIssue[] = notifySpans.map((s) => ({
    id: nextIssueId("iss"),
    kind: "api_rename" as const,
    severity: "blocker" as const,
    location: { ...spanToLocation(s), fileName: "notify.ts" },
    symptom: "sendEmail in notify.ts",
    rootCauseHint: "Pure AST primary file only",
    discoveredAt: "initial" as const,
  }));
  const primaryId = issues[0]?.id ?? nextIssueId("iss");
  const steps: RepairStep[] = [];

  let code = working["notify.ts"];
  for (const span of [...notifySpans].sort((a, b) => b.start - a.start)) {
    code = applySpanReplacement(
      code,
      span.start,
      span.end,
      oracleMailReplacementForSpan(span.text)
    );
  }
  code = code.replace(
    /import\s+sendEmail\s+from\s+["']mail-send-v1["']\s*;?/,
    `import send from "mail-send-v2";`
  );
  code = adaptNotifyReturnContract(code);
  working["notify.ts"] = code;
  steps.push({
    step: 1,
    issueId: primaryId,
    action:
      "AST recipe: migrate notify.ts sendEmail + return SendResult (no caller/leftover fixes)",
    source: "deterministic_ast",
    newlyDiscoveredIssueIds: [],
  });

  const leftoverImpact = findOneHopImpact({
    changedSymbols: ["sendEmail"],
    leftoverPatterns: [/\bsendEmail\s*\(/g],
    fromIssueId: primaryId,
    files: [
      { fileName: "cron.ts", code: working["cron.ts"] },
      { fileName: "seed.ts", code: working["seed.ts"] },
    ],
  });
  const callerImpact = findDirectCallers({
    calleeNames: ["notifyUser", "notifyPasswordReset"],
    fromIssueId: primaryId,
    files: [{ fileName: "onboarding.ts", code: working["onboarding.ts"] }],
    detail:
      "Direct caller still treats notifyUser() return as string; needs SendResult.messageId",
  });
  const impact = [...leftoverImpact, ...callerImpact];
  const leftovers = impactToIssues(leftoverImpact, { kind: "multi_site_leftover" });
  const callers = impactToIssues(callerImpact, { kind: "caller_contract" });
  for (const l of [...leftovers, ...callers]) issues.push(l);
  steps[0].newlyDiscoveredIssueIds = [...leftovers, ...callers].map((l) => l.id);
  steps[0].notes = `1° impact: ${leftovers.length} leftovers + ${callers.length} callers (not fixed by Pure AST)`;

  for (const f of FILES) writeUtf8(path.join(OUT_DIR, f), working[f]);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const completeness = assertMailMigrationComplete(
    Object.fromEntries(SEND_FILES.map((f) => [f, working[f]])),
    4
  );

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isPrimary = iss.discoveredAt === "initial";
    const scores = emptyRubric({
      compile: isPrimary ? (tc.ok ? 1 : 0) : 1,
      oracle: 1,
      semantic: isPrimary ? 1 : 0,
      locality: 1,
      cascade: isPrimary ? 1 : 0,
    });
    return {
      issueId: iss.id,
      approach: "pure_ast" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}`,
          kind: "report_field" as const,
          detail: `completenessPass=${completeness.ok}, leftover=${completeness.leftoverCount}, callers=${callers.length}`,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: isPrimary
        ? "notify.ts migrated"
        : iss.kind === "caller_contract"
          ? "FAIL: 1° caller contract not adapted"
          : "FAIL: leftover sites outside recipe",
    };
  });

  const repairReport = buildApproachReport({
    approach: "pure_ast",
    scenarioId: "multi-site",
    issues,
    steps,
    issueEvals,
    impactFindings: impact,
    spans: usageSpansToReportSpans(notifySpans),
    narrative: `Pure AST migrated notify.ts only; ${leftovers.length} leftover sendEmail site(s) and ${callers.length} 1° caller(s) remain.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);
  writeUtf8(
    REPORT_FILE,
    JSON.stringify(
      {
        baseline: "mail_ast",
        mode: "deterministic_ast",
        typecheckPass: tc.ok,
        completenessPass: completeness.ok,
        leftoverCount: completeness.leftoverCount,
        spansFound: notifySpans.length,
        callerContractOpen: callers.length,
        repairReport,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `Pure AST mail → leftover=${completeness.leftoverCount} callers=${callers.length} tsc=${tc.ok}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
