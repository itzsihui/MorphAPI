#!/usr/bin/env node
// MorphAPI as tools for a coding agent (MCP over stdio, newline-delimited JSON-RPC).
// usage: node morph_mcp.cjs <task-config.json>   (cwd = the agent's workspace)
// Tools:
//   migration_status — every site the upgrade breaks (version bridge + MorphAPI discovery), incl. uses of
//                      dropped exports that the compiler is silent about, and untyped hand-offs.
//   check_edit       — MorphAPI's gate over the current edits vs the start state, with the project's own compiler.
// No LLM is called; this process never sees an API key or the reference fixes.
"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../../packages/morphapi-core/dist/index.js");
const ts = require("typescript");

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ws = path.resolve(process.argv[3] || process.cwd());
const tsconfig = path.join(ws, cfg.tsconfig);
const extra = (cfg.extraFiles || []).map((f) => path.join(ws, f));
const bridges = cfg.bridges;
const successors = cfg.successorModules;
const retired = cfg.retiredModules || bridges.map((b) => b.module).filter((m) => !successors.some((s) => s === m || s.startsWith(m + "/")));
const aliasMap = Object.fromEntries(bridges.map((b) => [b.module, core.aliasOf(b.module)]));
const revertMap = Object.fromEntries(bridges.map((b) => [core.aliasOf(b.module), b.module]));
const unalias = (m) => bridges.reduce((s, b) => s.split(core.aliasOf(b.module)).join(b.module), m);
const rel = (f) => path.relative(ws, f).split(path.sep).join("/");

