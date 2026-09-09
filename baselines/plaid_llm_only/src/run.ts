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
const CLIENT_SRC = path.join(ROOT, "fixtures/plaid-client-v1/src/link.ts");
const DOCS = path.join(ROOT, "docs/plaid-link-v2.md");
const ORACLE = path.join(ROOT, "oracle/plaid-link-v2.json");
const OUT_FILE = path.join(__dirname, "../out/link.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Plaid Baseline A: LLM-only Link token migration ===\n");
  console.log("Mode: live LLM (real Plaid enum names in target SDK)");

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given Plaid Link client from stringly products/country_codes to the typed Plaid SDK enums. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## Plaid Link v2 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace plaid-link-v1 imports with plaid-link-v2. Preserve function names createUserLinkToken and createUkAuthLinkToken.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  console.log(`\nWrote migrated file → ${OUT_FILE}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle, { focusPlaidOnly: true });
  console.log("\n--- Hallucination Inspector ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "plaid_llm_only",
    api: "plaid-link",
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
      "\nNote: LLM-only passed this run (models are non-deterministic). Re-run; claim is about failure rate."
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\nClaim check: live LLM-only produced Plaid scaffolding issues (expected)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
