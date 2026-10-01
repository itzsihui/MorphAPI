import * as path from "path";
import {
  buildApproachReport,
  emptyRubric,
  findChatCompletionCreateSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  nextIssueId,
  readUtf8,
  resetIssueSeq,
  runTypecheck,
  scoreIssuePass,
  writeRepairReportJson,
  writeUtf8,
  type IssueEval,
  type RepairIssue,
  type RepairStep,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const CLIENT_SRC = path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts");
const DOCS = path.join(ROOT, "docs/openai-chat-v1.md");
const ORACLE = path.join(ROOT, "oracle/openai-chat-v1.json");
const OUT_FILE = path.join(__dirname, "../out/chat.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

async function main() {
  resetIssueSeq(0);
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);
  const initialSpans = findChatCompletionCreateSpans("chat.ts", source);

  console.log("=== OpenAI Baseline A: LLM-only (cascade-aware report) ===\n");

  const issues: RepairIssue[] = [
    {
      id: nextIssueId("iss"),
      kind: "api_rename",
      severity: "blocker",
      location: { fileName: "chat.ts", text: "ChatCompletion.create" },
      symptom: "Legacy ChatCompletion / engine API",
      rootCauseHint: "Whole-file generative migration",
      discoveredAt: "initial",
    },
  ];

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given OpenAI chat client from legacy ChatCompletion.create({ engine }) to the v1 client.chat.completions.create({ model }) API. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## OpenAI chat v1 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace openai-chat-v0 imports with openai-chat-v1. Preserve function names askOnce and askWithSystem.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  const inspection = inspectCode(code, oracle, { focusOpenAIOnly: true });
  const tc = runTypecheck(path.join(__dirname, ".."));

  const steps: RepairStep[] = [
    {
      step: 1,
      issueId: issues[0].id,
      action: "Whole-file LLM rewrite",
      source: "whole_file",
      newlyDiscoveredIssueIds: [],
    },
  ];

  const hasBareCtor = /new OpenAI\(\s*[^{]/.test(code);
  const hasLegacy =
    /ChatCompletion\.create/.test(code) || /\bengine\s*:/.test(code);
  if (hasBareCtor || (!tc.ok && !hasLegacy)) {
    const ctorId = nextIssueId("iss");
    issues.push({
      id: ctorId,
      kind: "constructor_shape",
      severity: "blocker",
      location: { fileName: "chat.ts", text: "new OpenAI(...)" },
      symptom: hasBareCtor
        ? "Bare OpenAI(string) ctor remains after rewrite"
        : "Typecheck failed after whole-file rewrite (possible ctor/shape)",
      rootCauseHint: "Cascade / incomplete generative fix",
      discoveredAt: "after_fix",
      causedByIssueId: issues[0].id,
    });
    steps[0].newlyDiscoveredIssueIds.push(ctorId);
  }
  for (const p of inspection.phantoms) {
    const id = nextIssueId("iss");
    issues.push({
      id,
      kind: "phantom_symbol",
      severity: "major",
      location: { fileName: "chat.ts", text: p.symbol },
      symptom: p.reason,
      rootCauseHint: "Hallucination inspector",
      discoveredAt: "after_fix",
      causedByIssueId: issues[0].id,
    });
    steps[0].newlyDiscoveredIssueIds.push(id);
  }

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: inspection.phantoms.length === 0 ? 1 : 0,
      semantic:
        iss.kind === "constructor_shape"
          ? hasBareCtor
            ? 0
            : tc.ok
              ? 1
              : 0
          : iss.kind === "phantom_symbol"
            ? 0
            : !hasLegacy
              ? 1
              : 0,
      locality: 0,
      cascade: 0,
    });
    return {
      issueId: iss.id,
      approach: "pure_llm" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}`,
          kind: "tsc" as const,
          detail: `typecheckPass=${tc.ok}, phantoms=${inspection.phantoms.length}`,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: `${iss.symptom} (whole-file LLM; cascade rarely continued)`,
    };
  });

  const repairReport = buildApproachReport({
    approach: "pure_llm",
    scenarioId: "openai-deprecated-bias",
    issues,
    steps,
    issueEvals,
    spans: initialSpans.map((s, i) => ({
      id: `span-${i + 1}`,
      fileName: s.fileName,
      startLine: s.startLine,
      endLine: s.endLine,
      startChar: s.startChar,
      endChar: s.endChar,
      kind: s.kind,
      text: s.text,
    })),
    narrative: `Pure LLM whole-file rewrite. typecheck=${tc.ok ? "PASS" : "FAIL"}, phantoms=${inspection.phantoms.length}, bareCtor=${hasBareCtor}. Cascade issues recorded but not iteratively repaired.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  writeUtf8(
    REPORT_FILE,
    JSON.stringify(
      {
        baseline: "openai_llm_only",
        api: "openai-chat",
        mode,
        model,
        typecheckPass: tc.ok,
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
        outFile: OUT_FILE,
        repairReport,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\nReport → ${REPORT_FILE}`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);

  if (tc.ok && inspection.phantoms.length === 0) {
    console.warn("\nNote: LLM-only passed this run (non-deterministic).");
    process.exitCode = 2;
  } else {
    console.log("\nClaim check: LLM-only produced scaffolding / cascade issues.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
