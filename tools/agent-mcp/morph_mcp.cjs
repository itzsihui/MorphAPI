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

// usage: morph_mcp.cjs <task.json> <ws> [<start-snapshot-dir>] [--stop-hook --state=<file>]
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FLAGS = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const cfg = JSON.parse(fs.readFileSync(ARGS[0], "utf8"));
const ws = path.resolve(ARGS[1] || process.cwd());
// The start state is read from a read-only snapshot of the workspace taken before the agent started, when given
// (required for the Stop hook, a fresh process at the end of the run); otherwise from the workspace at startup.
const sd = path.resolve(ARGS[2] || ws);
const toWs = (f) => path.join(ws, path.relative(sd, path.resolve(f)));
const relS = (f) => path.relative(sd, f).split(path.sep).join("/");
const tsconfig = path.join(ws, cfg.tsconfig);
const extra = (cfg.extraFiles || []).map((f) => path.join(ws, f));
const bridges = cfg.bridges;
const successors = cfg.successorModules;
const retired = cfg.retiredModules || bridges.map((b) => b.module).filter((m) => !successors.some((s) => s === m || s.startsWith(m + "/")));
const aliasMap = Object.fromEntries(bridges.map((b) => [b.module, core.aliasOf(b.module)]));
const revertMap = Object.fromEntries(bridges.map((b) => [core.aliasOf(b.module), b.module]));
const unalias = (m) => bridges.reduce((s, b) => s.split(core.aliasOf(b.module)).join(b.module), m);
const rel = (f) => path.relative(ws, f).split(path.sep).join("/");

