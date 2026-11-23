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

const leaves = (v, acc = []) => { if (typeof v === "string") acc.push(v); else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, acc)); return acc; };
const mask = (v, strs, objs) => {
  if (v && typeof v === "object" && objs.has(J(v))) return "<lib>";
  if (typeof v === "string") { if (strs.includes(v)) return "<lib>"; let s = v; for (const t of strs) if (t.length >= 6) s = s.split(t).join("<lib>"); return s; }
  if (Array.isArray(v)) return v.map((x) => mask(x, strs, objs));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x, strs, objs)]));
  return v;
};
// Canonical JSON (sorted keys): key order carries no meaning in a JSON request or result.
const J = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
// Every object/array inside a library response: a consumer result equal to one of these is the response passed through.
const subtrees = (v, acc = new Set()) => { if (v && typeof v === "object") { acc.add(J(v)); Object.values(v).forEach((x) => subtrees(x, acc)); } return acc; };
const bview = (c) => (typeof c.out === "boolean" ? c.out : !c.threw);

export function compare(t1, t2) {
  if (t1.fatal || t2.fatal) return [{ kind: "fatal", detail: t1.fatal || t2.fatal }];
  const f = []; const groups = {};
  t1.calls.forEach((c, i) => (groups[`${c.file}:${c.fn}`] ??= []).push(i));
  const related = new Set();
  for (const [g, idx] of Object.entries(groups)) for (const p of t1.preds) {
    if (!t2.preds.includes(p)) continue;
    const holds = idx.every((i) => bview(t1.calls[i]) === t1.calls[i].preds[p]) && new Set(idx.map((i) => t1.calls[i].preds[p])).size > 1;
    if (!holds) continue; related.add(g);
    for (const i of idx) { const c = t2.calls[i]; if (bview(c) !== c.preds[p])
      f.push({ kind: "relation", call: `${c.fn}(${c.label})`, detail: `v1: result == ${p}(input); v2: ${p}(input)=${c.preds[p]} but result=${bview(c)}` }); }
  }
  t1.calls.forEach((c1, i) => { const c2 = t2.calls[i]; const call = `${c1.fn}(${c1.label})`;
    const w1 = c1.wire.map((w) => ({ op: w.op, req: w.req })), w2 = c2.wire.map((w) => ({ op: w.op, req: w.req }));
    if (J(w1) !== J(w2)) f.push({ kind: "wire", call, v1: w1, v2: w2 });
    if (related.has(`${c1.file}:${c1.fn}`)) return;
    if (c1.threw !== c2.threw) { f.push({ kind: "throw", call, v1: c1.threw ? c1.err : c1.out, v2: c2.threw ? c2.err : c2.out }); return; }
    const m = (c) => mask(c.out, leaves(c.wire.map((w) => w.res)).sort((a, b) => b.length - a.length), subtrees(c.wire.map((w) => w.res)));
    const o1 = m(c1), o2 = m(c2);
    if (J(o1) !== J(o2)) f.push({ kind: "output", call, v1: o1, v2: o2 });
  });
  return f;
}

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
