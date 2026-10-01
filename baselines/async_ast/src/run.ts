import * as path from "path";
import {
  applySpanReplacement,
  buildApproachReport,
  emptyRubric,
  findGetObjectPromiseSpans,
  findOneHopImpact,
  impactToIssues,
  inspectCode,
  loadOracle,
  nextIssueId,
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

/** Pure AST: migrate io.ts only; leave app.ts contagion unfixed. */
const ROOT = path.resolve(__dirname, "../../..");
const IO_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/io.ts");
const APP_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/app.ts");
const ORACLE = path.join(ROOT, "oracle/aws-s3-v2.json");
const OUT_IO = path.join(__dirname, "../out/io.ts");
const OUT_APP = path.join(__dirname, "../out/app.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

function oracleExpr(text: string): string {
  const m = text.match(
    /getObject\s*\(\s*(\{[\s\S]*\})\s*\)\s*\.\s*promise\s*\(\s*\)/
  );
  const params = m?.[1]?.trim() ?? "{ Bucket: bucket, Key: key }";
  return `client.send(new GetObjectCommand(${params}))`;
}

async function main() {
  resetIssueSeq(0);
  const ioSource = readUtf8(IO_SRC);
  const appSource = readUtf8(APP_SRC);
  const oracle = loadOracle(ORACLE);
  const spans = findGetObjectPromiseSpans("io.ts", ioSource);

  const issues: RepairIssue[] = spans.map((s) => ({
    id: nextIssueId("iss"),
    kind: "api_rename" as const,
    severity: "blocker" as const,
    location: spanToLocation(s),
    symptom: "getObject().promise()",
    rootCauseHint: "Pure AST leaf recipe",
    discoveredAt: "initial" as const,
  }));
  const primaryId = issues[0].id;
  const steps: RepairStep[] = [];

  let working = ioSource
    .replace(/aws-s3-v1/, "aws-s3-v2")
    .replace(
      /import\s+\{\s*createS3Client\s*\}/,
      "import { createS3Client, GetObjectCommand }"
    )
    .replace(/const s3 =/, "const client =")
    .replace(/\bs3\./g, "client.");

  const live = findGetObjectPromiseSpans("io.ts", working);
  let stepNo = 0;
  for (const span of [...live].sort((a, b) => b.start - a.start)) {
    working = applySpanReplacement(
      working,
      span.start,
      span.end,
      oracleExpr(span.text)
    );
    stepNo += 1;
    steps.push({
      step: stepNo,
      issueId: primaryId,
      action: `AST recipe io.ts L${span.startLine}`,
      source: "deterministic_ast",
      newlyDiscoveredIssueIds: [],
    });
  }
  writeUtf8(OUT_IO, working);
  writeUtf8(OUT_APP, appSource); // intentional: contagion left open

  const impact = findOneHopImpact({
    changedSymbols: ["fetchObjectBody"],
    fromIssueId: primaryId,
    files: [{ fileName: "app.ts", code: appSource }],
  });
  let cascade = impactToIssues(impact, { kind: "missing_await" });
  if (cascade.length === 0) {
    cascade = [
      {
        id: nextIssueId("iss"),
        kind: "missing_await",
        severity: "blocker",
        location: { fileName: "app.ts", text: "loadSettings" },
        symptom: "app.ts callers still sync/any after leaf async migration",
        rootCauseHint: "1° impact — Pure AST did not propagate",
        discoveredAt: "impact_1hop",
        causedByIssueId: primaryId,
      },
    ];
  }
  for (const c of cascade) issues.push(c);
  if (steps.length) {
    steps[steps.length - 1].newlyDiscoveredIssueIds = cascade.map((c) => c.id);
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  const inspection = inspectCode(working, oracle, { focusAwsOnly: true });

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isLeaf = iss.kind === "api_rename";
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: inspection.phantoms.length === 0 ? 1 : 0,
      semantic: isLeaf ? 1 : 0,
      locality: 1,
      cascade: isLeaf ? 1 : 0,
    });
    return {
      issueId: iss.id,
      approach: "pure_ast" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}`,
          kind: "impact" as const,
          detail: iss.rootCauseHint,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: isLeaf
        ? "Leaf AST recipe applied"
        : "FAIL: caller contagion not in recipe",
    };
  });

  const repairReport = buildApproachReport({
    approach: "pure_ast",
    scenarioId: "async-contagion",
    issues,
    steps,
    issueEvals,
    impactFindings: impact,
    spans: usageSpansToReportSpans(spans),
    narrative:
      "Pure AST migrated io.ts only. 1° app.ts contagion discovered but unfixed — recipe ceiling.",
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);
  writeUtf8(
    REPORT_FILE,
    JSON.stringify(
      {
        baseline: "async_ast",
        mode: "deterministic_ast",
        typecheckPass: tc.ok,
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
        spansFound: spans.length,
        spans: usageSpansToReportSpans(spans),
        repairReport,
        outFile: OUT_IO,
        appOutFile: OUT_APP,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Pure AST async → tsc=${tc.ok} repair → ${REPAIR_REPORT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
