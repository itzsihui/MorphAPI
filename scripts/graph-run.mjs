#!/usr/bin/env node
/**
 * Print a scenario's Code Property Graph summary + slice facts.
 *   npm run graph:cli -- mail
 * Exits 1 if any fixture file is missing from the program or types collapse to `any`.
 */
import path from "path";
import { fileURLToPath } from "url";
import { buildScenarioGraph } from "../apps/demo-ui/graphService.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] || "mail";

const g = await buildScenarioGraph(ROOT, scenario);
const count = (items, key) =>
  items.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] ?? 0) + 1), acc), {});

const summary = {
  scenario: g.scenario,
  tsconfig: g.tsconfig,
  projectSource: g.projectSource,
  nodes: count(g.nodes, "kind"),
  edges: count(g.edges, "kind"),
  focus: g.focus ? `${g.focus.fileName}:${g.focus.codeStartLine} (${g.focus.callSiteId})` : null,
  tokens: g.tokens,
  health: {
    anyCollapseRate: `${(g.health.anyCollapseRate * 100).toFixed(1)}%`,
    checked: g.health.checked,
    collapsed: g.health.collapsed,
    explicitAny: g.health.explicitAny,
    missingFiles: g.health.missingFiles,
    configErrors: g.health.configErrors,
  },
  sliceFacts: g.sliceFacts,
};
console.log(JSON.stringify(summary, null, 2));

if (g.health.missingFiles.length || g.health.anyCollapseRate > 0) {
  console.error(
    `\nFAIL: ${g.health.missingFiles.length} missing file(s), anyCollapseRate ${(g.health.anyCollapseRate * 100).toFixed(1)}%`
  );
  process.exit(1);
}
