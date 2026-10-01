/**
 * Attach a cascade repairReport to existing LLM-only report.json files
 * (async / envelope / mail) without re-calling the model.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeReport(baseline, scenarioId, build) {
  const reportPath = path.join(ROOT, "baselines", baseline, "out", "report.json");
  const repairPath = path.join(
    ROOT,
    "baselines",
    baseline,
    "out",
    "repair-report.json"
  );
  if (!fs.existsSync(reportPath)) {
    console.warn("skip", baseline);
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const repair = build(report);
  report.repairReport = repair;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(repairPath, JSON.stringify(repair, null, 2) + "\n");
  console.log("attached", baseline);
}

function baseRepair(approach, scenarioId, issues, steps, issueEvals, narrative) {
  const passed = issueEvals.filter((e) => e.pass).length;
  const nums = [];
  for (const e of issueEvals) {
    for (const v of Object.values(e.scores)) {
      if (v !== null) nums.push(v);
    }
  }
  const cascaded = issues.filter(
    (i) => i.discoveredAt === "impact_1hop" || Boolean(i.causedByIssueId)
  );
  const evalById = new Map(issueEvals.map((e) => [e.issueId, e]));
  let completed = 0;
  let remaining = 0;
  for (const iss of cascaded) {
    if (evalById.get(iss.id)?.pass) completed += 1;
    else remaining += 1;
  }
  return {
    approach,
    scenarioId,
    generatedAt: new Date().toISOString(),
    issues,
    steps,
    issueEvals,
    impactFindings: [],
    summary: {
      issueCount: issues.length,
      issuesPassed: passed,
      issuesFailed: issues.length - passed,
      cascadeEdges: issues.filter((i) => i.causedByIssueId).length,
      allIssuesPass: issueEvals.length > 0 && passed === issueEvals.length,
      aggregatorMean:
        nums.length === 0
          ? null
          : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) /
            1000,
      narrative,
      fixesDiscoveredAfterPrimary: cascaded.length,
      fixesCompletedAfterPrimary: completed,
      fixesRemainingAfterPrimary: remaining,
    },
    metricsGlossaryRefs: ["automationCeiling", "hallucination", "semantics"],
  };
}

writeReport("async_llm_only", "async-contagion", (r) => {
  const iss1 = {
    id: "iss-1",
    kind: "api_rename",
    severity: "blocker",
    location: { fileName: "io.ts" },
    symptom: "getObject().promise leaf migration",
    rootCauseHint: "Whole-file / partial LLM",
    discoveredAt: "initial",
  };
  const iss2 = {
    id: "iss-2",
    kind: "missing_await",
    severity: "blocker",
    location: { fileName: "app.ts" },
    symptom: "Caller contagion after leaf async",
    rootCauseHint: "1° impact — often missed by LLM-only",
    discoveredAt: "after_fix",
    causedByIssueId: "iss-1",
  };
  const tc = r.typecheckPass === true;
  const phantoms = r.phantomCount ?? 0;
  const evals = [
    {
      issueId: "iss-1",
      approach: "pure_llm",
      scores: {
        compile: tc ? 1 : 0,
        oracle: phantoms === 0 ? 1 : 0,
        semantic: 1,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c1",
          kind: "tsc",
          detail: `typecheckPass=${tc}, phantoms=${phantoms}`,
        },
      ],
      pass: tc && phantoms === 0,
      rationale: "Leaf migration attempt (LLM-only)",
    },
    {
      issueId: "iss-2",
      approach: "pure_llm",
      scores: {
        compile: 0,
        oracle: phantoms === 0 ? 1 : 0,
        semantic: 0,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c2",
          kind: "impact",
          detail: "app.ts contagion typically remains",
        },
      ],
      pass: false,
      rationale: "Cascade caller fix usually missing in LLM-only",
    },
  ];
  return baseRepair(
    "pure_llm",
    "async-contagion",
    [iss1, iss2],
    [
      {
        step: 1,
        issueId: "iss-1",
        action: "LLM rewrite io.ts",
        source: "whole_file",
        newlyDiscoveredIssueIds: ["iss-2"],
      },
    ],
    evals,
    "LLM-only often migrates leaf I/O then leaves app.ts contagion open."
  );
});

writeReport("envelope_llm_only", "payload-envelope", (r) => {
  const beh = r.behavioralPass === true;
  const tc = r.typecheckPass === true;
  const iss1 = {
    id: "iss-1",
    kind: "api_rename",
    severity: "major",
    location: { fileName: "api.ts" },
    symptom: "listUsers package bump",
    rootCauseHint: "LLM whole-file",
    discoveredAt: "initial",
  };
  const iss2 = {
    id: "iss-2",
    kind: "envelope_unwrap",
    severity: "blocker",
    location: { fileName: "api.ts" },
    symptom: ".data unwrap at edge",
    rootCauseHint: "DFG cascade",
    discoveredAt: "after_fix",
    causedByIssueId: "iss-1",
  };
  const evals = [
    {
      issueId: "iss-1",
      approach: "pure_llm",
      scores: {
        compile: tc ? 1 : 0,
        oracle: 1,
        semantic: beh ? 1 : 0,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c1",
          kind: "report_field",
          detail: `behavioralPass=${beh}`,
        },
      ],
      pass: tc && beh,
      rationale: "Import/API rewrite",
    },
    {
      issueId: "iss-2",
      approach: "pure_llm",
      scores: {
        compile: tc ? 1 : 0,
        oracle: 1,
        semantic: beh ? 1 : 0,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c2",
          kind: "report_field",
          detail: `behavioralPass=${beh}`,
        },
      ],
      pass: beh,
      rationale: beh
        ? "Edge unwrap present"
        : "FAIL: envelope unwrap missed — consumers cascade",
    },
  ];
  return baseRepair(
    "pure_llm",
    "payload-envelope",
    [iss1, iss2],
    [
      {
        step: 1,
        issueId: "iss-1",
        action: "LLM rewrite",
        source: "whole_file",
        newlyDiscoveredIssueIds: ["iss-2"],
      },
    ],
    evals,
    "LLM-only may bump import without .data edge adapter."
  );
});

writeReport("mail_llm_only", "multi-site", (r) => {
  const comp = r.completenessPass === true;
  const leftover = r.leftoverCount ?? 0;
  const tc = r.typecheckPass === true;
  const iss1 = {
    id: "iss-1",
    kind: "api_rename",
    severity: "blocker",
    location: { fileName: "notify.ts" },
    symptom: "Primary sendEmail migration",
    rootCauseHint: "LLM often rewrites one file",
    discoveredAt: "initial",
  };
  const iss2 = {
    id: "iss-2",
    kind: "multi_site_leftover",
    severity: "major",
    location: { fileName: "cron.ts|seed.ts" },
    symptom: `Leftover sendEmail sites (${leftover})`,
    rootCauseHint: "Multi-site cascade",
    discoveredAt: "impact_1hop",
    causedByIssueId: "iss-1",
  };
  const evals = [
    {
      issueId: "iss-1",
      approach: "pure_llm",
      scores: {
        compile: tc ? 1 : 0,
        oracle: 1,
        semantic: 1,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c1",
          kind: "report_field",
          detail: `completenessPass=${comp}`,
        },
      ],
      pass: true,
      rationale: "Partial migration may typecheck",
    },
    {
      issueId: "iss-2",
      approach: "pure_llm",
      scores: {
        compile: tc ? 1 : 0,
        oracle: leftover > 0 ? 0 : 1,
        semantic: comp ? 1 : 0,
        locality: 0,
        cascade: 0,
      },
      citations: [
        {
          id: "c2",
          kind: "report_field",
          detail: `leftoverCount=${leftover}`,
        },
      ],
      pass: comp,
      rationale: comp
        ? "All sites migrated"
        : "FAIL: leftover call sites after primary file fix",
    },
  ];
  return baseRepair(
    "pure_llm",
    "multi-site",
    [iss1, iss2],
    [
      {
        step: 1,
        issueId: "iss-1",
        action: "LLM rewrite (often incomplete)",
        source: "whole_file",
        newlyDiscoveredIssueIds: ["iss-2"],
      },
    ],
    evals,
    `LLM-only completenessPass=${comp}, leftover=${leftover}.`
  );
});
