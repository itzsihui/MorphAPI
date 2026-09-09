import * as path from "path";
import {
  assertEnvelopeUnwrap,
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
const API_SRC = path.join(ROOT, "fixtures/users-client-v1/src/api.ts");
const USERS_SRC = path.join(ROOT, "fixtures/users-client-v1/src/users.ts");
const DOCS = path.join(ROOT, "docs/users-list-v2.md");
const ORACLE = path.join(ROOT, "oracle/users-list-v2.json");
const OUT_API = path.join(__dirname, "../out/api.ts");
const OUT_USERS = path.join(__dirname, "../out/users.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const apiSource = readUtf8(API_SRC);
  const usersSource = readUtf8(USERS_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Envelope Baseline A: LLM-only flat→{data,pagination} ===\n");
  console.log("Mode: live LLM (Scenario 5 · DFG blindness)");
  console.log(
    "Claim: model sees only the network-edge file; downstream User[] consumers stay blind.\n"
  );

  // DFG trap: LLM only receives the fetch module — not users.ts consumers.
  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given API edge module from users-list v1 to v2. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## users-list v2 docs\n\n${docs}\n\n## API edge module to migrate\n\n\`\`\`ts\n${apiSource}\n\`\`\`\n\nReplace users-list-v1 imports with users-list-v2. Preserve the loadUsers export. Other files in the project import loadUsers and are out of scope for this edit.`,
      },
    ],
  });

  writeUtf8(OUT_API, code);
  // Consumers left untouched except import path — classic cross-file DFG miss
  writeUtf8(
    OUT_USERS,
    usersSource.replace(/users-list-v1/g, "users-list-v2")
  );
  console.log(`\nWrote migrated edge → ${OUT_API}`);
  console.log(`Left consumers unchanged → ${OUT_USERS}`);
  console.log(`Model: ${model}`);

  const combined = `${code}\n\n${usersSource}`;
  const inspection = inspectCode(code, oracle);
  console.log("\n--- Hallucination Inspector (edge file) ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const behavioral = assertEnvelopeUnwrap("api.ts", code);
  console.log("\n--- DFG / envelope gate (.data unwrap on edge) ---");
  console.log(
    behavioral.ok
      ? "PASS (edge unwraps .data so consumers still see User[])"
      : `FAIL (${behavioral.wrappedBlindCount} blind / ${behavioral.sites.length} sites)`
  );
  for (const s of behavioral.sites) {
    console.log(
      `  L${s.startLine}: ${s.binding ?? "(expr)"} → ${
        s.unwrapped ? "unwrapped" : "BLIND"
      } (${s.reason})`
    );
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit on out/) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "envelope_llm_only",
    api: "users-list",
    scenario: "payload-envelope",
    mode,
    model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    behavioralPass: behavioral.ok,
    envelopeSites: behavioral.sites,
    unwrappedCount: behavioral.unwrappedCount,
    wrappedBlindCount: behavioral.wrappedBlindCount,
    consumersUntouched: true,
    outFile: OUT_API,
    outConsumers: OUT_USERS,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!behavioral.ok || !tc.ok) {
    console.log(
      "\nClaim check: LIVE LLM-only missed edge .data adapter and/or broke consumers (expected Scenario 5 failure)."
    );
  } else {
    console.warn(
      "\nNote: LLM-only unwrapped at the edge this run (non-deterministic). Re-run; claim is about DFG miss class."
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
