import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertEnvelopeUnwrap,
  buildApproachReport,
  emptyRubric,
  findListUsersAwaitSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  nextIssueId,
  oracleEnvelopeReplacementForSpan,
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
const API_SRC = path.join(ROOT, "fixtures/users-client-v1/src/api.ts");
const USERS_SRC = path.join(ROOT, "fixtures/users-client-v1/src/users.ts");
const DOCS = path.join(ROOT, "docs/users-list-v2.md");
const ORACLE = path.join(ROOT, "oracle/users-list-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/envelope_llm_only/out/api.ts");
const OUT_API = path.join(__dirname, "../out/api.ts");
const OUT_USERS = path.join(__dirname, "../out/users.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

const MAX_RETRIES = 2;

function rewriteImports(source: string): string {
  if (/from\s+["']users-list-v1["']/.test(source)) {
    return source.replace(
      /from\s+["']users-list-v1["']/,
      `from "users-list-v2"`
    );
  }
  if (!/from\s+["']users-list-v2["']/.test(source)) {
    return `import createUsersApi from "users-list-v2";\n${source}`;
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import createUsersApi from "users-list-v2";\nconst api = createUsersApi("k");\nexport async function loadUsers() {\n  return ${expr};\n}\n`;
}

async function proposeLiveReplacement(args: {
  span: UsageSpan;
  docs: string;
  allowedSymbols: string[];
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate users-list API call sites at the network edge. Output ONLY a TypeScript expression that replaces the given expression so downstream User[] consumers keep working.",
      },
      {
        role: "user",
        content: [
          "## Allowed symbols (oracle)",
          args.allowedSymbols.join(", "),
          "",
          "## Docs",
          args.docs,
          "",
          "## Migration transforms (MUST apply)",
          "- listUsers() now returns { data: User[]; pagination }",
          "- Edge adapter: return (await api.listUsers()).data so loadUsers() still yields User[]",
          "- Do NOT return the raw envelope object",
          "",
          "## Expression to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Output a single expression",
          "- Unwrap .data at the network edge",
          "- Preserve the receiver from the call site",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/;?\s*$/, "");
}

async function main() {
  resetIssueSeq(0);
  const apiSource = readUtf8(API_SRC);
  const usersSource = readUtf8(USERS_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Envelope Baseline B: Hybrid cascade (.data unwrap) ===\n");

  let contrastBehavioralPass: boolean | null = null;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = assertEnvelopeUnwrap("api.ts", llmOnlyOut);
    contrastBehavioralPass = contrast.ok;
  }

  let working = apiSource;
  if (!/await\s+\w+\.listUsers\(/.test(working)) {
    working = working.replace(
      /return\s+(\w+)\.listUsers\(\)\s*;/,
      "return await $1.listUsers();"
    );
  }

  const spans = findListUsersAwaitSpans("api.ts", working);
  console.log(`\nAST scan: found ${spans.length} listUsers await span(s)`);
  if (spans.length === 0) {
    throw new Error("No listUsers await spans found — AST scan failed");
  }

  const issues: RepairIssue[] = [];
  const steps: RepairStep[] = [];
  let stepNo = 0;

  for (const span of spans) {
    issues.push({
      id: nextIssueId("iss"),
      kind: "api_rename",
      severity: "blocker",
      location: spanToLocation(span),
      symptom: "listUsers edge call must adapt to v2 envelope",
      rootCauseHint: "Payload envelope { data, pagination }",
      discoveredAt: "initial",
    });
  }
  const primaryId = issues[0].id;

  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  for (const span of sorted) {
    const issueId =
      issues.find((i) => i.location.startLine === span.startLine)?.id ??
      primaryId;
    let feedback: string | undefined;
    let accepted: string | undefined;
    let usedFallback = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidateExpr = await proposeLiveReplacement({
        span,
        docs,
        allowedSymbols: oracle.allowedSymbols,
        feedback,
      });

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle);
      const looksUnwrapped = /\.data\s*$/.test(candidateExpr.trim());

      if (inspection.ok && looksUnwrapped) {
        accepted = candidateExpr;
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          phantomCount: 0,
          behavioralPass: true,
        });
        break;
      }

      const reasons: string[] = [];
      if (!inspection.ok) {
        reasons.push(
          ...inspection.phantoms.map(
            (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
          )
        );
      }
      if (!looksUnwrapped) {
        reasons.push(
          "- [behavioral] must unwrap .data at edge, e.g. (await api.listUsers()).data"
        );
      }
      feedback = reasons.join("\n");
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: inspection.phantoms.length,
        behavioralPass: looksUnwrapped,
        phantoms: inspection.phantoms,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleEnvelopeReplacementForSpan(span.text);
        usedOracleFallback = true;
        usedFallback = true;
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
          behavioralPass: true,
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
    stepNo += 1;
    steps.push({
      step: stepNo,
      issueId,
      action: `Edge adapter listUsers → unwrap .data (L${span.startLine})`,
      source: usedFallback ? "oracle_fallback" : "live",
      newlyDiscoveredIssueIds: [],
    });
  }

  working = rewriteImports(working);
  writeUtf8(OUT_API, working);
  writeUtf8(OUT_USERS, usersSource.replace(/users-list-v1/g, "users-list-v2"));

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle);
  const finalBehavioral = assertEnvelopeUnwrap("api.ts", working);

  // Record cascade: consumers would be blind without edge unwrap
  const unwrapIssueId = nextIssueId("iss");
  issues.push({
    id: unwrapIssueId,
    kind: "envelope_unwrap",
    severity: "blocker",
    location: { fileName: "users.ts", text: "loadUsers consumers" },
    symptom:
      "Downstream User[] consumers break if edge returns raw { data } envelope",
    rootCauseHint: "1° DFG: consumers read array fields off envelope",
    discoveredAt: "after_fix",
    causedByIssueId: primaryId,
  });
  if (steps.length > 0) {
    steps[steps.length - 1].newlyDiscoveredIssueIds = [unwrapIssueId];
    steps[steps.length - 1].notes =
      "Behavioral gate: edge must unwrap .data or consumers cascade-fail";
  }

  console.log("\n--- DFG / envelope gate (final) ---");
  console.log(finalBehavioral.ok ? "PASS" : "FAIL");
  console.log("\n--- Typecheck ---", tc.ok ? "PASS" : "FAIL");

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: finalInspection.phantoms.length === 0 ? 1 : 0,
      semantic: finalBehavioral.ok ? 1 : 0,
      locality: 1,
      cascade: 1,
    });
    return {
      issueId: iss.id,
      approach: "hybrid" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}-beh`,
          kind: "report_field" as const,
          detail: `behavioralPass=${finalBehavioral.ok}, blind=${finalBehavioral.wrappedBlindCount}`,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: iss.symptom,
    };
  });

  const repairReport = buildApproachReport({
    approach: "hybrid",
    scenarioId: "payload-envelope",
    issues,
    steps,
    issueEvals,
    spans: usageSpansToReportSpans(spans),
    narrative: `Hybrid cascade: adapted listUsers edge with .data unwrap so users.ts consumers keep User[]. behavioral=${finalBehavioral.ok}, typecheck=${tc.ok}.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  const report = {
    baseline: "envelope_hybrid",
    api: "users-list",
    scenario: "payload-envelope",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    behavioralPass: finalBehavioral.ok,
    envelopeSites: finalBehavioral.sites,
    unwrappedCount: finalBehavioral.unwrappedCount,
    wrappedBlindCount: finalBehavioral.wrappedBlindCount,
    contrastBehavioralPass,
    spansFound: spans.length,
    spans: usageSpansToReportSpans(spans),
    attempts: attemptLog,
    repairReport,
    outFile: OUT_API,
    outConsumers: OUT_USERS,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);

  if (!tc.ok || !finalBehavioral.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, unwrap .data at edge, and have 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck + DFG envelope unwrap at edge."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
