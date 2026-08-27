import * as path from "path";
import {
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
const CLIENT_SRC = path.join(ROOT, "fixtures/client-v1/src/checkout.ts");
const DOCS = path.join(ROOT, "docs/morphpay-v2.md");
const ORACLE = path.join(ROOT, "oracle/morphpay-v2.json");
const OUT_FILE = path.join(__dirname, "../out/checkout.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Baseline A: LLM-only MorphPay migration ===\n");
  console.log("Mode: live LLM (no offline fixtures)");

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given MorphPay client from v1 charges.create to MorphPay v2. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## MorphPay v2 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace morphpay-v1 imports with morphpay-v2. Preserve function names checkout and refundableHold.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  console.log(`\nWrote migrated file → ${OUT_FILE}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle, { focusMorphPayOnly: true });
  console.log("\n--- Hallucination Inspector ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    const errText = (tc.stdout + "\n" + tc.stderr).trim();
    console.log(errText.slice(0, 2000));
  }

  const report = {
    baseline: "llm_only",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (tc.ok && inspection.phantoms.length === 0) {
    console.warn(
      "\nNote: LLM-only passed this run (models are non-deterministic). Re-run demo; claim is about failure rate, not every single trial."
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\nClaim check: live LLM-only produced scaffolding issues (expected for baseline)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
