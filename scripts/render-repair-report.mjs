/**
 * Render ApproachReport JSON → markdown for evaluators.
 * Usage: node scripts/render-repair-report.mjs [path/to/repair-report.json]
 * Or: node scripts/render-repair-report.mjs --all-pilots
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PILOTS = [
  ["openai", ["openai_llm_only", "openai_ast", "openai_hybrid"]],
  ["async", ["async_llm_only", "async_ast", "async_hybrid"]],
  ["envelope", ["envelope_llm_only", "envelope_ast", "envelope_hybrid"]],
  ["mail", ["mail_llm_only", "mail_ast", "mail_hybrid"]],
];

function render(report) {
  const lines = [];
  lines.push(`# Repair report — ${report.scenarioId} (${report.approach})`);
  lines.push("");
  lines.push(`Generated: \`${report.generatedAt}\``);
  lines.push("");
  lines.push("## Metrics glossary (rubric dimensions)");
  lines.push("");
  lines.push("| Dimension | Meaning |");
  lines.push("|-----------|---------|");
  lines.push("| compile | typecheck for this issue |");
  lines.push("| oracle | no phantoms / allow-list |");
  lines.push("| semantic | behavioral / completeness / security fragment |");
  lines.push("| locality | surgical AST vs whole-file |");
  lines.push("| cascade | secondary issues detected after this fix |");
  lines.push("");
  lines.push("## Issues");
  lines.push("");
  for (const iss of report.issues ?? []) {
    lines.push(`### ${iss.id} — ${iss.kind} (${iss.discoveredAt})`);
    lines.push("");
    lines.push(`- **Severity:** ${iss.severity}`);
    lines.push(
      `- **Location:** ${iss.location?.fileName ?? "?"}${iss.location?.startLine ? `:${iss.location.startLine}` : ""}`
    );
    lines.push(`- **Symptom:** ${iss.symptom}`);
    lines.push(`- **Root cause hint:** ${iss.rootCauseHint}`);
    if (iss.causedByIssueId) {
      lines.push(`- **Caused by:** ${iss.causedByIssueId}`);
    }
    const ev = (report.issueEvals ?? []).find((e) => e.issueId === iss.id);
    if (ev) {
      lines.push(`- **Pass:** ${ev.pass ? "PASS" : "FAIL"}`);
      lines.push(
        `- **Scores:** compile=${ev.scores.compile} oracle=${ev.scores.oracle} semantic=${ev.scores.semantic} locality=${ev.scores.locality} cascade=${ev.scores.cascade}`
      );
      lines.push(`- **Rationale:** ${ev.rationale}`);
      if (ev.citations?.length) {
        lines.push("- **Citations:**");
        for (const c of ev.citations) {
          lines.push(`  - \`[${c.kind}]\` ${c.detail}${c.ref ? ` (${c.ref})` : ""}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("## Repair process");
  lines.push("");
  for (const s of report.steps ?? []) {
    lines.push(
      `${s.step}. **${s.issueId}** — ${s.action} (${s.source ?? "?"})` +
        (s.newlyDiscoveredIssueIds?.length
          ? ` → discovered ${s.newlyDiscoveredIssueIds.join(", ")}`
          : "")
    );
    if (s.notes) lines.push(`   - ${s.notes}`);
  }
  lines.push("");

  if (report.impactFindings?.length) {
    lines.push("## Impact analysis (1°)");
    lines.push("");
    for (const f of report.impactFindings) {
      lines.push(
        `- **${f.id}** from ${f.fromIssueId}: ${f.fileName}${f.startLine ? `:${f.startLine}` : ""} — ${f.reason}: ${f.detail}`
      );
    }
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  const sum = report.summary ?? {};
  lines.push(`- Issues: ${sum.issueCount} (passed ${sum.issuesPassed}, failed ${sum.issuesFailed})`);
  lines.push(`- Cascade edges: ${sum.cascadeEdges}`);
  lines.push(
    `- After primary fix: discovered ${sum.fixesDiscoveredAfterPrimary ?? 0} follow-up issue(s); completed ${sum.fixesCompletedAfterPrimary ?? 0}; remaining ${sum.fixesRemainingAfterPrimary ?? 0}`
  );
  lines.push(`- All issues pass: ${sum.allIssuesPass}`);
  lines.push(`- Aggregator mean (secondary): ${sum.aggregatorMean}`);
  lines.push(`- Narrative: ${sum.narrative}`);
  lines.push("");
  return lines.join("\n");
}

function processFile(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    console.warn(`skip missing ${jsonPath}`);
    return;
  }
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const md = render(report);
  const base = path.basename(path.dirname(path.dirname(jsonPath))); // e.g. openai_hybrid
  const outDir = path.join(ROOT, "docs", "repair");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${base}.md`);
  fs.writeFileSync(outPath, md);
  console.log(`Wrote ${outPath}`);
}

const arg = process.argv[2];
if (arg === "--all-pilots") {
  for (const [, baselines] of PILOTS) {
    for (const b of baselines) {
      processFile(path.join(ROOT, "baselines", b, "out", "repair-report.json"));
    }
  }
} else if (arg) {
  processFile(path.resolve(arg));
} else {
  console.log(
    "Usage: node scripts/render-repair-report.mjs <repair-report.json> | --all-pilots"
  );
  process.exit(1);
}
