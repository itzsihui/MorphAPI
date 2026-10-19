#!/usr/bin/env node
// Test gate (harness, not MorphAPI): a Claude Code Stop hook given to EVERY arm.
// usage: test_gate.cjs <test-script> <ws> <start-snapshot-dir> --state=<file>
// On each attempt to finish: runs `bash <test-script> .` in <ws>.
//  - tests fail                        -> block (up to MAX_FAIL_BLOCKS), with the failure summary
//  - new .skip/.only/xit/xdescribe/.todo in test files vs the start -> block (same cap)
//  - test files deleted, or fewer test cases declared than at the start -> block ONCE, asking for a justification
//  - script prints NO_OFFLINE_TESTS (exit 2) -> no gate
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FLAGS = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const [script, ws, sd] = ARGS.map((x) => path.resolve(x));
const MAX_FAIL_BLOCKS = 5;

const SKIP = new Set(["node_modules", ".git", "coverage", "dist", "out", ".next", ".vitest-cache"]);
const isTest = (f) => /(^|\/)(__tests__|tests?)\/.*\.[cm]?[jt]sx?$|[._-](test|spec)\.[cm]?[jt]sx?$|-test\.[cm]?[jt]sx?$/.test(f);
function testFiles(root) {
  const out = {};
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); }
      else {
        const rel = path.relative(root, p).split(path.sep).join("/");
        if (isTest(rel)) { try { out[rel] = fs.readFileSync(p, "utf8"); } catch {} }
      }
    }
  };
  walk(root);
  return out;
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const count = (files, re) => Object.values(files).reduce((n, t) => n + (strip(t).match(re) || []).length, 0);
const SKIPS = /\b(?:it|test|describe|context)\s*\.\s*(?:skip|only|todo)\s*\(|\bx(?:it|describe|test|context)\s*\(|\bf(?:it|describe)\s*\(/g;
const CASES = /\b(?:it|test)\s*(?:\.\s*each\s*\([^)]*\)\s*)?\(/g;

function main(input) {
  let st = { invocations: 0, failBlocks: 0, weakenShown: false, log: [] };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(FLAGS.state, "utf8")) }; } catch {}
  const t0 = Date.now();
  const r = spawnSync("bash", [script, "."], { cwd: ws, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const outp = (r.stdout || "") + (r.stderr || "");
  const clean = outp.replace(/\x1b\[[0-9;]*m/g, "");
  let decision = null, reason = "";
  const noTests = /NO_OFFLINE_TESTS/.test(clean) && r.status === 2;
  const start = testFiles(sd), now = testFiles(ws);
  const newSkips = count(now, SKIPS) - count(start, SKIPS);
  const deleted = Object.keys(start).filter((f) => !(f in now));
  const casesStart = count(start, CASES), casesNow = count(now, CASES);
  const passed = !noTests && r.status === 0;
  const summary = clean.split("\n").filter((l) => /^(FAIL|Tests:|Test Suites:)|●|\d+ (passing|failing|pending)|Error:|COMPILE_FAILED/.test(l.trim())).slice(0, 80).join("\n");
  if (!noTests && !passed && st.failBlocks < MAX_FAIL_BLOCKS) {
    st.failBlocks++;
    decision = "block";
    reason = `Test gate (runs automatically when you try to finish): \`bash ${script} .\` fails (exit ${r.status}${r.error ? ", " + r.error.code : ""}). You cannot finish while the tests fail (block ${st.failBlocks} of ${MAX_FAIL_BLOCKS}). Fix the code or the migration of the tests; do not delete, skip or weaken tests.\n${summary || clean.slice(-3000)}`;
  } else if (!noTests && newSkips > 0 && st.failBlocks < MAX_FAIL_BLOCKS) {
    st.failBlocks++;
    decision = "block";
    reason = `Test gate: the tests pass, but ${newSkips} new .skip/.only/xit/xdescribe/.todo were added to test files. Remove them and make those tests pass (block ${st.failBlocks} of ${MAX_FAIL_BLOCKS}).`;
  } else if (!noTests && !st.weakenShown && (deleted.length || casesNow < casesStart)) {
    st.weakenShown = true;
    decision = "block";
    reason = `Test gate: the tests pass, but ${deleted.length ? `test files were deleted (${deleted.slice(0, 10).join(", ")})` : ""}${deleted.length && casesNow < casesStart ? " and " : ""}${casesNow < casesStart ? `test files now declare ${casesNow} test cases instead of ${casesStart}` : ""}. If tests were removed because the feature they test was removed by the upgrade, say so in your final message for each; otherwise restore them. Then finish.`;
  }
  st.invocations++;
  st.log.push({ t: new Date().toISOString(), ms: Date.now() - t0, exit: r.status, passed, noTests, newSkips, deleted: deleted.length, casesStart, casesNow, decision: decision || "allow", stop_hook_active: !!(input && input.stop_hook_active) });
  try { fs.writeFileSync(FLAGS.state, JSON.stringify(st, null, 1)); } catch {}
  if (decision) process.stdout.write(JSON.stringify({ decision, reason: reason.slice(0, 20000) }));
  process.exit(0);
}
let inp = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (inp += d));
process.stdin.on("end", () => { let j = {}; try { j = JSON.parse(inp); } catch {} main(j); });
