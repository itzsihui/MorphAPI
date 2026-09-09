export type Phantom = {
  symbol: string;
  tier: string;
  reason: string;
};

export type Report = {
  baseline?: string;
  mode?: string;
  model?: string | null;
  typecheckPass?: boolean;
  phantomCount?: number;
  phantoms?: Phantom[];
  spansFound?: number;
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
  with: { label: string; code: string | null; report: Report | null };
  docs: string | null;
  docsV1: string | null;
  docsV2: string | null;
  hasApiKey: boolean;
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
