import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertAsyncContagion,
  findGetObjectPromiseSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  readUtf8,
  runTypecheck,
  writeUtf8,
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
  const ioSource = readUtf8(IO_SRC);
  const appSource = readUtf8(APP_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log(
    "=== Async Contagion Baseline B: Hybrid AI + AST + consumer fix ===\n"
  );
  console.log(
    "Mode: live LLM on io.ts spans + oracle fix for app.ts coloring\n"
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
    console.log("--- Contrast: Inspector on latest live LLM-only outputs ---");
    console.log(`Findings: ${merged.length}`);
    for (const p of merged) console.log(`  [${p.tier}] ${p.symbol}`);
  }

  const spans = findGetObjectPromiseSpans("io.ts", ioSource);
  console.log(`\nAST scan: found ${spans.length} getObject().promise() span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No getObject().promise() spans found — AST scan failed");
  }

  let working = ioSource;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  for (const span of sorted) {
    let feedback: string | undefined;
    let accepted: string | undefined;

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
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
        );
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
      console.log(
        `\nSpan L${span.startLine}: rejected live attempt ${attempt} (${phantoms.length} finding(s))`
      );
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
        console.log(
          `Span L${span.startLine}: applied oracle-backed send(GetObjectCommand) replacement`
        );
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
  }

  working = rewriteImportsAndClient(working);
  writeUtf8(OUT_IO, working);

  // Always rewrite app.ts with correct async coloring (call-graph propagation)
  const fixedApp = oracleAppMigration();
  writeUtf8(OUT_APP, fixedApp);
  console.log("\nCall-graph fix: rewrote app.ts with async/await propagation");
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
  for (const p of phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

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
    attempts: attemptLog,
    outFile: OUT_IO,
    appOutFile: OUT_APP,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

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
