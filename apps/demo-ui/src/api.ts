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
};

export type ResultsPayload = {
  before: string | null;
  without: { label: string; code: string | null; report: Report | null };
  with: { label: string; code: string | null; report: Report | null };
  docs: string | null;
  hasApiKey: boolean;
};

export async function fetchResults(): Promise<ResultsPayload> {
  const res = await fetch("/api/results");
  if (!res.ok) throw new Error("Failed to load results");
  return res.json();
}

export async function runDemo(): Promise<{
  ok: boolean;
  error?: string;
  results: ResultsPayload;
}> {
  const res = await fetch("/api/run", { method: "POST" });
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
