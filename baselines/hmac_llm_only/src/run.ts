import * as path from "path";
import {
  assertHmacSecurity,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/webhook-client-v1/src/webhook.ts");
const DOCS = path.join(ROOT, "docs/webhook-auth-v2.md");
const ORACLE = path.join(ROOT, "oracle/webhook-auth-v2.json");
const OUT_FILE = path.join(__dirname, "../out/webhook.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== HMAC Baseline A: LLM-only static token → signing ===\n");
  console.log("Mode: live LLM (Scenario 10 · cryptographic / protocol evolution)");
  console.log(
    "Claim: model often leaves === token checks, invents helpers, or skips timingSafeEqual.\n"
  );

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the webhook auth client from static query tokens to HMAC request signing. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## webhook-auth v2 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace webhook-auth-v1 with webhook-auth-v2. Preserve function names authorizeIngress, handleIngress, and authorizeLegacyCompat.`,
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

  const security = assertHmacSecurity(code);
  console.log("\n--- Security gate (HMAC + timing-safe) ---");
  console.log(
    security.ok
      ? "PASS"
      : `FAIL (static=${security.staticTokenCount}, unsafeCompare=${security.unsafeCompareCount})`
  );
  for (const f of security.findings) {
    console.log(`  [${f.ok ? "ok" : "FAIL"}] ${f.kind}: ${f.detail}`);
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "hmac_llm_only",
    api: "webhook-auth",
    scenario: "auth-hmac",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    securityPass: security.ok,
    staticTokenCount: security.staticTokenCount,
    unsafeCompareCount: security.unsafeCompareCount,
    securityFindings: security.findings,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (tc.ok && !security.ok) {
    console.log(
      "\nClaim check: LIVE LLM-only typechecked but FAILED security gate (expected Scenario 10)."
    );
  } else if (security.ok && inspection.phantoms.length === 0) {
    console.warn(
      "\nNote: LLM-only passed security this run (non-deterministic). Re-run; claim is about failure rate."
    );
    process.exitCode = 2;
  } else {
    console.log("\nClaim check: LLM-only had security and/or phantom issues.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
