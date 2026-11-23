// Cross-version behaviour check over saved runs.
// usage: node scripts/crossver/run.mjs <outJson> <runJson...>
// For each run: materialise ORIGINAL v1 project and MIGRATED project, record both (record.cjs), compare:
//   wire     - the canonical requests sent to the library service differ (order-sensitive)
//   relation - in v1 the entry's result equalled a library predicate on the same input (e.g. "authorised iff the
//              library accepts the request") across all inputs; in v2 it no longer equals the v2 predicate
//   output   - the consumer-visible result differs, after masking strings that came from library responses
//   throw    - one side threw and the other did not
// Also runs the pre-registered hand-written property tests (scripts/behaviour/tests.cjs) for an agreement table.
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { createRequire } from "module"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url); const ts = require("typescript");
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, "../..");
const TMP = path.join(ROOT, "out/crossver_tmp");
const { compare } = await import(path.join(HERE, "compare.mjs"));
const { getMeta } = await import(path.join(ROOT, "apps/demo-ui/scenarioMeta.mjs"));
const [outJson, ...runFiles] = process.argv.slice(2);

const materialise = (id, run, tag) => {
  const dir = path.join(TMP, tag); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const rel of getMeta(id).fixtureFiles) {
    const src = run?.patches?.[rel]?.after ?? fs.readFileSync(path.join(ROOT, rel), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    fs.writeFileSync(path.join(dir, path.basename(rel).replace(/\.ts$/, ".js")), js);
  }
  return dir;
};
const node = (args) => { try { return JSON.parse(execFileSync(process.execPath, args, { timeout: 20000, encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } }) || "{}"); }
  catch (e) { return { fatal: String(e.message).slice(0, 200) }; } };
const record = (id, dir, ver) => node([path.join(HERE, "record.cjs"), id, dir, ver]);

const results = {}; const baseCache = {};
for (const rf of runFiles) {
  const name = path.basename(rf).replace(/\.json$/, ""); const id = name.split(".")[0];
  const run = rf === "self" ? null : JSON.parse(fs.readFileSync(rf, "utf8"));
  const sid = rf === "self" ? process.env.SELF_ID : id;
  baseCache[sid] ??= record(sid, materialise(sid, null, `${sid}__v1`), "v1");
  const mdir = materialise(sid, run, name === "self" ? `${sid}__self` : name);
  const t2 = record(sid, mdir, rf === "self" ? "v1" : "v2");
  const findings = compare(baseCache[sid], t2);
  const oracle = rf === "self" ? null : node([path.join(ROOT, "scripts/behaviour/tests.cjs"), sid, mdir]);
  const oracleOk = oracle ? Object.values(oracle).every((p) => p.ok) && Object.keys(oracle).length > 0 : null;
  const b = baseCache[sid]; // guard against a vacuous baseline (both sides failing identically would look "ok")
  const baseline = b.fatal ? { fatal: b.fatal } : { calls: b.calls.length, threw: b.calls.filter((c) => c.threw).length, wire: b.calls.reduce((n, c) => n + c.wire.length, 0) };
  results[name] = { id: sid, baseline, complete: run?.final?.complete ?? null, crossverOk: findings.length === 0, oracleOk, findings,
    oracleFailed: oracle ? Object.entries(oracle).filter(([, p]) => !p.ok).map(([k, p]) => `${k}: ${String(p.detail).slice(0, 80)}`) : [] };
  console.log(`${findings.length ? "FLAG" : "ok  "} oracle=${oracleOk === null ? "-" : oracleOk ? "pass" : "FAIL"} ${name}  ${findings.map((x) => `${x.kind}:${x.call}`).join("; ").slice(0, 220)}`);
}
fs.writeFileSync(outJson, JSON.stringify(results, null, 1));
