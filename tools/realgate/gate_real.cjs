#!/usr/bin/env node
// Real-repo behaviour gate. usage: gate_real.cjs <gateDir> <projectCopy> <stateFile>
// Runs <gateDir>/probot_driver.js on the project copy, compares with <gateDir>/baseline.json (the ORIGINAL project on
// the OLD library) and prints {"decision":"block","reason":...} when they differ (at most MAX_BLOCKS times).
"use strict";
const fs = require("fs"); const path = require("path"); const { execFileSync } = require("child_process");
const MAX_BLOCKS = 5; const [G, proj, stateFile] = process.argv.slice(2);
const state = (() => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return { checks: 0, blocks: 0, log: [] }; } })();
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
(async () => {
  let trace;
  try { trace = JSON.parse(execFileSync(process.execPath, [path.join(G, "probot_driver.js"), proj], { encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "ignore"] }) || "{}"); }
  catch (e) { trace = { fatal: "the behaviour driver did not finish: " + String(e.message).slice(0, 200) }; }
  const { compare } = await import(path.join(G, "compare.mjs"));
  const findings = compare(JSON.parse(fs.readFileSync(path.join(G, "baseline.json"), "utf8")), trace);
  state.checks++; state.log.push({ at: new Date().toISOString(), findings: findings.length, kinds: findings.map((f) => `${f.kind}:${f.call || ""}`).slice(0, 20) });
  if (!findings.length || state.blocks >= MAX_BLOCKS) { save(); return; }
  state.blocks++; save();
  const show = (v) => JSON.stringify(v).slice(0, 260);
  const lines = findings.slice(0, 10).map((f) => {
    if (f.kind === "fatal") return `- the project could not be exercised: ${f.detail}`;
    if (f.kind === "missing") return `- ${f.call}: this step could not run on the migrated code`;
    if (f.kind === "wire") return `- ${f.call}: GitHub API requests differ.\n    original: ${show(f.v1)}\n    yours:    ${show(f.v2)}`;
    if (f.kind === "throw") return `- ${f.call}: original ${typeof f.v1 === "string" ? "threw " + show(f.v1) : "gave " + show(f.v1)}; yours ${typeof f.v2 === "string" ? "threw " + show(f.v2) : "gave " + show(f.v2)}`;
    return `- ${f.call}: observable result differs.\n    original: ${show(f.v1)}\n    yours:    ${show(f.v2)}`;
  });
  const reason = `Behaviour check (check ${state.blocks} of ${MAX_BLOCKS}): probot as migrated behaves differently for its users than the ORIGINAL probot did. ` +
    `A small Probot app was run against both, using probot's public API: signed webhook deliveries over HTTP (createNodeMiddleware and probot's Server), probot.receive(), ` +
    `Context helpers, and the GitHub API requests the app's handlers make. The original ran on @octokit/webhooks v7 and yours on v9. Differences:\n` +
    lines.join("\n") + (findings.length > 10 ? `\n(${findings.length - 10} more)` : "") + `\nUnless a difference is required by the upgrade, fix it so probot behaves as before, then finish again.`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
})().catch((e) => { state.error = String(e && e.message); save(); });
