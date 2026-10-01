/**
 * Cascade repair report model — per-issue rubrics with citations.
 * Primary evidence is issue-level; scenario aggregator comes later.
 */

export type ApproachKind = "pure_llm" | "pure_ast" | "hybrid";

export type IssueDiscoveredAt =
  | "initial"
  | "after_fix"
  | "after_typecheck"
  | "impact_1hop";

export type IssueSeverity = "blocker" | "major" | "minor";

export type IssueKind =
  | "api_rename"
  | "constructor_shape"
  | "phantom_symbol"
  | "async_contagion"
  | "missing_await"
  | "envelope_unwrap"
  | "multi_site_leftover"
  | "unit_scale"
  | "security"
  | "typecheck"
  | "caller_contract"
  | "other";

export type RubricDimension =
  | "compile"
  | "oracle"
  | "semantic"
  | "locality"
  | "cascade";

export type RubricScore = 0 | 1 | null; // null = not applicable

export type Citation = {
  id: string;
  kind:
    | "phantom"
    | "tsc"
    | "oracle"
    | "ast_span"
    | "report_field"
    | "impact"
    | "literature";
  detail: string;
  ref?: string;
};

export type IssueLocation = {
  fileName: string;
  startLine?: number;
  endLine?: number;
  startChar?: number;
  endChar?: number;
  start?: number;
  end?: number;
  text?: string;
  spanKind?: string;
};

export type RepairIssue = {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  location: IssueLocation;
  symptom: string;
  rootCauseHint: string;
  discoveredAt: IssueDiscoveredAt;
  causedByIssueId?: string;
};

export type RubricScores = Record<RubricDimension, RubricScore>;

export type IssueEval = {
  issueId: string;
  approach: ApproachKind;
  scores: RubricScores;
  citations: Citation[];
  pass: boolean;
  rationale: string;
};

export type RepairStep = {
  step: number;
  issueId: string;
  action: string;
  source?: "live" | "oracle_fallback" | "deterministic_ast" | "whole_file";
  newlyDiscoveredIssueIds: string[];
  notes?: string;
};

export type ImpactFinding = {
  id: string;
  fromIssueId: string;
  fileName: string;
  startLine?: number;
  targetSymbol: string;
  reason:
    | "missing_await"
    | "stale_binding"
    | "envelope_unwrap"
    | "same_api_leftover"
    | "caller_needs_async"
    | "caller_contract"
    | "other";
  detail: string;
};

export type ApproachReport = {
  approach: ApproachKind;
  scenarioId: string;
  generatedAt: string;
  issues: RepairIssue[];
  steps: RepairStep[];
  issueEvals: IssueEval[];
  impactFindings: ImpactFinding[];
  spans?: Array<{
    id: string;
    fileName: string;
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    kind: string;
    text: string;
  }>;
  summary: {
    issueCount: number;
    issuesPassed: number;
    issuesFailed: number;
    cascadeEdges: number;
    allIssuesPass: boolean;
    /** Aggregator — mean of applicable rubric scores across issues (0–1). */
    aggregatorMean: number | null;
    narrative: string;
    /** Issues discovered by 1° impact after a primary fix (professor blast-radius). */
    fixesDiscoveredAfterPrimary: number;
    /** Of those cascade issues, how many still FAIL (ceiling / incomplete). */
    fixesRemainingAfterPrimary: number;
    /** Of those cascade issues, how many PASS (completed follow-up fixes). */
    fixesCompletedAfterPrimary: number;
  };
  metricsGlossaryRefs: string[];
};

export const RUBRIC_GLOSSARY: Array<{
  id: RubricDimension;
  name: string;
  description: string;
  citation: string;
}> = [
  {
    id: "compile",
    name: "Compile / typecheck",
    description:
      "After addressing this issue, does the relevant code typecheck (tsc --noEmit)?",
    citation: "MorphAPI gate: typecheckPass (scenario success gate)",
  },
  {
    id: "oracle",
    name: "Oracle / phantoms",
    description:
      "No invented SDK symbols; Hallucination Inspector phantomCount for this issue is 0.",
    citation: "Scaffolding Hallucination Rate — inspector + oracle allow-list",
  },
  {
    id: "semantic",
    name: "Semantic / paradigm",
    description:
      "Scenario substance for this issue (behavioral, completeness, security, await coloring).",
    citation: "Handling of Semantic & Paradigm Shifts",
  },
  {
    id: "locality",
    name: "Diff locality",
    description:
      "1 if surgical AST/span apply; 0 if whole-file generative rewrite for this issue.",
    citation: "Formatting & Diff Aesthetics (reviewability)",
  },
  {
    id: "cascade",
    name: "Cascade detection",
    description:
      "1 if secondary issues surfaced by this fix were discovered and recorded; 0 if repair stopped after the primary without re-verify.",
    citation: "Professor feedback: fix A may create B — process quality",
  },
];

