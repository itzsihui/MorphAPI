import * as path from "path";
import {
  applySpanReplacement,
  buildApproachReport,
  emptyRubric,
  findChatCompletionCreateSpans,
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

/**
 * Pure AST pilot: renames ChatCompletion/engine call sites only.
 * Intentionally does NOT fix constructor shape — cascade Issue B remains.
 */
const ROOT = path.resolve(__dirname, "../../..");
const CLIENT_SRC = path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts");
const ORACLE = path.join(ROOT, "oracle/openai-chat-v1.json");
const OUT_FILE = path.join(__dirname, "../out/chat.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

function oracleExpr(spanText: string): string {
  const wantsSystem = /role:\s*["']system["']/.test(spanText);
  if (wantsSystem) {
    return `openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  })`;
  }
  return `openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  })`;
}

async function main() {
  resetIssueSeq(0);
  const source = readUtf8(CLIENT_SRC);
  const oracle = loadOracle(ORACLE);
  const spans = findChatCompletionCreateSpans("chat.ts", source);

  const issues: RepairIssue[] = spans.map((span) => ({
    id: nextIssueId("iss"),
    kind: "api_rename" as const,
    severity: "blocker" as const,
    location: spanToLocation(span),
    symptom: "ChatCompletion.create / engine",
    rootCauseHint: "Pure AST recipe: rename call only",
    discoveredAt: "initial" as const,
  }));

  let working = source.replace(
    /openai-chat-v0/,
    "openai-chat-v1"
  );
  const liveSpans = findChatCompletionCreateSpans("chat.ts", working);
  const steps: RepairStep[] = [];
  let stepNo = 0;
  for (const span of [...liveSpans].sort((a, b) => b.start - a.start)) {
    const issueId =
      issues.find((i) => i.location.startLine === span.startLine)?.id ??
      issues[0].id;
    working = applySpanReplacement(
      working,
      span.start,
      span.end,
      oracleExpr(span.text)
    );
    stepNo += 1;
    steps.push({
      step: stepNo,
      issueId,
      action: `AST recipe: rename span L${span.startLine}`,
      source: "deterministic_ast",
      newlyDiscoveredIssueIds: [],
    });
  }

  writeUtf8(OUT_FILE, working);
  const tc = runTypecheck(path.join(__dirname, ".."));
  const inspection = inspectCode(working, oracle, { focusOpenAIOnly: true });

  // Cascade: bare ctor still present
  const ctorId = nextIssueId("iss");
  const hasBareCtor = /new OpenAI\(\s*[^{]/.test(working);
  if (hasBareCtor) {
    issues.push({
      id: ctorId,
      kind: "constructor_shape",
      severity: "blocker",
      location: { fileName: "chat.ts", text: "new OpenAI(key)" },
      symptom: "Constructor still bare string — Pure AST recipe did not cover it",
      rootCauseHint: "Cascade after call-site rename",
      discoveredAt: "after_typecheck",
      causedByIssueId: issues[0]?.id,
    });
    if (steps.length) {
      steps[steps.length - 1].newlyDiscoveredIssueIds = [ctorId];
      steps[steps.length - 1].notes =
        "typecheck/re-scan: constructor_shape remains (recipe incomplete)";
    }
  }

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isCtor = iss.kind === "constructor_shape";
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: inspection.phantoms.length === 0 ? 1 : 0,
      semantic: isCtor ? 0 : /chat\.completions\.create/.test(working) ? 1 : 0,
      locality: 1,
      cascade: isCtor ? 0 : 1, // detected cascade but did not fix ctor
    });
    if (isCtor) {
      scores.cascade = 0;
      scores.compile = 0;
    }
    return {
      issueId: iss.id,
      approach: "pure_ast" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}`,
          kind: "tsc" as const,
          detail: `typecheckPass=${tc.ok}; bareCtor=${hasBareCtor}`,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: isCtor
        ? "FAIL: Pure AST stopped after primary rename; constructor cascade unfixed"
        : "Call-site rename applied surgically",
    };
  });

  const repairReport = buildApproachReport({
    approach: "pure_ast",
    scenarioId: "openai-deprecated-bias",
    issues,
    steps,
    issueEvals,
    spans: usageSpansToReportSpans(spans),
    narrative:
      "Pure AST renamed ChatCompletion→completions but left new OpenAI(string). Cascade Issue B remains — recipe ceiling.",
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  writeUtf8(
    REPORT_FILE,
    JSON.stringify(
      {
        baseline: "openai_ast",
        api: "openai-chat",
        mode: "deterministic_ast",
        typecheckPass: tc.ok,
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
        spansFound: spans.length,
        spans: usageSpansToReportSpans(spans),
        repairReport,
        outFile: OUT_FILE,
        note: "Partial AST recipe — constructor cascade intentionally unfixed",
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Pure AST OpenAI → ${REPORT_FILE} (tsc=${tc.ok ? "PASS" : "FAIL"})`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
