import * as path from "path";
import {
  buildApproachReport,
  emptyRubric,
  findListUsersAwaitSpans,
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

/** Pure AST: bump import to v2 without .data unwrap — cascade semantic fail. */
const ROOT = path.resolve(__dirname, "../../..");
const API_SRC = path.join(ROOT, "fixtures/users-client-v1/src/api.ts");
const USERS_SRC = path.join(ROOT, "fixtures/users-client-v1/src/users.ts");
const ORACLE = path.join(ROOT, "oracle/users-list-v2.json");
const OUT_API = path.join(__dirname, "../out/api.ts");
const OUT_USERS = path.join(__dirname, "../out/users.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

async function main() {
  resetIssueSeq(0);
  const api = readUtf8(API_SRC).replace(/users-list-v1/g, "users-list-v2");
  const users = readUtf8(USERS_SRC).replace(/users-list-v1/g, "users-list-v2");
  writeUtf8(OUT_API, api);
  writeUtf8(OUT_USERS, users);

  const spans = findListUsersAwaitSpans("api.ts", api);
  const issues: RepairIssue[] = [
    {
      id: nextIssueId("iss"),
      kind: "api_rename",
      severity: "major",
      location: spans[0]
        ? spanToLocation(spans[0])
        : { fileName: "api.ts" },
      symptom: "Import bumped to users-list-v2",
      rootCauseHint: "Pure AST import rewrite",
      discoveredAt: "initial",
    },
  ];
  const steps: RepairStep[] = [
    {
      step: 1,
      issueId: issues[0].id,
      action: "Deterministic import users-list-v1 → v2",
      source: "deterministic_ast",
      newlyDiscoveredIssueIds: [],
    },
  ];
  const unwrapId = nextIssueId("iss");
  issues.push({
    id: unwrapId,
    kind: "envelope_unwrap",
    severity: "blocker",
    location: { fileName: "api.ts", text: "listUsers()" },
    symptom: "No .data unwrap — consumers cascade-break",
    rootCauseHint: "Recipe lacked DFG edge adapter",
    discoveredAt: "after_fix",
    causedByIssueId: issues[0].id,
  });
  steps[0].newlyDiscoveredIssueIds = [unwrapId];

  const tc = runTypecheck(path.join(__dirname, ".."));
  const oracle = loadOracle(ORACLE);
  const inspection = inspectCode(api, oracle);

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: inspection.phantoms.length === 0 ? 1 : 0,
      semantic: iss.kind === "envelope_unwrap" ? 0 : 1,
      locality: 1,
      cascade: iss.kind === "api_rename" ? 1 : 0,
    });
    return {
      issueId: iss.id,
      approach: "pure_ast" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}`,
          kind: "report_field" as const,
          detail: "behavioralPass=false expected without .data",
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: iss.symptom,
    };
  });

  const repairReport = buildApproachReport({
    approach: "pure_ast",
    scenarioId: "payload-envelope",
    issues,
    steps,
    issueEvals,
    spans: usageSpansToReportSpans(spans),
    narrative:
      "Pure AST bumped package import only. Envelope unwrap cascade left open.",
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);
  writeUtf8(
    REPORT_FILE,
    JSON.stringify(
      {
        baseline: "envelope_ast",
        mode: "deterministic_ast",
        typecheckPass: tc.ok,
        behavioralPass: false,
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
        spansFound: spans.length,
        spans: usageSpansToReportSpans(spans),
        repairReport,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Pure AST envelope → ${REPAIR_REPORT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
