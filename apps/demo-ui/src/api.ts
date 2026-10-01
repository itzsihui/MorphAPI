import type { ImpactFindingLite } from "./CascadeTimeline";

export type Phantom = {
  symbol: string;
  tier: string;
  reason: string;
};

export type AttemptLog = {
  span?: string;
  attempt?: number;
  source?: "live" | "oracle_fallback" | string;
  phantomCount?: number;
  phantoms?: Phantom[];
  file?: string;
};

export type ReportSpan = {
  id?: string;
  fileName?: string;
  startLine: number;
  endLine: number;
  startChar?: number;
  endChar?: number;
  kind?: string;
  text?: string;
};

export type RepairReportDto = {
  approach?: string;
  scenarioId?: string;
  issues?: Array<{
    id: string;
    kind: string;
    discoveredAt: string;
    causedByIssueId?: string | null;
    symptom: string;
  }>;
  steps?: Array<{
    step: number;
    issueId: string;
    action: string;
    source?: string;
    newlyDiscoveredIssueIds?: string[];
    notes?: string;
  }>;
  issueEvals?: Array<{
    issueId: string;
    pass: boolean;
    scores: Record<string, number | null>;
    rationale: string;
  }>;
  impactFindings?: ImpactFindingLite[];
  spans?: ReportSpan[];
  summary?: {
    issueCount: number;
    issuesPassed: number;
    issuesFailed: number;
    cascadeEdges: number;
    allIssuesPass: boolean;
    aggregatorMean: number | null;
    narrative: string;
    fixesDiscoveredAfterPrimary?: number;
    fixesRemainingAfterPrimary?: number;
    fixesCompletedAfterPrimary?: number;
  };
};

export type Report = {
  baseline?: string;
  mode?: string;
  model?: string | null;
  typecheckPass?: boolean;
  phantomCount?: number;
  phantoms?: Phantom[];
  spansFound?: number;
  spans?: ReportSpan[];
  repairReport?: RepairReportDto;
  usedOracleFallback?: boolean;
  evasionCount?: number;
  behavioralPass?: boolean;
  scaledCount?: number;
  unscaledCount?: number;
  unwrappedCount?: number;
  wrappedBlindCount?: number;
  leftoverLegacyCatch?: boolean;
  leftoverCharges?: boolean;
  amountSites?: Array<{
    startLine: number;
    amountExpr: string;
    scaled: boolean;
    reason: string;
  }>;
  envelopeSites?: Array<{
    startLine: number;
    binding: string | null;
    expr: string;
    unwrapped: boolean;
    reason: string;
  }>;
  completenessPass?: boolean;
  leftoverCount?: number;
  migratedCount?: number;
  expectedSites?: number;
  securityPass?: boolean;
  staticTokenCount?: number;
  unsafeCompareCount?: number;
  discriminatorSites?: Array<{
    startLine: number;
    kind: string;
    detail: string;
    ok: boolean;
    reason: string;
  }>;
  failCount?: number;
  passCount?: number;
  attempts?: AttemptLog[];
  contrastPhantomCount?: number;
  contrastEvasionCount?: number;
  contrastBehavioralPass?: boolean;
  contrastTypecheck?: boolean;
};

export type Scenario =
  | "morphpay"
  | "plaid"
  | "openai"
  | "stripe"
  | "stripe-errors"
  | "auth"
  | "envelope"
  | "async"
  | "mail"
  | "hmac"
  | "discriminator";

export type ResultsPayload = {
  scenario: Scenario;
  before: string | null;
  without: { label: string; code: string | null; report: Report | null };
  /** Live Pure AST arm when present (Scenario 7 mail). */
  ast?: { label: string; code: string | null; report: Report | null };
  with: { label: string; code: string | null; report: Report | null };
  docs: string | null;
  docsV1: string | null;
  docsV2: string | null;
  hasApiKey: boolean;
};

export type UsageSpanDto = {
  fileName: string;
  start: number;
  end: number;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
  kind: string;
};

