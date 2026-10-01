export type DataFlowRole = "param" | "def" | "assign" | "use";

export type CpgNodeKind = "function" | "variable" | "call_site" | "api_symbol";

export type CpgEdgeKind =
  | "comesFrom"
  | "computedFrom"
  | "argument_of"
  | "contains"
  | "resolves_to"
  | "calls"
  | "migrates_to";

export type CallArgFact = {
  index: number;
  text: string;
  type: string;
  param: string | null;
  paramType: string | null;
};

export type CpgNode = {
  id: string;
  kind: CpgNodeKind;
  label: string;
  fileName?: string;
  line?: number;
  start?: number;
  end?: number;
  async?: boolean;
  returnType?: string;
  params?: string[];
  role?: DataFlowRole;
  type?: string;
  functionId?: string;
  text?: string;
  spanKind?: string;
  signature?: string | null;
  deprecated?: boolean;
  deprecatedReason?: "jsdoc" | "scenario_meta" | "finder_match" | null;
  args?: CallArgFact[];
  module?: string | null;
  symbolRole?: "deprecated" | "successor";
  resolved?: boolean;
  declFile?: string | null;
};

export type CpgEdge = { from: string; to: string; kind: CpgEdgeKind; label?: string };

export type AstOutlineNode = {
  id: string;
  kind: string;
  label: string;
  start: number;
  end: number;
  dfgId?: string;
  type?: string;
  inSpan?: boolean;
  collapsed?: boolean;
  children: AstOutlineNode[];
};

export type DfgNode = {
  id: string;
  name: string;
  role: DataFlowRole;
  start: number;
  end: number;
  line: number;
  type: string;
};

export type DfgEdge = { from: string; to: string; kind: "comesFrom" | "computedFrom" };

export type SliceFacts = {
  target_call: string;
  slice: { file: string; bytes: [number, number]; lines: [number, number] };
  resolved_api: {
    symbol: string;
    module: string | null;
    signature: string | null;
    deprecated: boolean;
    deprecated_reason: string | null;
  } | null;
  successor_api: Array<{ symbol: string; module: string | null; signature: string | null }>;
  arguments: Array<CallArgFact & { origin: string | null }>;
  data_flow: Array<{ variable: string; declared_type: string; origin: string; downstream_usages: string[] }>;
  result: { binding: string | null; type: string | null; downstream_usages: string[] };
  enclosing_function: { name: string; async: boolean; return_type: string; params: string[] } | null;
  callers_1hop: string[];
};

export type GraphPayload = {
  scenario: string;
  label: string;
  number: string;
  projectSource: "meta" | "walk";
  engine: "typescript-program";
  tsconfig: string;
  spanFinders: string[];
  spans: Array<{ fileName: string; start: number; startLine: number; kind: string }>;
  files: Array<{ name: string; path: string; source: string }>;
  nodes: CpgNode[];
  edges: CpgEdge[];
  focus: {
    callSiteId: string;
    functionId: string | null;
    fileName: string;
    code: string;
    codeStartLine: number;
    span: { start: number; end: number };
    ast: AstOutlineNode | null;
    dfg: { nodes: DfgNode[]; edges: DfgEdge[] };
  } | null;
  sliceFacts: SliceFacts | null;
  tokens: { file: number; slice: number; facts: number };
  health: {
    anyCollapseRate: number;
    checked: number;
    collapsed: string[];
    explicitAny: string[];
    missingFiles: string[];
    configErrors: string[];
  };
};

export async function fetchGraph(
  scenario: string,
  focus?: { file: string; start: number } | null
): Promise<GraphPayload> {
  const q = new URLSearchParams({ scenario });
  if (focus) {
    q.set("file", focus.file);
    q.set("start", String(focus.start));
  }
  const r = await fetch(`/api/graph?${q}`);
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body as GraphPayload;
}
