import * as path from "path";
import {
  assertDiscriminatorMigration,
  generateCode,
  inspectCode,
  loadDiscriminatorMapping,
  loadEnv,
  loadOracle,
  readUtf8,
  runTypecheck,
  writeUtf8,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const SUBSCRIBE_SRC = path.join(
  ROOT,
  "fixtures/events-client-v1/src/subscribe.ts"
);
const ROUTER_SRC = path.join(ROOT, "fixtures/events-client-v1/src/router.ts");
const DOCS = path.join(ROOT, "docs/events-gateway-v2.md");
const ORACLE = path.join(ROOT, "oracle/events-gateway-v2.json");
const OUT_SUBSCRIBE = path.join(__dirname, "../out/subscribe.ts");
const OUT_ROUTER = path.join(__dirname, "../out/router.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const subscribeSource = readUtf8(SUBSCRIBE_SRC);
  const routerSource = readUtf8(ROUTER_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);
  const mapping = loadDiscriminatorMapping(oracle.discriminator);

  console.log(
    "=== Discriminator Baseline A: LLM-only type→event_type migration ===\n"
  );
  console.log("Mode: live LLM (Scenario 9 · polymorphic discriminator)");
  console.log(
    "Claim: model updates subscribe intents; misses switch/case router.\n"
  );

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given gateway subscription module from v1 to v2. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## events-gateway v2 docs\n\n${docs}\n\n## Subscription module to migrate\n\n\`\`\`ts\n${subscribeSource}\n\`\`\`\n\nReplace events-gateway-v1 imports with events-gateway-v2. Preserve startBot. Other files (routers / switch handlers) are out of scope for this edit.`,
      },
    ],
  });

  writeUtf8(OUT_SUBSCRIBE, code);
  // Router left on old discriminator — classic cross-file miss
  writeUtf8(
    OUT_ROUTER,
    routerSource.replace(/events-gateway-v1/g, "events-gateway-v2")
  );
  console.log(`\nWrote migrated subscribe → ${OUT_SUBSCRIBE}`);
  console.log(`Left router unchanged (import only) → ${OUT_ROUTER}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle);
  console.log("\n--- Hallucination Inspector (subscribe) ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const routerCode = readUtf8(OUT_ROUTER);
  const behavioral = assertDiscriminatorMigration(
    "router.ts",
    routerCode,
    mapping,
    { requireSwitch: true }
  );
  console.log("\n--- Discriminator gate (router switch) ---");
  console.log(
    behavioral.ok
      ? "PASS (switch uses event_type + new values)"
      : `FAIL (${behavioral.failCount} issue(s))`
  );
  for (const s of behavioral.sites) {
    console.log(
      `  L${s.startLine} [${s.kind}] ${s.ok ? "ok" : "FAIL"} — ${s.reason}`
    );
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit on out/) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "discriminator_llm_only",
    api: "events-gateway",
    scenario: "discriminator",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    behavioralPass: behavioral.ok,
    discriminatorSites: behavioral.sites,
    failCount: behavioral.failCount,
    passCount: behavioral.passCount,
    routerUntouched: true,
    outFile: OUT_SUBSCRIBE,
    outRouter: OUT_ROUTER,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!behavioral.ok || !tc.ok) {
    console.log(
      "\nClaim check: LIVE LLM-only missed router discriminator migration (expected Scenario 9 failure)."
    );
  } else {
    console.warn(
      "\nNote: LLM-only fully migrated this run (unexpected — router was left untouched). Inspect outputs."
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
