import * as path from "path";
import {
  assertAsyncContagion,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  readUtf8,
  runTypecheck,
  writeUtf8,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const IO_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/io.ts");
const APP_SRC = path.join(ROOT, "fixtures/aws-s3-client-v1/src/app.ts");
const DOCS = path.join(ROOT, "docs/aws-s3-v2.md");
const ORACLE = path.join(ROOT, "oracle/aws-s3-v2.json");
const OUT_IO = path.join(__dirname, "../out/io.ts");
const OUT_APP = path.join(__dirname, "../out/app.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const ioSource = readUtf8(IO_SRC);
  const appSource = readUtf8(APP_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Async Contagion Baseline A: LLM-only (leaf file only) ===\n");
  console.log(
    "Mode: live LLM migrates io.ts only — app.ts consumers left as-is\n"
  );

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given AWS S3 I/O module from SDK v2 getObject().promise() to SDK v3 client.send(GetObjectCommand). Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## AWS S3 v2 docs\n\n${docs}\n\n## I/O module to migrate (leaf only)\n\n\`\`\`ts\n${ioSource}\n\`\`\`\n\nReplace aws-s3-v1 with aws-s3-v2. Preserve export names fetchObjectBody and loadBanner.`,
      },
    ],
  });

  writeUtf8(OUT_IO, code);
  // Consumer file intentionally untouched — DFG / coloring blindness
  writeUtf8(OUT_APP, appSource);
  console.log(`Wrote migrated io → ${OUT_IO}`);
  console.log(`Left app.ts untouched → ${OUT_APP}`);
  console.log(`Model: ${model}`);

  const combined = `${code}\n\n// --- app.ts (untouched consumers) ---\n\n${appSource}`;
  const inspection = inspectCode(code, oracle, { focusAwsOnly: true });
  const contagion = assertAsyncContagion("app.ts", appSource);
  // Also flag Promise treated as string via any + missing await pattern
  const phantoms = [...inspection.phantoms, ...contagion.phantoms];
  if (
    /:\s*any\s*=\s*fetchObjectBody/.test(appSource) ||
    /fetchObjectBody\s*\([^)]*\)\s*;/.test(appSource.replace(/\/\*[\s\S]*?\*\//g, ""))
  ) {
    const hasMissing = /const\s+\w+\s*:\s*any\s*=\s*fetchObjectBody/.test(
      appSource
    );
    if (hasMissing && !phantoms.some((p) => p.symbol === "missing-await-on-async-call")) {
      phantoms.push({
        symbol: "missing-await-on-async-call",
        tier: "scope-bound",
        reason:
          "app.ts treats fetchObjectBody() Promise as a string via `any` (async contagion / DFG miss)",
      });
    }
  }

  console.log("\n--- Hallucination + Async Contagion Inspector ---");
  console.log(`Findings: ${phantoms.length}`);
  for (const p of phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "async_llm_only",
    api: "aws-s3",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: phantoms.length,
    phantoms,
    contagionFindings: contagion.findings,
    touchedFiles: ["io.ts"],
    untouchedConsumers: ["app.ts"],
    outFile: OUT_IO,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (tc.ok && phantoms.length === 0) {
    console.warn(
      "\nNote: LLM-only passed cleanly this run (non-deterministic). Re-run; claim is about failure rate."
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\nClaim check: live LLM-only missed async contagion across io.ts → app.ts (expected)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