let _issueSeq = 0;

export function resetIssueSeq(n = 0) {
  _issueSeq = n;
}

export function nextIssueId(prefix = "iss"): string {
  _issueSeq += 1;
  return `${prefix}-${_issueSeq}`;
}

export function emptyRubric(
  overrides: Partial<RubricScores> = {}
): RubricScores {
  return {
    compile: null,
    oracle: null,
    semantic: null,
    locality: null,
    cascade: null,
    ...overrides,
  };
}

export function scoreIssuePass(scores: RubricScores): boolean {
  const vals = Object.values(scores).filter((v): v is 0 | 1 => v !== null);
  if (vals.length === 0) return false;
  return vals.every((v) => v === 1);
}

export function meanRubric(evals: IssueEval[]): number | null {
  const nums: number[] = [];
  for (const e of evals) {
    for (const v of Object.values(e.scores)) {
      if (v !== null) nums.push(v);
    }
  }
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

export function cascadeImpactCounts(
  issues: RepairIssue[],
  issueEvals: IssueEval[]
): {
  fixesDiscoveredAfterPrimary: number;
  fixesRemainingAfterPrimary: number;
  fixesCompletedAfterPrimary: number;
} {
  const cascaded = issues.filter(
    (i) =>
      i.discoveredAt === "impact_1hop" || Boolean(i.causedByIssueId)
  );
  const evalById = new Map(issueEvals.map((e) => [e.issueId, e]));
  let completed = 0;
  let remaining = 0;
  for (const iss of cascaded) {
    const ev = evalById.get(iss.id);
    if (ev?.pass) completed += 1;
    else remaining += 1;
  }
  return {
    fixesDiscoveredAfterPrimary: cascaded.length,
    fixesRemainingAfterPrimary: remaining,
    fixesCompletedAfterPrimary: completed,
  };
}

export function buildApproachReport(args: {
  approach: ApproachKind;
  scenarioId: string;
  issues: RepairIssue[];
  steps: RepairStep[];
  issueEvals: IssueEval[];
  impactFindings?: ImpactFinding[];
  spans?: ApproachReport["spans"];
  narrative: string;
  metricsGlossaryRefs?: string[];
}): ApproachReport {
  const passed = args.issueEvals.filter((e) => e.pass).length;
  const failed = args.issueEvals.length - passed;
  const cascadeEdges = args.issues.filter((i) => i.causedByIssueId).length;
  const impact = cascadeImpactCounts(args.issues, args.issueEvals);
  return {
    approach: args.approach,
    scenarioId: args.scenarioId,
    generatedAt: new Date().toISOString(),
    issues: args.issues,
    steps: args.steps,
    issueEvals: args.issueEvals,
    impactFindings: args.impactFindings ?? [],
    spans: args.spans,
    summary: {
      issueCount: args.issues.length,
      issuesPassed: passed,
      issuesFailed: failed,
      cascadeEdges,
      allIssuesPass: args.issueEvals.length > 0 && failed === 0,
      aggregatorMean: meanRubric(args.issueEvals),
      narrative: args.narrative,
      ...impact,
    },
    metricsGlossaryRefs: args.metricsGlossaryRefs ?? [
      "automationCeiling",
      "hallucination",
      "semantics",
      "formatting",
    ],
  };
}

export function spanToLocation(
  span: {
    fileName: string;
    start: number;
    end: number;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    text: string;
    kind: string;
  }
): IssueLocation {
  return {
    fileName: span.fileName,
    start: span.start,
    end: span.end,
    startLine: span.startLine,
    startChar: span.startChar,
    endLine: span.endLine,
    endChar: span.endChar,
    text: span.text,
    spanKind: span.kind,
  };
}

export function usageSpansToReportSpans(
  spans: Array<{
    fileName: string;
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    text: string;
    kind: string;
  }>,
  idPrefix = "span"
) {
  return spans.map((s, i) => ({
    id: `${idPrefix}-${i + 1}`,
    fileName: s.fileName,
    startLine: s.startLine,
    endLine: s.endLine,
    startChar: s.startChar,
    endChar: s.endChar,
    kind: s.kind,
    text: s.text,
  }));
}

/** Write repair-report.json next to report.json */
export function writeRepairReportJson(
  outPath: string,
  report: ApproachReport,
  writeUtf8: (path: string, content: string) => void
) {
  writeUtf8(outPath, JSON.stringify(report, null, 2) + "\n");
}
