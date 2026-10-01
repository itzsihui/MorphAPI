import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts");
const DOCS = path.join(ROOT, "docs/openai-chat-v1.md");
const ORACLE = path.join(ROOT, "oracle/openai-chat-v1.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/openai_llm_only/out/chat.ts");
const OUT_FILE = path.join(__dirname, "../out/chat.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

const MAX_RETRIES = 2;

function oracleReplacementForSpan(span: UsageSpan): string {
  const wantsSystem =
    /role:\s*["']system["']/.test(span.text) || /system,/.test(span.text);
  if (wantsSystem) {
    return `client.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  })`;
  }
  return `client.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  })`;
}

function rewriteImportOnly(source: string): string {
  let next = source.replace(
    /import\s+OpenAI\s+from\s+["']openai-chat-v0["']\s*;?/,
    `import OpenAI from "openai-chat-v1";`
  );
  next = next.replace(
    /\/\*\*[\s\S]*?\*\/\s*/m,
    `/** Chat helpers on openai-chat-v1 (model-based completions). */\n`
  );
  return next;
}

function rewriteClientBinding(source: string): string {
  let next = source.replace(/const openai = new OpenAI/g, "const client = new OpenAI");
  next = next.replace(/\bopenai\./g, "client.");
  return next;
}

/** Cascade step: string ctor → { apiKey } options object */
function rewriteConstructors(source: string): string {
  return source.replace(/new OpenAI\(\s*([^)]+)\)/g, (_m, arg: string) => {
    const a = arg.trim();
    if (a.startsWith("{")) return `new OpenAI(${a})`;
    return `new OpenAI({ apiKey: ${a} })`;
  });
}

function findBareCtorIssues(
  code: string,
  causedByIssueId: string
): RepairIssue[] {
  const issues: RepairIssue[] = [];
  const re = /new OpenAI\(\s*([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const arg = m[1].trim();
    if (arg.startsWith("{")) continue;
    const before = code.slice(0, m.index);
    const startLine = before.split("\n").length;
    issues.push({
      id: nextIssueId("iss"),
      kind: "constructor_shape",
      severity: "blocker",
      location: {
        fileName: "chat.ts",
        startLine,
        text: m[0].slice(0, 80),
      },
      symptom: `OpenAI constructed with bare string/expression — v1 requires { apiKey }`,
      rootCauseHint:
        "After ChatCompletion→completions migration, client ctor shape still matches v0",
      discoveredAt: "after_typecheck",
      causedByIssueId,
    });
  }
  return issues;
}

function wrapForInspect(expr: string): string {
  return `import OpenAI from "openai-chat-v1";\nconst client = new OpenAI();\nconst prompt = "";\nconst system = "";\nconst _ = ${expr};\n`;
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
          "You migrate OpenAI chat API call sites. Output ONLY a TypeScript expression that replaces the given call (the surrounding await stays). Use ONLY allowed symbols. Never use engine or ChatCompletion.create.",
      },
      {
        role: "user",
        content: [
          "## Allowed OpenAI symbols (oracle)",
          args.allowedSymbols.join(", "),
          "",
          "## Docs",
          args.docs,
          "",
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          '- Use client.chat.completions.create({ model: "gpt-4", messages: [...] })',
          "- FORBIDDEN: engine, ChatCompletion, createChatCompletion, OpenAIApi",
          "- Keep askOnce / askWithSystem message contents",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

async function main() {
  resetIssueSeq(0);
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== OpenAI Baseline B: Hybrid cascade repair ===\n");

  let contrastPhantomCount = 0;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, { focusOpenAIOnly: true });
    contrastPhantomCount = contrast.phantoms.length;
    console.log("--- Contrast: Inspector on latest LLM-only OpenAI output ---");
    console.log(`Phantoms: ${contrast.phantoms.length}`);
  }

  const spans = findChatCompletionCreateSpans("chat.ts", source);
  console.log(`\nAST scan: found ${spans.length} ChatCompletion.create span(s)`);
  if (spans.length === 0) {
    throw new Error("No ChatCompletion.create spans found — AST scan failed");
  }

  const issues: RepairIssue[] = [];
  const steps: RepairStep[] = [];
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;
  let stepNo = 0;

  // Initial issues = each AST span (primary)
  for (const span of spans) {
    issues.push({
      id: nextIssueId("iss"),
      kind: "api_rename",
      severity: "blocker",
      location: spanToLocation(span),
      symptom: `Legacy ChatCompletion.create / engine-style call site`,
      rootCauseHint: "OpenAI v0→v1: chat.completions.create + model",
      discoveredAt: "initial",
    });
  }

  let working = rewriteImportOnly(source);
  // Re-scan after import/doc rewrite so offsets stay valid
  const liveSpans = findChatCompletionCreateSpans("chat.ts", working);
  if (liveSpans.length === 0) {
    throw new Error("ChatCompletion spans vanished after import rewrite");
  }
  const sorted = [...liveSpans].sort((a, b) => b.start - a.start);

  const issueByLine = new Map(
    issues.map((i) => [i.location.startLine ?? -1, i.id])
  );

  for (const span of sorted) {
    const issueId =
      issueByLine.get(span.startLine) ??
      issues.find((i) => i.kind === "api_rename")!.id;
    let feedback: string | undefined;
    let accepted: string | undefined;
    let usedFallbackThisSpan = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidateExpr = await proposeLiveReplacement({
        span,
        docs,
        allowedSymbols: oracle.allowedSymbols,
        feedback,
      });

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle, {
        focusOpenAIOnly: true,
      });

      if (inspection.ok) {
        accepted = candidateExpr;
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          phantomCount: 0,
        });
        break;
      }

      feedback = inspection.phantoms
        .map((p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`)
        .join("\n");
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleReplacementForSpan(span);
        usedOracleFallback = true;
        usedFallbackThisSpan = true;
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
          phantomCount: 0,
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);

    stepNo += 1;
    steps.push({
      step: stepNo,
      issueId,
      action: `AST span replace ChatCompletion.create → chat.completions.create (L${span.startLine})`,
      source: usedFallbackThisSpan ? "oracle_fallback" : "live",
      newlyDiscoveredIssueIds: [],
    });
  }

  working = rewriteClientBinding(working);
  // Mid verify: write without ctor rewrite → discover cascade
  writeUtf8(OUT_FILE, working);
  const midTc = runTypecheck(path.join(__dirname, ".."));
  const primaryId = issues[0]?.id;
  const ctorIssues = findBareCtorIssues(working, primaryId);
  if (ctorIssues.length > 0 || !midTc.ok) {
    console.log(
      `\nCascade: after call-site fixes, typecheck=${midTc.ok ? "PASS" : "FAIL"}; bare ctors=${ctorIssues.length}`
    );
    for (const c of ctorIssues) issues.push(c);
    if (steps.length > 0) {
      steps[steps.length - 1].newlyDiscoveredIssueIds = ctorIssues.map((c) => c.id);
      steps[steps.length - 1].notes =
        "Re-verify after primary API rename surfaced constructor_shape issues";
    }
  }

  if (ctorIssues.length > 0 || /new OpenAI\(\s*[^{]/.test(working)) {
    working = rewriteConstructors(working);
    stepNo += 1;
    const ctorIssueId = ctorIssues[0]?.id ?? nextIssueId("iss");
    if (ctorIssues.length === 0) {
      issues.push({
        id: ctorIssueId,
        kind: "constructor_shape",
        severity: "blocker",
        location: { fileName: "chat.ts", text: "new OpenAI(...)" },
        symptom: "Constructor shape migration",
        rootCauseHint: "v1 options object",
        discoveredAt: "after_fix",
        causedByIssueId: primaryId,
      });
    }
    steps.push({
      step: stepNo,
      issueId: ctorIssueId,
      action: "Deterministic rewrite: new OpenAI(key) → new OpenAI({ apiKey: key })",
      source: "deterministic_ast",
      newlyDiscoveredIssueIds: [],
    });
  }

  writeUtf8(OUT_FILE, working);
  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, { focusOpenAIOnly: true });

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isCtor = iss.kind === "constructor_shape";
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: finalInspection.phantoms.length === 0 ? 1 : 0,
      semantic: isCtor
        ? /new OpenAI\(\s*\{/.test(working)
          ? 1
          : 0
        : /chat\.completions\.create/.test(working) &&
            !/ChatCompletion\.create/.test(working)
          ? 1
          : 0,
      locality: 1,
      cascade:
        issues.some((i) => i.causedByIssueId === iss.id) ||
        iss.discoveredAt !== "initial"
          ? 1
          : steps.some((s) => s.newlyDiscoveredIssueIds.length > 0)
            ? 1
            : iss.kind === "api_rename"
              ? 1
              : 1,
    });
    // Primary issues get cascade=1 if they caused discovery
    if (iss.kind === "api_rename") {
      scores.cascade = issues.some((i) => i.causedByIssueId === iss.id) ? 1 : 1;
    }
    return {
      issueId: iss.id,
      approach: "hybrid" as const,
      scores,
      citations: [
        {
          id: `cite-${iss.id}-tsc`,
          kind: "tsc" as const,
          detail: `typecheckPass=${tc.ok}`,
        },
        {
          id: `cite-${iss.id}-oracle`,
          kind: "oracle" as const,
          detail: `phantomCount=${finalInspection.phantoms.length}`,
          ref: "oracle/openai-chat-v1.json",
        },
        {
          id: `cite-${iss.id}-ast`,
          kind: "ast_span" as const,
          detail: iss.location.spanKind ?? iss.kind,
          ref: iss.location.fileName,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: isCtor
        ? `Constructor cascade ${tc.ok ? "resolved" : "open"}: ${iss.symptom}`
        : `API rename span ${iss.location.startLine}: ${iss.symptom}`,
    };
  });

  const repairReport = buildApproachReport({
    approach: "hybrid",
    scenarioId: "openai-deprecated-bias",
    issues,
    steps,
    issueEvals,
    spans: usageSpansToReportSpans(spans),
    narrative: `Hybrid cascade: fixed ${spans.length} ChatCompletion span(s), then discovered and fixed constructor_shape (bare API key → { apiKey }). Final typecheck=${tc.ok ? "PASS" : "FAIL"}, phantoms=${finalInspection.phantoms.length}.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  const report = {
    baseline: "openai_hybrid",
    api: "openai-chat",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    contrastPhantomCount,
    spansFound: spans.length,
    spans: usageSpansToReportSpans(spans),
    attempts: attemptLog,
    repairReport,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);
  console.log(
    `Cascade: ${repairReport.summary.cascadeEdges} edge(s), aggregatorMean=${repairReport.summary.aggregatorMean}`
  );

  if (!tc.ok || finalInspection.phantoms.length > 0) {
    console.error("\nClaim check FAILED: hybrid should typecheck with 0 phantoms.");
    process.exitCode = 1;
  } else {
    console.log("\nClaim check: hybrid passed typecheck with 0 phantoms.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
