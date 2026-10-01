/**
 * Mechanism 1 — decorated slices. The LLM sees one call site (or its
 * enclosing statement) plus TypeChecker facts, never the whole file.
 */
import * as path from "path";
import * as ts from "typescript";
import type { UsageSpan } from "./astScan";
import { buildCodePropertyGraph, type SliceFacts } from "./codePropertyGraph";
import type { LlmMessage } from "./llm";
import type { ProjectSession } from "./program";

export type SliceKind = "expression" | "statement";

export type SuccessorKind = "call" | "builder" | "constructor_then_call" | "multi_step";

export type Slice = {
  file: string;
  start: number;
  end: number;
  text: string;
  kind: SliceKind;
  startLine: number;
};

const STATEMENT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

function innermost(sf: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

/** Successor shapes that cannot be written as a drop-in expression. */
export function needsStatementSlice(kind: SuccessorKind | undefined): boolean {
  return kind === "builder" || kind === "constructor_then_call" || kind === "multi_step";
}

/**
 * Expression slice = the call plus its member/call chain (`.id`, `.promise()`).
 * Statement slice = the nearest enclosing statement, never further.
 */
export function sliceFor(
  sf: ts.SourceFile,
  span: { start: number; end: number },
  kind: SliceKind
): Slice {
  let node = innermost(sf, span.start, span.end) ?? sf;
  while (ts.isParenthesizedExpression(node.parent ?? sf) && node.parent) node = node.parent;
  if (kind === "expression") {
    for (;;) {
      const p = node.parent;
      if (!p) break;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) node = p;
      else if (ts.isCallExpression(p) && p.expression === node) node = p;
      else if (ts.isNonNullExpression(p)) node = p;
      else break;
    }
  } else {
    let cur: ts.Node | undefined = node;
    while (cur && !STATEMENT_KINDS.has(cur.kind)) cur = cur.parent;
    if (cur) node = cur;
  }
  const start = node.getStart(sf);
  return {
    file: sf.fileName,
    start,
    end: node.getEnd(),
    text: sf.text.slice(start, node.getEnd()),
    kind,
    startLine: sf.getLineAndCharacterOfPosition(start).line + 1,
  };
}

function parseErrors(sf: ts.SourceFile): number {
  return ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;
}

/** True if `code` parses as exactly one expression / as statements. */
export function parsesAs(code: string, kind: SliceKind): boolean {
  const body = code.trim().replace(/;$/, "");
  if (!body) return false;
  if (kind === "expression") {
    const sf = ts.createSourceFile("__slice.ts", `const __x = (\n${body}\n);`, ts.ScriptTarget.Latest, true);
    if (parseErrors(sf) || sf.statements.length !== 1) return false;
    const st = sf.statements[0];
    return ts.isVariableStatement(st) && st.declarationList.declarations.length === 1;
  }
  const sf = ts.createSourceFile("__slice.ts", code, ts.ScriptTarget.Latest, true);
  return parseErrors(sf) === 0 && sf.statements.length > 0;
}

export type SliceFactsResult = {
  facts: SliceFacts | null;
  tokens: { file: number; slice: number; facts: number };
};

/** Slice facts for one span, computed on the session's current (patched) program. */
export function sliceFactsFor(
  session: ProjectSession,
  input: {
    repoRoot: string;
    files: string[];
    span: { file: string; start: number; end: number; text?: string; startLine?: number };
    deprecatedSymbols: string[];
    successorModule?: string | null;
    successorSymbols: string[];
  }
): SliceFactsResult {
  const sf = session.sourceFile(input.span.file);
  const base = path.basename(input.span.file);
  const s = sf?.getLineAndCharacterOfPosition(input.span.start);
  const e = sf?.getLineAndCharacterOfPosition(input.span.end);
  const usage = {
    fileName: base,
    start: input.span.start,
    end: input.span.end,
    startLine: (s?.line ?? 0) + 1,
    startChar: s?.character ?? 0,
    endLine: (e?.line ?? 0) + 1,
    endChar: e?.character ?? 0,
    text: input.span.text ?? sf?.text.slice(input.span.start, input.span.end) ?? "",
    kind: "call",
  } as unknown as UsageSpan;
  const graph = buildCodePropertyGraph({
    tsconfigPath: session.configPath,
    repoRoot: input.repoRoot,
    files: input.files,
    spans: [usage],
    deprecatedSymbols: input.deprecatedSymbols,
    successorModule: input.successorModule ?? null,
    successorSymbols: input.successorSymbols,
    focus: { fileName: base, start: input.span.start },
    session,
  });
  return { facts: graph.sliceFacts, tokens: graph.tokens };
}

export type SlicePromptInput = {
  slice: Slice;
  facts: SliceFacts | null;
  /** Successor API surface: symbol → signature */
  successorApi: Array<{ symbol: string; signature: string | null }>;
  deprecatedSpec: string;
  successorModule: string;
  rules?: string[];
  guide?: string;
  feedback?: string;
};

/** The MorphAPI prompt: slice + facts + allowed API. No whole-file context. */
export function buildSlicePrompt(input: SlicePromptInput): LlmMessage[] {
  const { slice } = input;
  const boundary =
    slice.kind === "expression"
      ? "Output ONLY one TypeScript expression that replaces the slice. No statements, no imports, no prose."
      : "Output ONLY TypeScript statement(s) that replace the slice. Keep any variable the slice declared. No imports, no prose.";
  const api = input.successorApi.map((a) => `- ${a.symbol}${a.signature ? `: ${a.signature}` : ""}`).join("\n");
  return [
    {
      role: "system",
      content: [
        "You migrate one call site from a deprecated API to its successor.",
        boundary,
        "Use only symbols listed under 'Successor API' or already in scope (see facts). Imports are added for you.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `## Migration\n${input.deprecatedSpec} → ${input.successorModule}`,
        `## Successor API\n${api || "- (none extracted)"}`,
        `## Slice (${slice.kind}, line ${slice.startLine})\n\`\`\`ts\n${slice.text}\n\`\`\``,
        `## Facts (TypeScript checker)\n\`\`\`json\n${JSON.stringify(input.facts, null, 2)}\n\`\`\``,
        input.rules?.length ? `## Rules\n${input.rules.map((r) => `- ${r}`).join("\n")}` : "",
        input.guide ? `## Migration guide (prose; the Successor API list wins on conflicts)\n${input.guide}` : "",
        input.feedback ? `## Previous attempt rejected\n${input.feedback}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}
