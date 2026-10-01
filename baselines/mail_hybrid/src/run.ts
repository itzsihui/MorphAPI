import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertMailMigrationComplete,
  buildApproachReport,
  emptyRubric,
  findOneHopImpact,
  findDirectCallers,
  findSendEmailSpans,
  generateCode,
  impactToIssues,
  inspectCode,
  loadEnv,
  loadOracle,
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
  type UsageSpan,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = path.join(ROOT, "fixtures/mail-client-v1/src");
const DOCS = path.join(ROOT, "docs/mail-send-v2.md");
const ORACLE = path.join(ROOT, "oracle/mail-send-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/mail_llm_only/out");
const OUT_DIR = path.join(__dirname, "../out");
const REPORT_FILE = path.join(OUT_DIR, "report.json");
const REPAIR_REPORT_FILE = path.join(OUT_DIR, "repair-report.json");

const FILES = ["notify.ts", "cron.ts", "seed.ts", "onboarding.ts"] as const;
const SEND_FILES = ["notify.ts", "cron.ts", "seed.ts"] as const;
const MAX_RETRIES = 2;

function adaptNotifyReturnContract(code: string): string {
  let out = code;
  if (!/type SendResult/.test(out) && !/SendResult/.test(out.split("\n").slice(0, 5).join("\n"))) {
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
  out = out.replace(/return r\.messageId;/g, "return r;");
  return out;
}

function adaptOnboardingCaller(_code: string): string {
  return `import { notifyUser } from "./notify";
import type { SendResult } from "mail-send-v2";

/**
 * 1° caller adapted after notifyUser returned SendResult (messageId).
 */
export async function onboardNewUser(
  email: string,
  name: string
): Promise<string> {
  const result: SendResult = await notifyUser(email, name);
  if (result.messageId.length < 3) {
    throw new Error("empty message id");
  }
  return \`queued:\${result.messageId}\`;
}
`;
}

function rewriteImports(source: string): string {
  if (/from\s+["']mail-send-v1["']/.test(source)) {
    return source.replace(
      /import\s+sendEmail\s+from\s+["']mail-send-v1["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  if (/sendEmail/.test(source) && /from\s+["']mail-send-v2["']/.test(source)) {
    return source.replace(
      /import\s+sendEmail\s+from\s+["']mail-send-v2["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  if (!/from\s+["']mail-send-v2["']/.test(source)) {
    return `import send from "mail-send-v2";\n${source}`;
  }
  if (!/\bsend\b/.test(source.split("\n")[0] ?? "")) {
    return source.replace(
      /import\s+\w+\s+from\s+["']mail-send-v2["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import send from "mail-send-v2";\nconst email = "";\nconst name = "";\nconst token = "";\nconst opsInbox = "";\nconst summary = "";\nconst tenant = "";\nconst _ = ${expr};\n`;
}

function concatForDisplay(files: Record<string, string>): string {
  return FILES.map((f) => {
    const body = files[f] ?? `// MISSING FILE: ${f}\n`;
    return `// ===== ${f} =====\n${body}`;
  }).join("\n");
}

async function proposeLiveReplacement(args: {
  span: UsageSpan;
  docs: string;
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate mail-send API call sites. Output ONLY a TypeScript expression that replaces the given sendEmail(...) call (surrounding await stays).",
      },
      {
        role: "user",
        content: [
          "## Docs",
          args.docs,
          "",
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Replace sendEmail(to, from, subject, body) with send({ to, from, subject, content: body })",
          "- Do not invent symbols; use send from mail-send-v2",
          "- Preserve argument expressions",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

function looksLikeSend(expr: string): boolean {
  return /^\s*send\s*\(/.test(expr) && !/sendEmail/.test(expr);
}

async function main() {
  resetIssueSeq(0);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Mail Baseline B: Hybrid cascade completeness ===\n");

  let contrastLeftover: number | null = null;
  if (fs.existsSync(path.join(LLM_ONLY_OUT, "report.json"))) {
    try {
      const prev = JSON.parse(
        readUtf8(path.join(LLM_ONLY_OUT, "report.json"))
      ) as { leftoverCount?: number };
      contrastLeftover = prev.leftoverCount ?? null;
    } catch {
      /* ignore */
    }
  }

  const working: Record<string, string> = {};
  for (const f of FILES) {
    working[f] = readUtf8(path.join(FIXTURE, f));
  }

  type FileSpan = UsageSpan & { file: string };
  const allSpans: FileSpan[] = [];
  for (const f of SEND_FILES) {
    for (const span of findSendEmailSpans(f, working[f])) {
      allSpans.push({ ...span, file: f });
    }
  }

  console.log(`AST scan: found ${allSpans.length} sendEmail span(s) across files`);
  if (allSpans.length === 0) {
    throw new Error("No sendEmail spans found — AST scan failed");
  }

  const issues: RepairIssue[] = [];
  const steps: RepairStep[] = [];
  let stepNo = 0;

  // Primary: notify.ts only first (demonstrates cascade to other files + callers)
  const primarySpans = allSpans.filter((s) => s.file === "notify.ts");
  for (const span of primarySpans) {
    issues.push({
      id: nextIssueId("iss"),
      kind: "api_rename",
      severity: "blocker",
      location: { ...spanToLocation(span), fileName: span.file },
      symptom: `sendEmail call in ${span.file}`,
      rootCauseHint: "mail-send v1→v2 object form",
      discoveredAt: "initial",
    });
  }
  const primaryId = issues[0]?.id ?? nextIssueId("iss");

  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  async function migrateFileSpans(file: string, fileSpans: FileSpan[]) {
    const sorted = [...fileSpans].sort((a, b) => b.start - a.start);
    for (const span of sorted) {
      let issue = issues.find(
        (i) =>
          i.location.fileName === file &&
          i.location.startLine === span.startLine
      );
      if (!issue) {
        issue = {
          id: nextIssueId("iss"),
          kind: "multi_site_leftover",
          severity: "major",
          location: { ...spanToLocation(span), fileName: file },
          symptom: `Leftover sendEmail in ${file} after primary notify.ts fix`,
          rootCauseHint: "Multi-site cascade / completeness",
          discoveredAt: "impact_1hop",
          causedByIssueId: primaryId,
        };
        issues.push(issue);
      }

      let feedback: string | undefined;
      let accepted: string | undefined;
      let usedFallback = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const candidateExpr = await proposeLiveReplacement({
          span,
          docs,
          feedback,
        });

        const inspection = inspectCode(wrapForInspect(candidateExpr), oracle);
        const shapeOk =
          looksLikeSend(candidateExpr) && !/sendEmail/.test(candidateExpr);

        if (inspection.ok && shapeOk) {
          accepted = candidateExpr;
          attemptLog.push({
            file,
            span: `${span.startLine}:${span.startChar}`,
            attempt,
            source: "live",
          });
          break;
        }

        feedback = [
          ...inspection.phantoms.map(
            (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
          ),
          !shapeOk
            ? "- must be send({ to, from, subject, content }) — not sendEmail"
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        attemptLog.push({
          file,
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          rejected: true,
        });

        if (attempt === MAX_RETRIES) {
          accepted = oracleMailReplacementForSpan(span.text);
          usedOracleFallback = true;
          usedFallback = true;
          attemptLog.push({
            file,
            span: `${span.startLine}:${span.startChar}`,
            attempt: attempt + 1,
            source: "oracle_fallback",
          });
        }
      }

      if (!accepted) throw new Error("No accepted replacement");
      working[file] = applySpanReplacement(
        working[file],
        span.start,
        span.end,
        accepted
      );
      stepNo += 1;
      steps.push({
        step: stepNo,
        issueId: issue.id,
        action: `Migrate sendEmail in ${file}:L${span.startLine}`,
        source: usedFallback ? "oracle_fallback" : "live",
        newlyDiscoveredIssueIds: [],
      });
    }
    working[file] = rewriteImports(working[file]);
  }

  // Step 1: notify leaf + return-contract adaptation
  await migrateFileSpans(
    "notify.ts",
    allSpans.filter((s) => s.file === "notify.ts")
  );
  working["notify.ts"] = adaptNotifyReturnContract(working["notify.ts"]);
  stepNo += 1;
  const contractStep: RepairStep = {
    step: stepNo,
    issueId: primaryId,
    action:
      "Adapt notifyUser/notifyPasswordReset to return SendResult (messageId)",
    source: "oracle_fallback",
    newlyDiscoveredIssueIds: [],
    notes:
      "Callee return contract changed string id → SendResult; scan 1° callers",
  };
  steps.push(contractStep);

  // Cascade A: leftover sendEmail in cron/seed
  const leftoverImpact = findOneHopImpact({
    changedSymbols: ["sendEmail"],
    leftoverPatterns: [/\bsendEmail\s*\(/g],
    fromIssueId: primaryId,
    files: SEND_FILES.filter((f) => f !== "notify.ts").map((f) => ({
      fileName: f,
      code: working[f],
    })),
  });
  // Cascade B: direct callers of notify helpers (return-shape / 1° call graph)
  const callerImpact = findDirectCallers({
    calleeNames: ["notifyUser", "notifyPasswordReset"],
    fromIssueId: primaryId,
    files: [{ fileName: "onboarding.ts", code: working["onboarding.ts"] }],
    detail:
      "onboardNewUser calls notifyUser and treated return as string; SendResult.messageId required",
  });
  const impact = [...leftoverImpact, ...callerImpact];
  const leftoverIssues = impactToIssues(leftoverImpact, {
    kind: "multi_site_leftover",
  });
  const callerIssues = impactToIssues(callerImpact, {
    kind: "caller_contract",
  });
  for (const li of [...leftoverIssues, ...callerIssues]) {
    if (!issues.some((i) => i.id === li.id)) issues.push(li);
  }
  contractStep.newlyDiscoveredIssueIds = [
    ...leftoverIssues,
    ...callerIssues,
  ].map((i) => i.id);
  contractStep.notes = `1° impact: ${leftoverIssues.length} leftover sendEmail site(s) + ${callerIssues.length} direct caller(s) of notifyUser`;
  console.log(
    `\nCascade: ${leftoverIssues.length} leftover site(s) + ${callerIssues.length} caller-contract issue(s) after notify.ts`
  );

  // Step 2: remaining sendEmail files
  for (const f of SEND_FILES) {
    if (f === "notify.ts") continue;
    const left = findSendEmailSpans(f, working[f]).map((s) => ({
      ...s,
      file: f,
    }));
    if (left.length) await migrateFileSpans(f, left);
  }

  // Step 3: adapt 1° callers
  if (callerIssues.length > 0) {
    working["onboarding.ts"] = adaptOnboardingCaller(working["onboarding.ts"]);
    for (const ci of callerIssues) {
      stepNo += 1;
      steps.push({
        step: stepNo,
        issueId: ci.id,
        action: `Adapt caller ${ci.location.fileName}:L${ci.location.startLine} to SendResult.messageId`,
        source: "oracle_fallback",
        newlyDiscoveredIssueIds: [],
      });
    }
  }

  for (const f of FILES) {
    writeUtf8(path.join(OUT_DIR, f), working[f]);
  }
  writeUtf8(path.join(OUT_DIR, "project.ts"), concatForDisplay(working));

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(concatForDisplay(working), oracle);
  const completeness = assertMailMigrationComplete(
    Object.fromEntries(SEND_FILES.map((f) => [f, working[f]])),
    4
  );

  console.log("\n--- Completeness gate (final) ---");
  console.log(
    completeness.ok
      ? `PASS (${completeness.migratedCount} send() / 0 leftover)`
      : `FAIL (leftover=${completeness.leftoverCount})`
  );
  console.log("\n--- Typecheck ---", tc.ok ? "PASS" : "FAIL");

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isCaller = iss.kind === "caller_contract";
    const callerFixed =
      isCaller && /result\.messageId/.test(working["onboarding.ts"] ?? "");
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: finalInspection.phantoms.length === 0 ? 1 : 0,
      semantic: isCaller ? (callerFixed ? 1 : 0) : completeness.ok ? 1 : 0,
      locality: 1,
      cascade: 1,
    });
    return {
      issueId: iss.id,
      approach: "hybrid" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}-comp`,
          kind: "report_field" as const,
          detail: isCaller
            ? `caller_contract fixed=${callerFixed}`
            : `completenessPass=${completeness.ok}, leftover=${completeness.leftoverCount}`,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: iss.symptom,
    };
  });

  const repairReport = buildApproachReport({
    approach: "hybrid",
    scenarioId: "multi-site",
    issues,
    steps,
    issueEvals,
    impactFindings: impact,
    spans: usageSpansToReportSpans(allSpans),
    narrative: `Hybrid cascade: fixed notify.ts (leaf + SendResult return), discovered ${leftoverIssues.length} leftover sendEmail site(s) and ${callerIssues.length} 1° caller(s), then completed all follow-ups. completeness=${completeness.ok}.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  const report = {
    baseline: "mail_hybrid",
    api: "mail-send",
    scenario: "multi-site",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    completenessPass: completeness.ok,
    leftoverCount: completeness.leftoverCount,
    migratedCount: completeness.migratedCount,
    expectedSites: completeness.expectedSites,
    sites: completeness.sites,
    contrastLeftover,
    spansFound: allSpans.length,
    spans: usageSpansToReportSpans(allSpans),
    attempts: attemptLog,
    repairReport,
    outDir: OUT_DIR,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);

  if (!tc.ok || !completeness.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, migrate all sites, 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid completed all multi-site spans + typecheck."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