export type FinderExplain = {
  key: string;
  fnName: string;
  sourcePath: string;
  rule: string;
  pseudocode: string;
};

export type SpansPayload = {
  scenario: Scenario;
  engine: string;
  spanFinders: string[];
  finders?: FinderExplain[];
  files: Array<{
    path: string;
    name: string;
    source: string;
    spans: UsageSpanDto[];
  }>;
  spanCount: number;
};

export type OraclePayload = {
  scenario: Scenario;
  path: string;
  schemaDelta: string;
  astAloneReason: string;
  gateFields: string[];
  oracle: {
    api?: string;
    version?: string;
    description?: string;
    classes?: string[];
    enums?: string[];
    enumMembers?: Record<string, string[]>;
    methods?: Record<string, string[]>;
    staticMembers?: Record<string, string[]>;
    functions?: string[];
    allowedImports?: string[];
    allowedSymbols?: string[];
    knownPhantoms?: string[];
    transforms?: unknown[];
    discriminator?: unknown[];
  };
};

export type PipelineEvent = {
  t: string;
  type: string;
  scenario?: string;
  message?: string;
  [key: string]: unknown;
};

export async function fetchResults(
  scenario: Scenario
): Promise<ResultsPayload> {
  const res = await fetch(
    `/api/results?scenario=${encodeURIComponent(scenario)}`
  );
  if (!res.ok) throw new Error("Failed to load results");
  return res.json();
}

export async function fetchOracle(scenario: Scenario): Promise<OraclePayload> {
  const res = await fetch(
    `/api/oracle?scenario=${encodeURIComponent(scenario)}`
  );
  if (!res.ok) throw new Error("Failed to load oracle");
  return res.json();
}

export async function fetchSpans(scenario: Scenario): Promise<SpansPayload> {
  const res = await fetch(
    `/api/spans?scenario=${encodeURIComponent(scenario)}`
  );
  if (!res.ok) throw new Error("Failed to load spans");
  return res.json();
}

export async function runDemo(scenario: Scenario): Promise<{
  ok: boolean;
  error?: string;
  results: ResultsPayload;
}> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  const data = await res.json();
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || "Run failed",
      results: data.results,
    };
  }
  return { ok: true, results: data.results };
}

/** Live SSE pipeline; resolves when stream ends with results or error. */
export function runDemoStream(
  scenario: Scenario,
  onEvent: (evt: PipelineEvent) => void
): Promise<{ ok: boolean; error?: string; results?: ResultsPayload }> {
  return new Promise((resolve) => {
    const es = new EventSource(
      `/api/run/stream?scenario=${encodeURIComponent(scenario)}`
    );
    let settled = false;

    const finish = (payload: {
      ok: boolean;
      error?: string;
      results?: ResultsPayload;
    }) => {
      if (settled) return;
      settled = true;
      es.close();
      resolve(payload);
    };

    const handle = (type: string, e: MessageEvent) => {
      let data: PipelineEvent;
      try {
        data = JSON.parse(e.data);
      } catch {
        data = { t: new Date().toISOString(), type, message: e.data };
      }
      onEvent({ ...data, type: data.type || type });

      if (type === "results" || data.type === "results") {
        finish({
          ok: true,
          results: (data as { results?: ResultsPayload }).results,
        });
      }
      if (type === "error" || data.type === "error") {
        finish({
          ok: false,
          error: data.message || "Run failed",
          results: (data as { results?: ResultsPayload }).results,
        });
      }
    };

    const types = [
      "start",
      "ast_scan",
      "ast_scan_error",
      "llm_only_start",
      "llm_only_done",
      "ast_start",
      "ast_alone_done",
      "hybrid_start",
      "inspect_reject",
      "inspect_accept",
      "typecheck",
      "done",
      "results",
      "error",
    ];
    for (const t of types) {
      es.addEventListener(t, (e) => handle(t, e as MessageEvent));
    }
    es.onerror = () => {
      if (!settled) {
        finish({ ok: false, error: "Stream closed unexpectedly" });
      }
    };
  });
}
