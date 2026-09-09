import * as path from "path";
import {
  assertAmountTransform,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/stripe-client-v1/src/charge.ts");
const DOCS = path.join(ROOT, "docs/stripe-charge-v2.md");
const ORACLE = path.join(ROOT, "oracle/stripe-charge-v2.json");
const OUT_FILE = path.join(__dirname, "../out/charge.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Stripe Baseline A: LLM-only dollars→cents migration ===\n");
  console.log("Mode: live LLM (Scenario 3 · behavioral break)");
  console.log(
    "Claim: typecheck often PASS while amount stays in dollars (silent bug).\n"
  );

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given Stripe-style charge client from v1 to v2. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## stripe-charge v2 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace stripe-charge-v1 imports with stripe-charge-v2. Preserve function names pay and payFixed.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  console.log(`\nWrote migrated file → ${OUT_FILE}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle);
  console.log("\n--- Hallucination Inspector ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const behavioral = assertAmountTransform("charge.ts", code);
  console.log("\n--- Behavioral gate (amount dollars→cents) ---");
  console.log(
    behavioral.ok
      ? "PASS (all amount sites scaled ×100)"
      : `FAIL (${behavioral.unscaledCount} unscaled / ${behavioral.sites.length} sites)`
  );
  for (const s of behavioral.sites) {
    console.log(
      `  L${s.startLine}: amount: ${s.amountExpr} → ${s.scaled ? "scaled" : "UNSCALED"} (${s.reason})`
    );
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "stripe_llm_only",
    api: "stripe-charge",
    scenario: "stripe-unit-shift",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    behavioralPass: behavioral.ok,
    amountSites: behavioral.sites,
    scaledCount: behavioral.scaledCount,
    unscaledCount: behavioral.unscaledCount,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (tc.ok && !behavioral.ok) {
    console.log(
      "\nClaim check: LIVE LLM-only typechecked but MISSED dollars→cents (expected Scenario 3 failure)."
    );
  } else if (behavioral.ok) {
    console.warn(
      "\nNote: LLM-only applied ×100 this run (models are non-deterministic). Re-run; claim is about failure rate / silent miss class."
    );
    process.exitCode = 2;
  } else {
    console.log(
      "\nClaim check: LLM-only had issues (typecheck and/or behavioral)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
