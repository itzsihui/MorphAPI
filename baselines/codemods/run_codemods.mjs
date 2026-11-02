// Apply each scenario's hand-written codemod through MorphAPI's runMigration (arm_codemod): same final checks as every arm.
import fs from "fs"; import path from "path"; import { createRequire } from "module"; import { fileURLToPath } from "url";
import { runScenarioPipeline } from "../../apps/demo-ui/pipelineService.mjs";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, "../..");
const ids = ["morphpay", "plaid", "openai", "stripe", "stripe-errors", "auth", "envelope", "async", "mail", "hmac", "discriminator"];
const out = path.join(ROOT, "out/ca_ast"); fs.mkdirSync(out, { recursive: true });
const rows = [];
for (const id of ids) {
  const src = fs.readFileSync(path.join(HERE, `${id}.cjs`), "utf8");
  const loc = src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length;
  const cm = require(path.join(HERE, `${id}.cjs`));
  const run = await runScenarioPipeline(ROOT, id, { arm: "arm_codemod", codemod: cm, propose: async () => { throw new Error("no LLM"); } });
  fs.writeFileSync(path.join(out, `${id}.arm_codemod.json`), JSON.stringify(run, null, 2));
  const m = run.metrics, f = run.final;
  rows.push({ id, complete: f.complete, leftovers: f.leftovers, v1uses: f.deprecatedModuleUses, newDiags: f.newDiagnostics.map((d) => `${d.file}:${d.line} ${d.message}`), churn: m.churnRatio, changedLines: m.changedLines, loc });
  console.log(`${f.complete ? "complete  " : "incomplete"} ${id.padEnd(14)} loc=${loc} leftovers=${f.leftovers} v1=${f.deprecatedModuleUses} newDiags=${f.newDiagnostics.length} churn=${(m.churnRatio * 100).toFixed(0)}% ${f.newDiagnostics.map((d) => d.message).join(" | ").slice(0, 200)}`);
}
fs.writeFileSync(path.join(out, "codemod_summary.json"), JSON.stringify(rows, null, 2));