// Start state (before any edit), keyed by workspace paths.
const sdTsconfig = path.join(sd, cfg.tsconfig);
const sdExtra = (cfg.extraFiles || []).map((f) => path.join(sd, f));
const start = (() => {
  const s = core.ProjectSession.open(sdTsconfig, { aliases: core.bridgeAliases(bridges), extraRootFiles: sdExtra });
  const sdFiles = [...new Set([...s.projectFiles, ...sdExtra].map((f) => path.resolve(f)))];
  return { files: sdFiles.map(toWs), text: Object.fromEntries(sdFiles.map((f) => [toWs(f), s.text(f)])) };
})();
// All text files of the workspace at the start (for the behaviour checks: dangling references, dropped uses).
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".next", "dist", "out", ".vitest-cache", ".nyc_output"]);
const TEXT_EXT = /\.(m|c)?[jt]sx?$|\.(json|ya?ml|html)$/;
function allTexts(root = ws) {
  const out = {};
  const relR = (p) => path.relative(root, p).split(path.sep).join("/");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (TEXT_EXT.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        try { const st = fs.statSync(p); if (st.size < 1e6) out[relR(p)] = fs.readFileSync(p, "utf8"); } catch {}
      }
    }
  };
  walk(root);
  return out;
}
const startAll = allTexts(sd);
const upgraded = [...new Set([...successors, ...bridges.map((b) => b.module)])];
const guideText = (() => { try { return fs.readFileSync(path.join(sd, "MIGRATION_GUIDE.md"), "utf8"); } catch { return ""; } })();
const guide = core.guideItems(guideText);
let pc = core.ProjectCompiler.load(tsconfig, { extraRootFiles: extra, aliases: core.bridgeAliases(bridges) });
// The edits may change tsconfig (e.g. skipLibCheck): reload the project's compiler options when it changes.
let tsconfigText = (() => { try { return fs.readFileSync(tsconfig, "utf8"); } catch { return ""; } })();
const freshCompiler = () => {
  let t = ""; try { t = fs.readFileSync(tsconfig, "utf8"); } catch {}
  if (t !== tsconfigText) { tsconfigText = t; pc = core.ProjectCompiler.load(tsconfig, { extraRootFiles: extra, aliases: core.bridgeAliases(bridges) }); }
};
const baseline = (() => {
  const bridged = Object.fromEntries(start.files.map((f) => [f, core.rewriteSpecifiers(start.text[f], f, aliasMap).text]));
  const m = new Map();
  for (const d of pc.diagnostics(bridged, start.files)) {
    const k = `${d.file}|${d.code}|${unalias(d.message)}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
})();
// Errors inside installed packages' declaration files (tsc reports them unless skipLibCheck), start-state baseline.
const libKey = (d) => `${d.file.slice(d.file.lastIndexOf("node_modules"))}|${d.code}|${unalias(d.message)}`;
const libBaseline = (() => {
  const bridged = Object.fromEntries(start.files.map((f) => [f, core.rewriteSpecifiers(start.text[f], f, aliasMap).text]));
  const m = new Map();
  for (const d of pc.diagnostics(bridged, [], { libraries: true })) m.set(libKey(d), (m.get(libKey(d)) || 0) + 1);
  return m;
})();
const libraryErrors = (texts) => {
  const rem = new Map(libBaseline);
  const out = [];
  for (const d of pc.diagnostics(texts, [], { libraries: true })) {
    const n = rem.get(libKey(d)) || 0;
    if (n > 0) rem.set(libKey(d), n - 1);
    else out.push(`${d.file.slice(d.file.lastIndexOf("node_modules"))}:${d.line} TS${d.code}: ${d.message.split("\n")[0]}`);
  }
  return out;
};
// Names the new version no longer exports (new-version diagnostics on the untouched code).
const missingInNew = core.namesMissingInNewVersion(pc.diagnostics(start.text, start.files).map((d) => d.message));
// The project's own exported surface at the start, typed against the previous SDK (version bridge).
const entryFiles = core.packageEntryFiles(ws, start.files);
const surfaceBefore = (() => {
  try {
    const s = core.ProjectSession.open(sdTsconfig, { aliases: core.bridgeAliases(bridges), extraRootFiles: sdExtra });
    const sdFiles = start.files.map((f) => path.join(sd, path.relative(ws, f)));
    const upd = {};
    for (const f of sdFiles) upd[f] = core.rewriteSpecifiers(s.text(f), f, aliasMap).text;
    s.update(upd);
    return core.exportedSurface(s.program, sdFiles, relS, core.packageEntryFiles(sd, sdFiles));
  } catch (e) { return null; }
})();
// Changed defaults (versionDefaults.ts): old = the bridge's previous version, new = the version installed in the workspace.
const defaultPkgs = bridges
  .map((b) => ({ module: b.module, oldDir: b.previousDir, newDir: path.join(ws, "node_modules", b.module) }))
  .filter((p) => fs.existsSync(p.newDir));
function changedDefaultProblems() {
  try {
    const s = core.ProjectSession.open(tsconfig, { extraRootFiles: extra });
    const files = [...new Set([...start.files.filter((f) => fs.existsSync(f)), ...added()])];
    return core.changedDefaultUses(s.program, files, defaultPkgs, rel).map((u) =>
      `changed default: ${u.file}:${u.line} calls \`${u.fn}\` (${u.module}) without \`${u.option}\`. In the new version it defaults to ${u.newValue}; in the previous version \`${u.option}\` defaulted to ${u.oldValues.map((o) => `${o.value} (${o.fn})`).join(", ")}. Pass \`${u.option}\` explicitly: the old value to keep the old behaviour, or the new value if the change is intended.`);
  } catch (e) { return []; }
}
function guideReminders() {
  const g = core.guideChecklist(guide, startAll, allTexts());
  return g.open.map((o) => `"${o.item.text.slice(0, 220)}" — still present: ${o.sites.slice(0, 5).join(", ")}`);
}
function behaviourFindings() {
  const nowAll = allTexts();
  const out = [];
  for (const f of core.droppedUses(startAll, nowAll, upgraded, missingInNew)) out.push(f.message);
  for (const f of core.danglingRefs(startAll, nowAll)) out.push(f.message);
  // migration-guide reminders are informational only (verifier evaluation: 6 of 65 were real); see guideReminders()
  if (surfaceBefore) {
    try {
      const s = core.ProjectSession.open(tsconfig, { extraRootFiles: extra });
      const files = start.files.filter((f) => fs.existsSync(f));
      for (const f of core.publicApiChanges(surfaceBefore, core.exportedSurface(s.program, files, rel, entryFiles))) out.push(`public API: ${f.message}`);
    } catch {}
  }
  return out;
}
const current = () => Object.fromEntries(start.files.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""]));
const added = () => {
  try {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config || {}, ts.sys, path.dirname(tsconfig));
    const have = new Set(start.files);
    return [...parsed.fileNames, ...extra].map((f) => path.resolve(f)).filter((f) => !have.has(f) && fs.existsSync(f));
  } catch { return []; }
};
const newErrors = (texts) => {
  const rem = new Map(baseline);
  const out = [];
  for (const d of pc.diagnostics(texts, [...start.files, ...added()])) {
    if (!fs.existsSync(d.file)) continue; // a file the edits deleted is not compiled by tsc
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
  const g = core.guideChecklist(guide, startAll, allTexts());
  const guideLines = g.applies.map((it) => {
    const open = g.open.find((o) => o.item === it);
    return `- [${open ? "open" : "done"}] "${it.text.slice(0, 260)}"${open ? `\n    still present: ${open.sites.slice(0, 5).join(", ")}` : ""}`;
  });
  const lines = items.map((i) => `- ${rel(i.file)}:${i.startLine} [${i.source}] ${i.text.split("\n")[0].slice(0, 100)}\n    ${i.notes.slice(0, 2).join(" | ").slice(0, 300)}`);
  const ho = handoffs.map((h) => `- ${rel(h.file)}:${h.startLine} ${h.notes[0].slice(0, 300)}`);
  return [
    `${items.length} site(s) still broken by the upgrade (found with the previous version loaded beside the new one; includes uses of exports the new version dropped, which the compiler does not report at each use).`,
    ...lines,
    (() => { try { const cd = core.changedDefaultsSummary(defaultPkgs, 15); return cd.length ? `\nOption defaults that changed between the versions (code that omits these options behaves differently):\n${cd.map((x) => `- ${x}`).join("\n")}` : ""; } catch { return ""; } })(),
    guideLines.length ? `\nMigration-guide instructions that apply to this project (they name APIs your code used at the start):\n${guideLines.join("\n")}` : "",
    ho.length ? `\nUntyped hand-offs to packages written for the replaced SDK (they compile but fail at runtime):\n${ho.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

const EVASION = [/\bas\s+any\b/, /:\s*any\b/, /@ts-ignore/, /@ts-expect-error/, /@ts-nocheck/, /eslint-disable/];
function checkEditFindings() {
  freshCompiler();
  const texts = current();
  const findings = [];
  for (const e of newErrors(texts)) findings.push(`compiler (project's TypeScript ${pc.version}): ${e}`);
  for (const e of libraryErrors(texts)) findings.push(`library type error (tsc reports it): ${e}`);
  const importSpec = (l) => {
    const m = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/.exec(l);
    return m && (m[1] || m[2] || m[3]);
  };
  for (const f of start.files) {
    const a = start.text[f].split("\n");
    const b = texts[f].split("\n");
    // Added lines from a real line diff (not "text seen somewhere in the old file").
    if (texts[f] !== start.text[f]) {
      for (const h of core.lineHunks(a, b)) {
        for (let i = h.b1; i < h.b2; i++) {
          const l = b[i];
          for (const re of EVASION) if (re.test(l)) findings.push(`evasion: ${rel(f)}:${i + 1} adds \`${l.trim().slice(0, 120)}\` (hides type errors; use real types)`);
          const spec = importSpec(l);
          if (spec && /\/compat(\/|$)/.test(spec)) findings.push(`compatibility layer: ${rel(f)}:${i + 1} imports ${spec}; migrate to the new API instead of the temporary compat layer`);
        }
      }
    }
    // \`any\` written inside types (\`options as { type: any }\`), which the line patterns miss.
    if (texts[f] !== start.text[f]) {
      const added = core.countAnyKeywords(texts[f]) - core.countAnyKeywords(start.text[f]);
      if (added > 0) findings.push(`evasion: ${rel(f)} now writes the type \`any\` ${added} more time(s) than before (hides type errors; use real types)`);
    }
    // Imports of a replaced package anywhere in the project, edited or not.
    b.forEach((l, i) => {
      const spec = importSpec(l);
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
  for (const p of changedDefaultProblems()) findings.push(p);
  try {
    const s2 = core.ProjectSession.open(tsconfig, { extraRootFiles: extra });
    const files2 = [...new Set([...start.files.filter((f) => fs.existsSync(f)), ...added()])];
    for (const f of core.crossVersionFindings(s2.program, files2, defaultPkgs, rel)) findings.push(`${f.check === "now_async" ? "now async" : "option no longer accepted"}: ${f.message}`);
  } catch {}
  return { problems: findings, confirm: behaviourFindings() };
}
const isPolicy = (x) => /^(evasion|compatibility layer|retired package):/.test(x);
function checkEdit() {
  const { problems: all, confirm } = checkEditFindings();
  const bugs = all.filter((x) => !isPolicy(x)), policy = all.filter(isPolicy);
  const findings = all;
  const sec = (title, xs) => xs.length ? `\n${title} (${xs.length}):\n${xs.map((x) => `- ${x}`).join("\n")}` : "";
  const reminders = guideReminders();
  return (all.length ? `${all.length} problem(s) to fix.` : "No problems found.") +
    sec("Bugs (compiler errors, and behaviour changes between the library versions)", bugs) +
    sec("Policy (type suppressions, compatibility layers, replaced packages)", policy) +
    (confirm.length ? `\n\nBehaviour changes to confirm (each may be intended; decide each one) (${confirm.length}):\n${confirm.map((x) => `- ${x}`).join("\n")}` : "") +
    (reminders.length ? `\n\nMigration-guide reminders (informational, not checked) (${reminders.length}):\n${reminders.slice(0, 8).map((x) => `- ${x}`).join("\n")}` : "");
  // eslint-disable-next-line no-unreachable
  const head = findings.length ? `${findings.length} problem(s):\n${findings.map((x) => `- ${x}`).join("\n")}` : "No problems found: no new compiler errors with the project's TypeScript, no evasion, no compat-layer or retired-package imports.";
  const tail = confirm.length
    ? `\n\n${confirm.length} behaviour change(s) to confirm (the compiler cannot see these; each may be intended, but decide each one):\n${confirm.map((x) => `- ${x}`).join("\n")}`
    : "\n\nNo behaviour changes to confirm (dropped uses of still-existing APIs, references to deleted files or routes, open migration-guide instructions, changes to the project's exported API).";
  return head + tail;
}

const TOOLS = [
  { name: "migration_status", description: "List every site in the project that the dependency upgrade still breaks, found by MorphAPI with the previous SDK version loaded beside the new one. Includes uses of exports the new version dropped (the compiler does not flag each use), untyped hand-offs, and the migration-guide instructions that apply to this project. Call it first and again as you go.", inputSchema: { type: "object", properties: {} } },
  { name: "check_edit", description: "Check the current edits with MorphAPI's gate. Problems: new errors under the project's own TypeScript compiler (incl. library type errors), any-casts or ts-ignore, imports of a compatibility layer or a replaced package, X.prototype.instanceProperty, calls that omit an option whose default changed between the versions, options passed through variables that the new version no longer accepts, now-async APIs used without await. Behaviour changes to confirm (invisible to the compiler): removed uses of APIs that still exist (e.g. a dropped auth wrapper), references to deleted files or routes, migration-guide instructions still open, changes to the project's exported API. Run before finishing; fix every problem and decide every behaviour change.", inputSchema: { type: "object", properties: {} } },
];

// ---- Stop hook (binding check_edit): Claude Code runs this when the agent tries to finish. ----
// Problems (compiler errors, evasion, compat/retired imports, library errors, prototype misuse) block finishing,
// up to MAX_BLOCKS times; behaviour changes to confirm block once, so the agent decides each one explicitly.
const MAX_BLOCKS = 6;
function stopHook(input) {
  const stateFile = FLAGS.state;
  let st = { invocations: 0, problemBlocks: 0, confirmShown: false, log: [] };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) }; } catch {}
  const t0 = Date.now();
  let decision = null, reason = "";
  let res;
  try { res = checkEditFindings(); } catch (e) { res = { problems: [], confirm: [], error: String(e && e.message) }; }
  const { problems, confirm } = res;
  const list = (xs) => xs.slice(0, 60).map((x) => `- ${x}`).join("\n") + (xs.length > 60 ? `\n- ... and ${xs.length - 60} more (run check_edit)` : "");
  if (problems.length && st.problemBlocks < MAX_BLOCKS) {
    st.problemBlocks++;
    decision = "block";
    reason = `MorphAPI check_edit (runs automatically when you try to finish): ${problems.length} problem(s) remain. You cannot finish until they are fixed (block ${st.problemBlocks} of ${MAX_BLOCKS}).\n${list(problems)}`
      + (confirm.length ? `\n\nAlso decide these ${confirm.length} behaviour change(s) (fix, or say in your final message why each is intended):\n${list(confirm)}` : "");
  } else if (confirm.length && !st.confirmShown) {
    st.confirmShown = true;
    decision = "block";
    reason = `MorphAPI check_edit (runs automatically when you try to finish): no blocking problems${problems.length ? " left that it will still block on" : ""}, but ${confirm.length} behaviour change(s) need a decision. The compiler cannot see these. For each one, either fix it or state in your final message why it is intended; then finish.\n${list(confirm)}`;
  }
  st.invocations++;
  st.log.push({ t: new Date().toISOString(), ms: Date.now() - t0, stop_hook_active: !!(input && input.stop_hook_active), problems: problems.length, confirm: confirm.length, decision: decision || "allow", error: res.error });
  try { fs.writeFileSync(stateFile, JSON.stringify(st, null, 1)); } catch {}
  if (decision) process.stdout.write(JSON.stringify({ decision, reason: reason.slice(0, 20000) }));
  process.exit(0);
}
if (FLAGS["stop-hook"]) {
  let inp = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (inp += d));
  process.stdin.on("end", () => { let j = {}; try { j = JSON.parse(inp); } catch {} stopHook(j); });
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
let buf = "";
if (!FLAGS["stop-hook"]) process.stdin.setEncoding("utf8");
if (!FLAGS["stop-hook"]) process.stdin.on("data", (chunk) => {
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
