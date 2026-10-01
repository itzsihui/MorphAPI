#!/usr/bin/env node
/**
 * Run the generic MorphAPI pipeline on live scenarios.
 *   node scripts/morph-run.mjs [scenario...|all] [--arm arm1_morphapi] [--model mini|frontier] [--verbose]
 * Writes out/pipeline/<scenario>.<arm>.<model>.json and prints one summary line per scenario.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LIVE_SCENARIOS } from "../apps/demo-ui/scenarioMeta.mjs";
import { runScenarioPipeline, PIPELINE_ARMS } from "../apps/demo-ui/pipelineService.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const verbose = args.includes("--verbose") ? (args.splice(args.indexOf("--verbose"), 1), true) : false;
const arm = flag("arm", "arm1_morphapi");
const model = flag("model", "mini");
if (!PIPELINE_ARMS.includes(arm)) {
  console.error(`Unknown arm ${arm}. One of: ${PIPELINE_ARMS.join(", ")}`);
  process.exit(2);
}
const ids = !args.length || args.includes("all") ? LIVE_SCENARIOS : args;

const outDir = path.join(ROOT, "out", "pipeline");
fs.mkdirSync(outDir, { recursive: true });

let incomplete = 0;
for (const id of ids) {
  const onEvent = verbose
    ? (e) => {
        if (e.type === "attempt") {
          const f = e.findings.map((x) => `${x.kind}:${x.name ?? x.message}${x.suggestions?.length ? `→[${x.suggestions.join(",")}]` : ""}`);
          console.log(`  ${e.file}:${e.line} attempt ${e.attempt} ${e.ok ? "ok" : "rejected"} ${f.join(" | ")}`);
        } else if (["escalate", "dataflow", "imports", "impact", "failed"].includes(e.type)) {
          const { type, ...rest } = e;
          console.log(`  ${type} ${JSON.stringify(rest).slice(0, 240)}`);
        }
      }
    : undefined;
  try {
    const run = await runScenarioPipeline(ROOT, id, { arm, model, onEvent });
    fs.writeFileSync(path.join(outDir, `${id}.${arm}.${model}.json`), JSON.stringify(run, null, 2));
    const m = run.metrics;
    if (!run.final.complete) incomplete++;
    console.log(
      `${run.final.complete ? "complete  " : "incomplete"} ${id.padEnd(14)} spans ${m.spansMigrated}/${m.spansFound}` +
        ` attempts=${m.attempts} phantoms=${m.phantomRejections} esc=${m.escalations}` +
        ` leftovers=${run.final.leftovers} newDiags=${run.final.newDiagnostics.length}` +
        ` churn=${(m.churnRatio * 100).toFixed(0)}% tokens=${m.promptTokens}+${m.completionTokens} ${(run.ms / 1000).toFixed(1)}s`
    );
    if (verbose) for (const d of run.final.newDiagnostics) console.log(`    ${d.file}:${d.line} ${d.message}`);
  } catch (err) {
    incomplete++;
    console.log(`error      ${id.padEnd(14)} ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(incomplete ? 1 : 0);
