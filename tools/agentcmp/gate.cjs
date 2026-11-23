#!/usr/bin/env node
// Cross-version behaviour gate as a Claude Code Stop hook. usage: gate.cjs <scenario> <wsProjectDir> <stateFile>
// On each attempt to finish: transpile the workspace's src, record it on the NEW library with the gate's driver inputs,
// compare with the ORIGINAL code's recording on the OLD library (precomputed baseline), and block with the
// differences (up to MAX_BLOCKS). It never sees the judge's held-out inputs.
"use strict";
const fs = require("fs"); const path = require("path"); const { execFileSync } = require("child_process");
const ts = require("/opt/agentcmp/nm/typescript");
const G = "/opt/agentcmp/gate"; const MAX_BLOCKS = 5;
const [id, ws, stateFile] = process.argv.slice(2);
let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const state = (() => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return { checks: 0, blocks: 0, log: [] }; } })();
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
(async () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(G, "baseline", `${id}.json`), "utf8"));
  const js = path.join(ws, ".behaviour-check"); fs.rmSync(js, { recursive: true, force: true }); fs.mkdirSync(js);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(ws, "src")).filter((f) => /\.ts$/.test(f) && !f.endsWith(".d.ts")))
    fs.writeFileSync(path.join(js, path.relative(path.join(ws, "src"), f).replace(/\.ts$/, ".js")),
      ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText);
  let trace;
  try { trace = JSON.parse(execFileSync(process.execPath, [path.join(G, "record.cjs"), id, js, "v2"], { encoding: "utf8", timeout: 20000, env: { ...process.env, NODE_PATH: path.join(ws, "node_modules") } })); }
  catch (e) { trace = { fatal: String(e.message).slice(0, 300) }; }
  fs.rmSync(js, { recursive: true, force: true });
  const { compare } = await import(path.join(G, "compare.mjs"));
  const findings = compare(baseline, trace);
  state.checks++; state.log.push({ at: new Date().toISOString(), findings: findings.length });
  if (!findings.length || state.blocks >= MAX_BLOCKS) { save(); return; }
  state.blocks++; save();
  const show = (v) => JSON.stringify(v).slice(0, 300);
  const argsOf = (call) => { const c = trace.calls?.find((x) => `${x.fn}(${x.label})` === call); return c ? `${c.fn}(${show(c.args).slice(1, -1)})` : call; };
  const lines = findings.slice(0, 8).map((f) => {
    if (f.kind === "fatal") return `- the migrated code could not be run: ${f.detail}`;
    if (f.kind === "wire") return `- ${argsOf(f.call)}: the request sent to the service differs.\n    original (v1): ${show(f.v1)}\n    yours (v2):    ${show(f.v2)}`;
    if (f.kind === "relation") return `- ${argsOf(f.call)}: ${f.detail}`;
    if (f.kind === "throw") return `- ${argsOf(f.call)}: original ${typeof f.v1 === "string" ? "threw " + show(f.v1) : "returned " + show(f.v1)}, yours ${typeof f.v2 === "string" ? "threw " + show(f.v2) : "returned " + show(f.v2)}`;
    return `- ${argsOf(f.call)}: result differs (values that came from the library are shown as <lib>).\n    original (v1): ${show(f.v1)}\n    yours (v2):    ${show(f.v2)}`;
  });
  const reason = `Behaviour check (check ${state.blocks} of ${MAX_BLOCKS}): the migrated code behaves differently from the ORIGINAL code on the same inputs. ` +
    `The original was run on the old library and yours on the new one; the requests are compared in the service's terms, so intended API changes (renames, new shapes, units) are already accounted for.\n` +
    lines.join("\n") + (findings.length > 8 ? `\n(${findings.length - 8} more)` : "") + `\nFix these so the behaviour matches the original, then finish again.`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
})().catch((e) => { state.error = String(e && e.message); save(); });
