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
const CLIENT_SRC = path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts");
const DOCS = path.join(ROOT, "docs/openai-chat-v1.md");
const ORACLE = path.join(ROOT, "oracle/openai-chat-v1.json");
const OUT_FILE = path.join(__dirname, "../out/chat.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== OpenAI Baseline A: LLM-only ChatCompletion migration ===\n");
  console.log("Mode: live LLM (engine → model trap)");

  const { code, mode, model } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You are a senior TypeScript engineer. Migrate the given OpenAI chat client from legacy ChatCompletion.create({ engine }) to the v1 client.chat.completions.create({ model }) API. Output ONLY the full TypeScript file contents, no markdown.",
      },
      {
        role: "user",
        content: `## OpenAI chat v1 docs\n\n${docs}\n\n## Client source to migrate\n\n\`\`\`ts\n${source}\n\`\`\`\n\nReplace openai-chat-v0 imports with openai-chat-v1. Preserve function names askOnce and askWithSystem.`,
      },
    ],
  });

  writeUtf8(OUT_FILE, code);
  console.log(`\nWrote migrated file → ${OUT_FILE}`);
  console.log(`Model: ${model}`);

  const inspection = inspectCode(code, oracle, { focusOpenAIOnly: true });
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
    baseline: "openai_llm_only",
    api: "openai-chat",
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
      "\nClaim check: live LLM-only produced OpenAI scaffolding issues (expected)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
