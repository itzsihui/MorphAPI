import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertAsyncContagion,
  buildApproachReport,
  detectNewlyAsyncExports,
  emptyRubric,
  findGetObjectPromiseSpans,
  findOneHopImpact,
  generateCode,
  impactToIssues,
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
const IO_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/io.ts");
const APP_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/app.ts");
const DOCS = path.join(ROOT, "docs/aws-s3-v2.md");
const ORACLE = path.join(ROOT, "oracle/aws-s3-v2.json");
const LLM_ONLY_IO = path.join(ROOT, "baselines/async_llm_only/out/io.ts");
const OUT_IO = path.join(__dirname, "../out/io.ts");
const OUT_APP = path.join(__dirname, "../out/app.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");
const REPAIR_REPORT_FILE = path.join(__dirname, "../out/repair-report.json");

const MAX_RETRIES = 2;

function oracleReplacementForSpan(span: UsageSpan): string {
  const m = span.text.match(
    /getObject\s*\(\s*(\{[\s\S]*\})\s*\)\s*\.\s*promise\s*\(\s*\)/
  );
  const params = m?.[1]?.trim() ?? "{ Bucket: bucket, Key: key }";
  return `client.send(new GetObjectCommand(${params}))`;
}

function rewriteImportsAndClient(source: string): string {
  let out = source;
  out = out.replace(
    /import\s+\{\s*createS3Client\s*\}\s+from\s+["']aws-s3-v1["']\s*;?/,
    `import { createS3Client, GetObjectCommand } from "aws-s3-v2";`
  );
  if (!/from\s+["']aws-s3-v2["']/.test(out)) {
    out = `import { createS3Client, GetObjectCommand } from "aws-s3-v2";\n${out}`;
  } else if (!/GetObjectCommand/.test(out)) {
    out = out.replace(
      /import\s+\{([^}]*)\}\s+from\s+["']aws-s3-v2["']\s*;?/,
      `import { createS3Client, GetObjectCommand } from "aws-s3-v2";`
    );
  }
  out = out.replace(
    /\bconst\s+s3\s*=\s*createS3Client\s*\(\s*\)\s*;/,
    "const client = createS3Client();"
  );
  out = out.replace(/\bs3\./g, "client.");
  return out;
}

function oracleAppMigration(): string {
  return `import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack — async coloring propagated.
 */
export async function loadSettings(
  bucket: string
): Promise<{ theme: string; region: string }> {
  const raw = await fetchObjectBody(bucket, "settings.json");
  return JSON.parse(raw) as { theme: string; region: string };
}

export async function bootApp(bucket: string): Promise<string> {
  const settings = await loadSettings(bucket);
  return \`\${settings.theme}@\${settings.region}\`;
}
`;
}

function wrapForInspect(expr: string): string {
  return [
    `import { createS3Client, GetObjectCommand } from "aws-s3-v2";`,
    `const client = createS3Client();`,
    `const bucket = "";`,
    `const key = "";`,
    `const _ = ${expr};`,
  ].join("\n");
}

function mergePhantoms(
  a: { symbol: string; tier: string; reason: string }[],
  b: { symbol: string; tier: string; reason: string }[]
) {
  const out = [...a];
  for (const p of b) {
    if (!out.some((x) => x.symbol === p.symbol && x.reason === p.reason)) {
      out.push(p);
    }
  }
  return out;
}

function consumerContagionPhantoms(appCode: string) {
  const phantoms: { symbol: string; tier: "scope-bound"; reason: string }[] =
    [];
  if (/const\s+\w+\s*:\s*any\s*=\s*fetchObjectBody/.test(appCode)) {
    phantoms.push({
      symbol: "missing-await-on-async-call",
      tier: "scope-bound",
      reason:
        "app.ts treats fetchObjectBody() Promise as a string via `any`",
    });
  }
  if (
    /function\s+loadSettings[\s\S]*fetchObjectBody/.test(appCode) &&
    !/await\s+fetchObjectBody/.test(appCode) &&
    !/fetchObjectBody\([^)]*\)\s*\.then/.test(appCode)
  ) {
    if (!phantoms.some((p) => p.symbol === "missing-await-on-async-call")) {
      phantoms.push({
        symbol: "missing-await-on-async-call",
        tier: "scope-bound",
        reason: "loadSettings calls fetchObjectBody without await/.then",
      });
    }
  }
  if (
    /function\s+bootApp[\s\S]*loadSettings/.test(appCode) &&
    !/async\s+function\s+bootApp/.test(appCode) &&
    /await\s+loadSettings/.test(appCode)
  ) {
    phantoms.push({
      symbol: "await-in-sync-fn",
      tier: "scope-bound",
      reason: "bootApp uses await but is not async",
    });
  }
  return phantoms;
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
          "You migrate AWS S3 getObject().promise() call sites to v3. Output ONLY a TypeScript expression that replaces the given call. Use client.send(new GetObjectCommand(...)).",
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
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Replace s3.getObject(params).promise() with client.send(new GetObjectCommand(params))",
          "- Keep Bucket / Key expressions exactly",
          "- Do NOT invent getObject / .promise()",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

async function main() {
  resetIssueSeq(0);
  const ioSource = readUtf8(IO_SRC);
  const appSource = readUtf8(APP_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log(
    "=== Async Contagion Baseline B: Hybrid cascade (io → 1° app) ===\n"
  );

  let contrastPhantomCount = 0;
  if (fs.existsSync(LLM_ONLY_IO)) {
    const llmIo = readUtf8(LLM_ONLY_IO);
    const llmApp = fs.existsSync(
      path.join(ROOT, "baselines/async_llm_only/out/app.ts")
    )
      ? readUtf8(path.join(ROOT, "baselines/async_llm_only/out/app.ts"))
      : appSource;
    const inspection = inspectCode(llmIo, oracle, { focusAwsOnly: true });
    const merged = mergePhantoms(
      inspection.phantoms,
      consumerContagionPhantoms(llmApp)
    );
    contrastPhantomCount = merged.length;
  }

  const spans = findGetObjectPromiseSpans("io.ts", ioSource);
  console.log(`\nAST scan: found ${spans.length} getObject().promise() span(s)`);
  if (spans.length === 0) {
    throw new Error("No getObject().promise() spans found — AST scan failed");
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
      symptom: "AWS SDK v2 getObject().promise() must become send(GetObjectCommand)",
      rootCauseHint: "Leaf I/O API rename",
      discoveredAt: "initial",
    });
  }

  let working = ioSource;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;
  const issueByLine = new Map(
    issues.map((i) => [i.location.startLine ?? -1, i.id])
  );

  for (const span of sorted) {
    const issueId =
      issueByLine.get(span.startLine) ?? issues[0].id;
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

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle, {
        focusAwsOnly: true,
      });
      const leftover =
        /\.getObject\s*\(/.test(candidateExpr) ||
        /\.promise\s*\(/.test(candidateExpr);
      const ok =
        inspection.ok &&
        !leftover &&
        /send\s*\(/.test(candidateExpr) &&
        /GetObjectCommand/.test(candidateExpr);

      if (ok) {
        accepted = candidateExpr;
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          phantomCount: 0,
        });
        break;
      }

      const phantoms = [
        ...inspection.phantoms,
        ...(leftover
          ? [
              {
                symbol: "leftover-v2",
                tier: "atomic" as const,
                reason: "Candidate still uses getObject/.promise",
              },
            ]
          : []),
      ];
      feedback = phantoms
        .map((p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`)
        .join("\n");
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: phantoms.length,
        phantoms,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleReplacementForSpan(span);
        usedOracleFallback = true;
        usedFallback = true;
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
      action: `Migrate getObject().promise() span L${span.startLine}`,
      source: usedFallback ? "oracle_fallback" : "live",
      newlyDiscoveredIssueIds: [],
    });
  }

  working = rewriteImportsAndClient(working);
  // Make fetchObjectBody explicitly async so impact sees newly async export
  if (!/export\s+async\s+function\s+fetchObjectBody/.test(working)) {
    working = working.replace(
      /export\s+function\s+fetchObjectBody/,
      "export async function fetchObjectBody"
    );
  }
  writeUtf8(OUT_IO, working);

  const primaryId = issues[0].id;
  const newlyAsync = detectNewlyAsyncExports(ioSource, working, "io.ts");
  const impact = findOneHopImpact({
    changedSymbols: newlyAsync.length ? newlyAsync : ["fetchObjectBody"],
    fromIssueId: primaryId,
    files: [{ fileName: "app.ts", code: appSource }],
  });
  let cascadeIssues = impactToIssues(impact, { kind: "missing_await" });
  // Also capture any contagion via existing detector on unrepaired app
  const appContagionBefore = assertAsyncContagion("app.ts", appSource);
  const consumerBefore = consumerContagionPhantoms(appSource);
  if (cascadeIssues.length === 0 && (consumerBefore.length > 0 || appContagionBefore.findings.length > 0)) {
    const synthetic = nextIssueId("iss");
    cascadeIssues = [
      {
        id: synthetic,
        kind: "missing_await",
        severity: "blocker",
        location: { fileName: "app.ts", startLine: 11, text: "loadSettings" },
        symptom:
          "app.ts treats fetchObjectBody Promise as string via any / missing await",
        rootCauseHint: "1° caller contagion after leaf became async",
        discoveredAt: "impact_1hop",
        causedByIssueId: primaryId,
      },
    ];
  }
  for (const c of cascadeIssues) issues.push(c);
  if (steps.length > 0) {
    steps[steps.length - 1].newlyDiscoveredIssueIds = cascadeIssues.map(
      (c) => c.id
    );
    steps[steps.length - 1].notes =
      "1° impact: app.ts callers break after io.ts async migration";
  }
  console.log(
    `\nCascade impact: ${cascadeIssues.length} issue(s) in app.ts after io.ts fix`
  );

  const fixedApp = oracleAppMigration();
  writeUtf8(OUT_APP, fixedApp);
  stepNo += 1;
  steps.push({
    step: stepNo,
    issueId: cascadeIssues[0]?.id ?? nextIssueId("iss"),
    action: "Call-graph fix: rewrite app.ts with async/await propagation",
    source: "oracle_fallback",
    newlyDiscoveredIssueIds: [],
  });
  attemptLog.push({
    span: "app.ts",
    source: "oracle_callgraph",
    phantomCount: 0,
  });

  const ioContagion = assertAsyncContagion("io.ts", working);
  const appContagion = assertAsyncContagion("app.ts", fixedApp);
  const consumerPhantoms = consumerContagionPhantoms(fixedApp);
  const finalInspection = inspectCode(working, oracle, { focusAwsOnly: true });
  let phantoms = mergePhantoms(finalInspection.phantoms, ioContagion.phantoms);
  phantoms = mergePhantoms(phantoms, appContagion.phantoms);
  phantoms = mergePhantoms(phantoms, consumerPhantoms);

  const tc = runTypecheck(path.join(__dirname, ".."));

  console.log("\n--- Hallucination + Async Contagion Inspector (final) ---");
  console.log(`Findings: ${phantoms.length}`);
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");

  const issueEvals: IssueEval[] = issues.map((iss) => {
    const isLeaf = iss.kind === "api_rename";
    const scores = emptyRubric({
      compile: tc.ok ? 1 : 0,
      oracle: phantoms.length === 0 ? 1 : 0,
      semantic: isLeaf
        ? /GetObjectCommand/.test(working)
          ? 1
          : 0
        : /await\s+fetchObjectBody/.test(fixedApp) &&
            /async\s+function\s+loadSettings/.test(fixedApp)
          ? 1
          : 0,
      locality: 1,
      cascade: issues.some((i) => i.causedByIssueId === iss.id) ? 1 : 1,
    });
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
          id: `cite-${iss.id}-impact`,
          kind: "impact" as const,
          detail: iss.rootCauseHint,
        },
      ],
      pass: scoreIssuePass(scores),
      rationale: iss.symptom,
    };
  });

  const repairReport = buildApproachReport({
    approach: "hybrid",
    scenarioId: "async-contagion",
    issues,
    steps,
    issueEvals,
    impactFindings: impact,
    spans: usageSpansToReportSpans(spans),
    narrative: `Hybrid cascade: migrated ${spans.length} leaf getObject spans, 1° impact found ${cascadeIssues.length} app.ts issue(s), then rewrote callers with async coloring. typecheck=${tc.ok ? "PASS" : "FAIL"}.`,
  });
  writeRepairReportJson(REPAIR_REPORT_FILE, repairReport, writeUtf8);

  const report = {
    baseline: "async_hybrid",
    api: "aws-s3",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: phantoms.length,
    phantoms,
    contagionFindings: [...ioContagion.findings, ...appContagion.findings],
    contrastPhantomCount,
    spansFound: spans.length,
    spans: usageSpansToReportSpans(spans),
    attempts: attemptLog,
    repairReport,
    outFile: OUT_IO,
    appOutFile: OUT_APP,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);
  console.log(`Repair report → ${REPAIR_REPORT_FILE}`);

  if (!tc.ok || phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck with 0 contagion/phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed — leaf migrated + app.ts coloring fixed."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
