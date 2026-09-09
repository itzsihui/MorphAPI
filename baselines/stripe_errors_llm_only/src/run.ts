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
const CLIENT_SRC = path.join(
  ROOT,
  "fixtures/stripe-errors-client-v1/src/charge.ts"
);
const DOCS = path.join(ROOT, "docs/stripe-errors-v2.md");
const ORACLE = path.join(ROOT, "oracle/stripe-errors-v2.json");
const OUT_FILE = path.join(__dirname, "../out/charge.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log(
    "=== Stripe Errors Baseline A: LLM-only exception hierarchy migration ===\n"
  );
  console.log("Mode: live LLM (charges.create + stripe.error.CardError trap)");

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate Stripe charges.create call sites to paymentIntents.create. Preserve existing catch / instanceof error-handling patterns unless absolutely required. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## Stripe Payment docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace stripe-errors-v1 imports with stripe-errors-v2. Preserve function names chargeOrHandle and holdOrHandle. Focus on migrating create() to paymentIntents.create (source → payment_method). Prefer leaving catch blocks unchanged.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  console.log(`\nWrote migrated file → ${OUT_FILE}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle, {
    focusStripeErrorsOnly: true,
  });
  console.log("\n--- Hallucination Inspector ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const leftoverLegacyCatch = /stripe\.error\.CardError/.test(code);
  const leftoverCharges = /\.charges\s*\.\s*create\s*\(/.test(code);

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "stripe_errors_llm_only",
    api: "stripe-errors",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    leftoverLegacyCatch,
    leftoverCharges,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (leftoverLegacyCatch) {
    console.log(
      "\nClaim check: live LLM-only left stripe.error.CardError in catch (expected Scenario 8 failure)."
    );
  } else if (!tc.ok || inspection.phantoms.length > 0 || leftoverCharges) {
    console.log(
      "\nClaim check: live LLM-only produced Stripe error-hierarchy issues (expected)."
    );
  } else {
    console.warn(
      "\nNote: LLM-only passed this run (models are non-deterministic). Re-run; claim is about failure rate."
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