// Start state, snapshotted when the agent starts (before any edit).
const start = (() => {
  const s = core.ProjectSession.open(tsconfig, { aliases: core.bridgeAliases(bridges), extraRootFiles: extra });
  const files = [...new Set([...s.projectFiles, ...extra].map((f) => path.resolve(f)))];
  return { files, text: Object.fromEntries(files.map((f) => [f, s.text(f)])) };
})();
const pc = core.ProjectCompiler.load(tsconfig, { extraRootFiles: extra, aliases: core.bridgeAliases(bridges) });
const baseline = (() => {
  const bridged = Object.fromEntries(start.files.map((f) => [f, core.rewriteSpecifiers(start.text[f], f, aliasMap).text]));
  const m = new Map();
  for (const d of pc.diagnostics(bridged, start.files)) {
    const k = `${d.file}|${d.code}|${unalias(d.message)}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
})();
const current = () => Object.fromEntries(start.files.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""]));
const newErrors = (texts) => {
  const rem = new Map(baseline);
  const out = [];
  for (const d of pc.diagnostics(texts, start.files)) {
    const k = `${d.file}|${d.code}|${d.message}`;
    const n = rem.get(k) || 0;
    if (n > 0) rem.set(k, n - 1);
    else out.push(`${rel(d.file)}:${d.line} TS${d.code}: ${d.message.split("\n")[0]}`);
  }
  return out;
};

function migrationStatus() {
  const texts = current();
  const bridged = core.ProjectSession.open(tsconfig, { aliases: core.bridgeAliases(bridges), extraRootFiles: extra });
  const upd = {};
  for (const f of start.files) upd[f] = core.rewriteSpecifiers(texts[f], f, aliasMap).text;
  bridged.update(upd);
  const retiredBridges = bridges.filter((b) => retired.includes(b.module));
  const items = core.discoverWorkItems({
    bridged,
    newWorld: pc.diagnostics(texts, start.files).map((d) => ({ ...d, message: unalias(d.message) })),
    baseline,
    newWorldText: (f) => texts[path.resolve(f)],
    bridges,
    retired: retiredBridges,
    files: start.files,
  });
  const handoffs = retiredBridges.length ? core.findHandoffs(bridged, start.files, retiredBridges.map((b) => b.previousDir)) : [];
  const lines = items.map((i) => `- ${rel(i.file)}:${i.startLine} [${i.source}] ${i.text.split("\n")[0].slice(0, 100)}\n    ${i.notes.slice(0, 2).join(" | ").slice(0, 300)}`);
  const ho = handoffs.map((h) => `- ${rel(h.file)}:${h.startLine} ${h.notes[0].slice(0, 300)}`);
  return [
    `${items.length} site(s) still broken by the upgrade (found with the previous version loaded beside the new one; includes uses of exports the new version dropped, which the compiler does not report at each use).`,
    ...lines,
    ho.length ? `\nUntyped hand-offs to packages written for the replaced SDK (they compile but fail at runtime):\n${ho.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

const EVASION = [/\bas\s+any\b/, /:\s*any\b/, /@ts-ignore/, /@ts-expect-error/, /@ts-nocheck/, /eslint-disable/];
function checkEdit() {
  const texts = current();
  const findings = [];
  for (const e of newErrors(texts)) findings.push(`compiler (project's TypeScript ${pc.version}): ${e}`);
  for (const f of start.files) {
    const before = new Set(start.text[f].split("\n").map((l) => l.trim()));
    texts[f].split("\n").forEach((l, i) => {
      if (before.has(l.trim())) return;
      for (const re of EVASION) if (re.test(l)) findings.push(`evasion: ${rel(f)}:${i + 1} adds \`${l.trim().slice(0, 120)}\` (hides type errors; use real types)`);
      const m = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/.exec(l);
      const spec = m && (m[1] || m[2]);
      if (spec && /\/compat(\/|$)/.test(spec)) findings.push(`compatibility layer: ${rel(f)}:${i + 1} imports ${spec}; migrate to the new API instead of the temporary compat layer`);
      if (spec && retired.some((r) => spec === r || spec.startsWith(r + "/"))) findings.push(`retired package: ${rel(f)}:${i + 1} still imports ${spec}`);
    });
  }
  // X.prototype.p where p is an instance property: type-checks, undefined at runtime.
  const s = core.ProjectSession.open(tsconfig, { extraRootFiles: extra });
  const changed = start.files.filter((f) => texts[f] !== start.text[f]);
  const checker = s.checker;
  for (const f of changed) {
    const sf = s.sourceFile(f);
    if (!sf) continue;
    const visit = (n) => {
      if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "prototype") {
        const decls = checker.getSymbolAtLocation(n.name)?.declarations || [];
        if (decls.length && decls.every((d) => ts.isPropertyDeclaration(d) || ts.isParameter(d))) {
          findings.push(`runtime: ${rel(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf)} is undefined at runtime (instance property, not on the prototype)`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return findings.length ? `${findings.length} problem(s):\n${findings.map((x) => `- ${x}`).join("\n")}` : "No problems found: no new compiler errors with the project's TypeScript, no evasion, no compat-layer or retired-package imports.";
}

const TOOLS = [
  { name: "migration_status", description: "List every site in the project that the dependency upgrade still breaks, found by MorphAPI with the previous SDK version loaded beside the new one. Includes uses of exports the new version dropped (the compiler does not flag each use) and untyped hand-offs. Call it first and again as you go.", inputSchema: { type: "object", properties: {} } },
  { name: "check_edit", description: "Check the current edits with MorphAPI's gate: new errors under the project's own TypeScript compiler, added any-casts or ts-ignore, imports of a compatibility layer or a replaced package, and X.prototype.instanceProperty (undefined at runtime). Run before finishing and fix everything it reports.", inputSchema: { type: "object", properties: {} } },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    if (req.id === undefined) continue; // notifications
    try {
      if (req.method === "initialize") send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: req.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "morph", version: "2.0.0" } } });
      else if (req.method === "tools/list") send({ jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } });
      else if (req.method === "tools/call") {
        const name = req.params?.name;
        const text = name === "migration_status" ? migrationStatus() : name === "check_edit" ? checkEdit() : `unknown tool ${name}`;
        send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: text.slice(0, 60000) }] } });
      } else if (req.method === "ping") send({ jsonrpc: "2.0", id: req.id, result: {} });
      else send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
    } catch (e) {
      send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: `tool error: ${e && e.message}` }], isError: true } });
    }
  }
});
