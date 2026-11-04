// For every saved CA run (out/ca_ast/*.json): materialise the migrated files, transpile to JS, run tests.cjs.
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { createRequire } from "module";
const require = createRequire(import.meta.url); const ts = require("typescript");
const ROOT = "/home/claude/itzsihui/morphapi"; const D = `${ROOT}/out/ca_ast`; const TMP = `${ROOT}/out/behav_tmp`;
const { getMeta } = await import(`${ROOT}/apps/demo-ui/scenarioMeta.mjs`);
const files = fs.readdirSync(D).filter((f) => /\.(r\d|arm_codemod)\.json$/.test(f) && !f.startsWith("scored") && !f.startsWith("codemod"));
const results = {};
for (const f of files) {
  const run = JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")); const id = f.split(".")[0]; const meta = getMeta(id);
  const dir = `${TMP}/${f.replace(/\.json$/, "")}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const rel of meta.fixtureFiles) {
    const src = run.patches?.[rel]?.after ?? fs.readFileSync(`${ROOT}/${rel}`, "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    fs.writeFileSync(`${dir}/${path.basename(rel).replace(/\.ts$/, ".js")}`, js);
  }
  let res;
  try { res = JSON.parse(execFileSync("/opt/node22/bin/node", [`${ROOT}/scripts/behaviour/tests.cjs`, id, dir], { timeout: 20000, encoding: "utf8" }) || "{}"); }
  catch (e) { res = { fatal: { ok: false, detail: String(e.message).slice(0, 200) } }; }
  results[f] = { id, complete: run.final.complete, props: res };
}
fs.writeFileSync(`${D}/behaviour.json`, JSON.stringify(results, null, 1));
console.log("runs tested:", Object.keys(results).length);
