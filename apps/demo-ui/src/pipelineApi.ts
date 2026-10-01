import type { SliceFacts } from "./graphApi";

export type PipelineArm = "arm1_morphapi" | "arm0_llm_only" | "ablA_no_slices" | "ablB_no_oracle" | "ablC_no_impact";
export type PipelineModel = "mini" | "frontier";

export const ARM_LABELS: Record<PipelineArm, string> = {
  arm1_morphapi: "MorphAPI (all mechanisms)",
  arm0_llm_only: "LLM-only (whole file)",
  ablA_no_slices: "Ablation: file context instead of slice",
  ablB_no_oracle: "Ablation: no oracle gate / feedback",
  ablC_no_impact: "Ablation: no impact repair",
};

export type GateFinding = {
  kind: "phantom" | "type_error" | "dynamic_access" | "parse" | "evasion" | "leftover";
  symbol?: string;
  line?: number;
  code?: number;
  message: string;
  suggestions?: string[];
  receiverOwners?: string[];
};

export type AttemptRecord = {
  attempt: number;
  candidate: string;
  ok: boolean;
  findings: GateFinding[];
  warnings: GateFinding[];
  sliceKind?: "expression" | "statement";
  escalated?: boolean;
};

export type ImpactFinding = {
  reason: "same_api_leftover" | "missing_await" | "stale_import" | "new_type_error" | "deprecated_module_use";
  file: string;
  line: number;
  symbol?: string;
  detail: string;
};

export type SpanStep = {
  file: string;
  line: number;
  text: string;
  slice: { kind: "expression" | "statement"; startLine: number; text: string };
  escalated: boolean;
  prompt: string;
  facts: SliceFacts | null;
  attempts: AttemptRecord[];
  accepted: string | null;
  imports: string[];
  dataflow: { mode: string; wrapperPath: string | null; rewrites: unknown[] } | null;
};

export type MigrationRunDto = {
  scenario: string;
  label: string;
  arm: PipelineArm;
  model: string;
  deprecatedSpec: string;
  successorModule: string;
  oracle: { exports: number; allowed: number } | null;
  steps: SpanStep[];
  impact: { oneHopFiles: string[]; findings: ImpactFinding[]; changedFunctions: Array<{ name: string; before: string; after: string }> } | null;
  impactFixes: Array<{ reason: string; file: string; line: number; before: string; after: string | null; attempts: number }>;
  final: {
    leftovers: number;
    deprecatedModuleUses: number;
    newDiagnostics: Array<{ file: string; line: number; message: string }>;
    phantomDiagnostics: number;
    complete: boolean;
  };
  metrics: {
    spansFound: number;
    spansMigrated: number;
    attempts: number;
    phantomRejections: number;
    escalations: number;
    dynamicAccessWarnings: number;
    changedLines: number;
    linesOutsideSpans: number;
    importLinesChanged: number;
    churnRatio: number;
    promptTokens: number;
    completionTokens: number;
  };
  patches: Record<string, { before: string; after: string }>;
  ms: number;
};

export type PipelineEvent = { type: string; [k: string]: unknown };

const query = (scenario: string, arm: PipelineArm, model: PipelineModel) => new URLSearchParams({ scenario, arm, model });

export async function fetchLastRun(scenario: string, arm: PipelineArm, model: PipelineModel): Promise<MigrationRunDto | null> {
  const r = await fetch(`/api/pipeline/last?${query(scenario, arm, model)}`);
  if (r.status === 404) return null;
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as MigrationRunDto;
}

/** Live run over SSE. Returns a cancel function. */
export function streamRun(
  scenario: string,
  arm: PipelineArm,
  model: PipelineModel,
  handlers: { onStep: (e: PipelineEvent) => void; onRun: (r: MigrationRunDto) => void; onError: (msg: string) => void }
): () => void {
  const es = new EventSource(`/api/pipeline/stream?${query(scenario, arm, model)}`);
  let done = false;
  es.addEventListener("step", (e) => handlers.onStep(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("run", (e) => {
    done = true;
    handlers.onRun(JSON.parse((e as MessageEvent).data));
    es.close();
  });
  es.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    if (data) handlers.onError(JSON.parse(data).message);
    else if (!done) handlers.onError("Connection closed (another run in progress, or the server stopped).");
    done = true;
    es.close();
  });
  return () => es.close();
}
