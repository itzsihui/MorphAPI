// Same scorer for every arm. usage: node score.mjs <outJson> <runDir...>
// A run dir holds src/ (final files) [+ results.jsonl, gate.json, seconds.txt for agent runs] OR is a MorphAPI
// pipeline JSON (patches). For each: type-check under the project's tsconfig, remaining imports of the old package,
// evasion on added lines, pre-registered properties (tests.cjs), held-out properties (heldout.cjs),
// and the cross-version check (for the agreement table only).
import fs from "fs"; import path from "path"; import { execFileSync, spawnSync } from "child_process"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url); const ts = require("typescript");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { getMeta } = await import(path.join(ROOT, "apps/demo-ui/scenarioMeta.mjs")); const { S } = require(path.join(ROOT, "scripts/crossver/specs.cjs"));
const { compare } = await import(path.join(ROOT, "scripts/crossver/compare.mjs"));
const [outJson, ...inputs] = process.argv.slice(2);
const SC = path.join(ROOT, "out/agentcmp_score"); const node = (args) => { try { return JSON.parse(execFileSync(process.execPath, args, { timeout: 20000, encoding: "utf8" }) || "{}"); } catch (e) { return { fatal: { ok: false, detail: String(e.message).slice(0, 200) } }; } };
const EVADE = /\bas any\b|:\s*any\b|@ts-ignore|@ts-expect-error|@ts-nocheck/;
const rows = [];
for (const inp of inputs) {
  const isPipe = inp.endsWith(".json"); const name = path.basename(inp).replace(/\.json$/, ""); const id = name.split(".")[0];
  const meta = getMeta(id); const fixRoot = path.join(ROOT, meta.fixtureFiles[0].split("/src/")[0]);
  const pipe = isPipe ? JSON.parse(fs.readFileSync(inp, "utf8")) : null;
  const files = {}; // rel-to-src -> text
  for (const rel of meta.fixtureFiles) { const b = rel.split("/src/")[1]; files[b] = pipe ? (pipe.patches?.[rel]?.after ?? fs.readFileSync(path.join(ROOT, rel), "utf8")) : null; }
  if (!isPipe) { const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(path.join(inp, "src"))) files[path.relative(path.join(inp, "src"), f)] = fs.readFileSync(f, "utf8"); }
  const dir = path.join(SC, path.basename(path.dirname(inp)) + "__" + name); fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "js"), { recursive: true });
  for (const f of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(fixRoot, f), path.join(dir, f));
  for (const [rel, text] of Object.entries(files)) { if (text == null) continue; fs.mkdirSync(path.dirname(path.join(dir, "src", rel)), { recursive: true }); fs.writeFileSync(path.join(dir, "src", rel), text);
    if (/\.ts$/.test(rel) && !rel.endsWith(".d.ts")) fs.writeFileSync(path.join(dir, "js", rel.replace(/\.ts$/, ".js")),
      ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText); }
  const tsc = spawnSync(path.join(ROOT, "node_modules/.bin/tsc"), ["--noEmit", "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });
  const v1 = S[id].lib.v1; const v1re = new RegExp(`(from\\s+|require\\(\\s*|import\\(\\s*)["']${v1.replace(/[-]/g, "\\-")}["']`);
  const v1left = Object.entries(files).filter(([, t]) => t && v1re.test(t)).map(([f]) => f);
  const orig = new Set(); for (const rel of meta.fixtureFiles) fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").forEach((l) => orig.add(l.trim()));
  const evasion = Object.values(files).flatMap((t) => (t ?? "").split("\n")).filter((l) => !orig.has(l.trim()) && EVADE.test(l));
  const complete = tsc.status === 0 && v1left.length === 0;
  const props = node([path.join(ROOT, "scripts/behaviour/tests.cjs"), id, path.join(dir, "js")]);
  const held = node([path.join(ROOT, "scripts/behaviour/heldout.cjs"), id, path.join(dir, "js")]);
  const allOk = (o) => Object.keys(o).length > 0 && Object.values(o).every((p) => p.ok);
  const base = node([path.join(ROOT, "scripts/crossver/record.cjs"), id, path.join(ROOT, "out/crossver_tmp", `${id}__v1`), "v1"]);
  const cv = compare(base, node([path.join(ROOT, "scripts/crossver/record.cjs"), id, path.join(dir, "js"), "v2"]));
  let cost = null, secs = null, gate = null, invocations = null;
  if (!isPipe) { const rs = fs.existsSync(path.join(inp, "results.jsonl")) ? fs.readFileSync(path.join(inp, "results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    cost = rs.reduce((n, r) => n + (r.total_cost_usd || 0), 0); invocations = rs.length; secs = Number(fs.readFileSync(path.join(inp, "seconds.txt"), "utf8"));
    try { gate = JSON.parse(fs.readFileSync(path.join(inp, "gate.json"), "utf8")); } catch {} }
  const heldOk = id === "envelope" ? null : allOk(held);
  const row = { run: name, arm: name.split(".")[1], id, complete, tscErrors: tsc.status === 0 ? 0 : (tsc.stdout.match(/error TS/g) || []).length, v1left, evasion: evasion.length,
    propsOk: allOk(props), heldOk, behaviourOk: allOk(props) && heldOk !== false, crossverOk: cv.length === 0,
    failed: [...Object.entries(props), ...Object.entries(held)].filter(([, p]) => !p.ok).map(([k, p]) => `${k}: ${String(p.detail).slice(0, 70)}`),
    cost, secs, invocations, gateChecks: gate?.checks ?? null, gateBlocks: gate?.blocks ?? null };
  rows.push(row);
  console.log(`${row.complete ? "complete" : "INCOMPL "} ${row.behaviourOk ? "beh-ok " : "BEH-FAIL"} ev=${row.evasion} gate=${row.gateBlocks ?? "-"} $${cost?.toFixed(4) ?? "-"} ${name} ${row.failed.join(" | ").slice(0, 150)}`);
}
fs.writeFileSync(outJson, JSON.stringify(rows, null, 1));
