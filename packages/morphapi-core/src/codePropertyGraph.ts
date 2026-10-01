/**
 * Code Property Graph — an AST decorated with resolved types, data flow,
 * call edges and API migration edges, built from a real ts.Program.
 *
 * Node kinds: function · variable · call_site · api_symbol
 * Edge kinds: comesFrom · computedFrom · argument_of · contains ·
 *             resolves_to · calls · migrates_to
 *
 * The same graph produces `sliceFacts`: the JSON the hybrid prompt receives
 * for one call site instead of the whole file.
 */
import * as path from "path";
import * as ts from "typescript";
import type { UsageSpan } from "./astScan";
import {
  loadProgram,
  packageNameOf,
  resolveAlias,
  resolveModuleFile,
  type LoadedProgram,
  type ProjectSession,
} from "./program";

export type DataFlowRole = "param" | "def" | "assign" | "use";

export type CpgNodeKind = "function" | "variable" | "call_site" | "api_symbol";

export type DeprecatedReason = "jsdoc" | "scenario_meta" | "finder_match";

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
  /** function */
  async?: boolean;
  returnType?: string;
  params?: string[];
  /** variable */
  role?: DataFlowRole;
  type?: string;
  functionId?: string;
  /** call_site */
  text?: string;
  spanKind?: string;
  signature?: string | null;
  deprecated?: boolean;
  deprecatedReason?: DeprecatedReason | null;
  args?: CallArgFact[];
  /** api_symbol */
  module?: string | null;
  symbolRole?: "deprecated" | "successor";
  resolved?: boolean;
  declFile?: string | null;
};

export type CpgEdgeKind =
  | "comesFrom"
  | "computedFrom"
  | "argument_of"
  | "contains"
  | "resolves_to"
  | "calls"
  | "migrates_to";

export type CpgEdge = {
  from: string;
  to: string;
  kind: CpgEdgeKind;
  label?: string;
};

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

export type FocusDfgNode = {
  id: string;
  name: string;
  role: DataFlowRole;
  start: number;
  end: number;
  line: number;
  type: string;
};

export type SliceFacts = {
  target_call: string;
  slice: { file: string; bytes: [number, number]; lines: [number, number] };
  resolved_api: {
    symbol: string;
    module: string | null;
    signature: string | null;
    deprecated: boolean;
    deprecated_reason: DeprecatedReason | null;
  } | null;
  successor_api: Array<{ symbol: string; module: string | null; signature: string | null }>;
  arguments: Array<CallArgFact & { origin: string | null }>;
  data_flow: Array<{
    variable: string;
    declared_type: string;
    origin: string;
    downstream_usages: string[];
  }>;
  result: { binding: string | null; type: string | null; downstream_usages: string[] };
  enclosing_function: {
    name: string;
    async: boolean;
    return_type: string;
    params: string[];
  } | null;
  callers_1hop: string[];
};

export type CodePropertyGraph = {
  engine: "typescript-program";
  tsconfig: string;
  nodes: CpgNode[];
  edges: CpgEdge[];
  focus: {
    callSiteId: string;
    functionId: string | null;
    fileName: string;
    code: string;
    codeStartLine: number;
    /** span offsets relative to `code` */
    span: { start: number; end: number };
    ast: AstOutlineNode | null;
    dfg: { nodes: FocusDfgNode[]; edges: Array<{ from: string; to: string; kind: "comesFrom" | "computedFrom" }> };
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

export type BuildCpgInput = {
  tsconfigPath: string;
  repoRoot: string;
  /** Absolute fixture file paths */
  files: string[];
  /** Scenario finder spans (fileName = basename) */
  spans: UsageSpan[];
  deprecatedSymbols: string[];
  /** Export names in `successorModule`; `Type.member` selects a member */
  successorSymbols: string[];
  successorModule?: string | null;
  focus?: { fileName: string; start: number } | null;
  /** Reuse an open session (patched contents included) instead of loading tsconfigPath. */
  session?: ProjectSession;
};

const MAX_TYPE = 64;

function short(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function countTokens(text: string): number {
  return (text.match(/[A-Za-z_$][\w$]*|\d+|\S/g) ?? []).length;
}

type FnLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

type DfgOcc = {
  id: string;
  name: string;
  role: DataFlowRole;
  ident: ts.Identifier;
  start: number;
  end: number;
  line: number;
  type: string;
};

let kindNames: Map<number, string> | null = null;
function kindName(kind: ts.SyntaxKind): string {
  if (!kindNames) {
    kindNames = new Map();
    for (const key of Object.keys(ts.SyntaxKind)) {
      if (!Number.isNaN(Number(key))) continue;
      if (/^(First|Last)/.test(key)) continue;
      const v = (ts.SyntaxKind as unknown as Record<string, number>)[key];
      if (!kindNames.has(v)) kindNames.set(v, key);
    }
  }
  return kindNames.get(kind) ?? String(kind);
}

function bindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const out: ts.Identifier[] = [];
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    out.push(...bindingIdentifiers(el.name));
  }
  return out;
}

function isReferencePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isPropertySignature(p) || ts.isMethodSignature(p)) return false;
  if (ts.isLabeledStatement(p)) return false;
  return true;
}

function calleeIdentifier(call: ts.CallExpression): ts.Identifier | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name;
  return null;
}

function hasExplicitAnnotation(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isVariableDeclaration(p) || ts.isParameter(p)) return Boolean(p.type);
  return false;
}

export function buildCodePropertyGraph(input: BuildCpgInput): CodePropertyGraph {
  const rel = (f: string) => path.relative(input.repoRoot, f).split(path.sep).join("/");

  let loaded: LoadedProgram = input.session?.asLoaded() ?? loadProgram(input.tsconfigPath);
  let successorFile: string | null = null;
  if (input.successorModule && input.files[0]) {
    successorFile = resolveModuleFile(
      input.successorModule,
      path.resolve(input.files[0]),
      loaded.options
    );
    if (successorFile && !loaded.program.getSourceFile(successorFile)) {
      if (input.session) {
        input.session.addRootFiles([successorFile]);
        loaded = input.session.asLoaded();
      } else {
        loaded = loadProgram(input.tsconfigPath, { extraRootFiles: [successorFile] });
      }
    }
  }
  const { program, checker } = loaded;
  const typeStr = (t: ts.Type) => short(checker.typeToString(t), MAX_TYPE);
  const typeAt = (n: ts.Node) => {
    try {
      return typeStr(checker.getTypeAtLocation(n));
    } catch {
      return "unknown";
    }
  };

  const nodes: CpgNode[] = [];
  const nodeById = new Map<string, CpgNode>();
  const edges: CpgEdge[] = [];
  const edgeKeys = new Set<string>();
  const addNode = (n: CpgNode) => {
    if (nodeById.has(n.id)) return nodeById.get(n.id) as CpgNode;
    nodes.push(n);
    nodeById.set(n.id, n);
    return n;
  };
  const addEdge = (e: CpgEdge) => {
    const k = `${e.kind}|${e.from}|${e.to}`;
    if (edgeKeys.has(k) || e.from === e.to) return;
    edgeKeys.add(k);
    edges.push(e);
  };

  const health = {
    checked: 0,
    collapsed: [] as string[],
    explicitAny: [] as string[],
    missingFiles: [] as string[],
  };

  // ── Source files ────────────────────────────────────────────────────────
  const sfs: ts.SourceFile[] = [];
  for (const f of input.files) {
    const sf = program.getSourceFile(path.resolve(f));
    if (sf) sfs.push(sf);
    else health.missingFiles.push(rel(f));
  }
  const baseOf = (sf: ts.SourceFile) => path.basename(sf.fileName);
  const lineOf = (sf: ts.SourceFile, pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;

  // ── Functions ───────────────────────────────────────────────────────────
  const fnIdByNode = new Map<ts.Node, string>();
  const fnNodeById = new Map<string, { node: FnLike; sf: ts.SourceFile; name: string }>();

  for (const sf of sfs) {
    const register = (name: string, fn: FnLike, anchor: ts.Node) => {
      const start = anchor.getStart(sf);
      const id = `fn:${baseOf(sf)}#${name}`;
      let returnType = "void";
      try {
        const sig = checker.getSignatureFromDeclaration(fn);
        if (sig) returnType = typeStr(checker.getReturnTypeOfSignature(sig));
      } catch {
        /* keep default */
      }
      const isAsync =
        Boolean(fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) ||
        returnType.startsWith("Promise<");
      addNode({
        id,
        kind: "function",
        label: `${name}()`,
        fileName: baseOf(sf),
        line: lineOf(sf, start),
        start,
        end: anchor.getEnd(),
        async: isAsync,
        returnType,
        params: fn.parameters.map(
          (p) => `${p.name.getText(sf)}: ${typeAt(p.name)}`
        ),
      });
      fnIdByNode.set(fn, id);
      fnNodeById.set(id, { node: fn, sf, name });
    };
    const visit = (node: ts.Node) => {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        node.body
      ) {
        register(node.name.text, node, node);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        register(node.name.text, node.initializer, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const enclosingFnId = (n: ts.Node): string | null => {
    let cur: ts.Node | undefined = n.parent;
    while (cur) {
      const id = fnIdByNode.get(cur);
      if (id) return id;
      cur = cur.parent;
    }
    return null;
  };

  // ── Typed data flow per function ────────────────────────────────────────
  const occByStart = new Map<string, DfgOcc>();
  const dfgByFn = new Map<string, { occ: DfgOcc[]; edges: Array<{ from: string; to: string; kind: "comesFrom" | "computedFrom" }> }>();

  for (const [fnId, { node: fn, sf }] of fnNodeById) {
    const occ: DfgOcc[] = [];
    const fEdges: Array<{ from: string; to: string; kind: "comesFrom" | "computedFrom" }> = [];
    const lastDef = new Map<string, string>();

    const mk = (id: ts.Identifier, role: DataFlowRole): DfgOcc => {
      const start = id.getStart(sf);
      const o: DfgOcc = {
        id: `v:${baseOf(sf)}:${start}`,
        name: id.text,
        role,
        ident: id,
        start,
        end: id.getEnd(),
        line: lineOf(sf, start),
        type: typeAt(id),
      };
      occ.push(o);
      occByStart.set(`${baseOf(sf)}:${start}`, o);
      if (role !== "use") {
        health.checked += 1;
        if (o.type === "any") {
          const tag = `${baseOf(sf)}:${o.line} ${o.name}`;
          if (hasExplicitAnnotation(id)) health.explicitAny.push(tag);
          else health.collapsed.push(tag);
        }
      }
      return o;
    };
    const define = (id: ts.Identifier, role: DataFlowRole, operands: string[]) => {
      const d = mk(id, role);
      lastDef.set(id.text, d.id);
      for (const u of operands) fEdges.push({ from: u, to: d.id, kind: "computedFrom" });
    };
    const walk = (node: ts.Node, sink: string[]): void => {
      if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
      if (node !== fn && fnIdByNode.has(node)) return; // nested function: own graph
      if (ts.isParameter(node)) {
        const uses: string[] = [];
        if (node.initializer) walk(node.initializer, uses);
        for (const id of bindingIdentifiers(node.name)) define(id, "param", uses);
        return;
      }
      if (ts.isVariableDeclaration(node)) {
        const uses: string[] = [];
        if (node.initializer) walk(node.initializer, uses);
        for (const id of bindingIdentifiers(node.name)) define(id, "def", uses);
        return;
      }
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const uses: string[] = [];
        walk(node.expression, uses);
        const init = node.initializer;
        if (ts.isVariableDeclarationList(init)) {
          for (const d of init.declarations) {
            for (const id of bindingIdentifiers(d.name)) define(id, "def", uses);
          }
        } else if (ts.isIdentifier(init)) {
          define(init, "assign", uses);
        }
        walk(node.statement, sink);
        return;
      }
      if (
        ts.isBinaryExpression(node) &&
        ts.isIdentifier(node.left) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const uses: string[] = [];
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) walk(node.left, uses);
        walk(node.right, uses);
        define(node.left, "assign", uses);
        return;
      }
      if (ts.isIdentifier(node)) {
        if (isReferencePosition(node) && lastDef.has(node.text)) {
          const u = mk(node, "use");
          fEdges.push({ from: lastDef.get(node.text) as string, to: u.id, kind: "comesFrom" });
          sink.push(u.id);
        }
        return;
      }
      ts.forEachChild(node, (c) => walk(c, sink));
    };
    for (const p of fn.parameters) walk(p, []);
    if (fn.body) walk(fn.body, []);
    dfgByFn.set(fnId, { occ, edges: fEdges });
  }

  // ── Calls between fixture functions (1 hop) ─────────────────────────────
  const callersOf = new Map<string, Array<{ callerId: string; line: number; awaited: boolean; file: string }>>();
  const fnIdOfDecl = (decl: ts.Declaration | undefined): string | null => {
    if (!decl) return null;
    if (fnIdByNode.has(decl)) return fnIdByNode.get(decl) as string;
    if (ts.isVariableDeclaration(decl) && decl.initializer && fnIdByNode.has(decl.initializer)) {
      return fnIdByNode.get(decl.initializer) as string;
    }
    return null;
  };
  for (const sf of sfs) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const idn = calleeIdentifier(node);
        const sym = idn ? resolveAlias(checker, checker.getSymbolAtLocation(idn)) : undefined;
        const calleeId = fnIdOfDecl(sym?.declarations?.[0]);
        const callerId = enclosingFnId(node);
        if (calleeId && callerId && calleeId !== callerId) {
          const awaited = ts.isAwaitExpression(node.parent);
          const line = lineOf(sf, node.getStart(sf));
          addEdge({ from: callerId, to: calleeId, kind: "calls", label: `${awaited ? "await · " : ""}L${line}` });
          const list = callersOf.get(calleeId) ?? [];
          list.push({ callerId, line, awaited, file: baseOf(sf) });
          callersOf.set(calleeId, list);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // ── Successor API symbols ───────────────────────────────────────────────
  const successorNodes: CpgNode[] = [];
  const successorSf = successorFile ? program.getSourceFile(successorFile) : undefined;
  const successorExports = (() => {
    if (!successorSf) return new Map<string, ts.Symbol>();
    const mod = checker.getSymbolAtLocation(successorSf);
    if (!mod) return new Map<string, ts.Symbol>();
    return new Map(checker.getExportsOfModule(mod).map((s) => [s.name, s]));
  })();
  for (const spec of input.successorSymbols) {
    const [head, member] = spec.split(".");
    let sym = resolveAlias(checker, successorExports.get(head));
    if (sym && member) {
      const declared = checker.getDeclaredTypeOfSymbol(sym);
      sym = declared.getProperty(member) ?? undefined;
    }
    const decl = sym?.declarations?.[0];
    let signature: string | null = null;
    if (sym && decl) {
      try {
        if (sym.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
          const declared = checker.getDeclaredTypeOfSymbol(sym);
          const props = declared
            .getProperties()
            .map((p) => `${p.name}: ${typeStr(checker.getTypeOfSymbolAtLocation(p, decl))}`);
          signature = `{ ${props.join("; ")} }`;
        } else {
          signature = typeStr(checker.getTypeOfSymbolAtLocation(sym, decl));
        }
      } catch {
        signature = null;
      }
    }
    successorNodes.push(
      addNode({
        id: `api:${input.successorModule ?? "?"}#${spec}`,
        kind: "api_symbol",
        label: `${input.successorModule ?? "?"}#${spec}`,
        module: input.successorModule ?? null,
        symbolRole: "successor",
        resolved: Boolean(decl),
        signature,
        declFile: decl ? rel(decl.getSourceFile().fileName) : null,
      })
    );
  }

  // ── Call sites (scenario finder spans) ──────────────────────────────────
  const deprecated = new Set(input.deprecatedSymbols);
  type SiteInfo = {
    node: CpgNode;
    sf: ts.SourceFile;
    spanNode: ts.Node;
    call: ts.CallExpression | null;
    apiNode: CpgNode | null;
    resultBinding: string | null;
    resultType: string | null;
    downstream: string[];
    returnedFrom: string | null;
  };
  const sites: SiteInfo[] = [];

  const findSpanNode = (sf: ts.SourceFile, start: number, end: number): ts.Node | null => {
    let found: ts.Node | null = null;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (n.getStart(sf) === start && n.getEnd() === end) {
        found = n;
        return;
      }
      if (n.getStart(sf) <= start && n.getEnd() >= end) ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  };
  const findTargetCall = (root: ts.Node): ts.CallExpression | null => {
    const queue: ts.Node[] = [root];
    let firstCall: ts.CallExpression | null = null;
    while (queue.length) {
      const n = queue.shift() as ts.Node;
      if (ts.isCallExpression(n)) {
        firstCall ??= n;
        const idn = calleeIdentifier(n);
        if (idn && deprecated.has(idn.text)) return n;
      }
      ts.forEachChild(n, (c) => {
        queue.push(c);
      });
    }
    return firstCall;
  };

  for (const span of input.spans) {
    const sf = sfs.find((s) => baseOf(s) === span.fileName);
    if (!sf) continue;
    const spanNode = findSpanNode(sf, span.start, span.end);
    if (!spanNode) continue;
    const call = findTargetCall(spanNode);
    const idn = call ? calleeIdentifier(call) : null;
    const sym = idn ? resolveAlias(checker, checker.getSymbolAtLocation(idn)) : undefined;
    const decl = sym?.declarations?.[0];
    const symName = idn?.text ?? span.kind;
    if (call) {
      health.checked += 1;
      if (!decl) health.collapsed.push(`${span.fileName}:${span.startLine} ${symName}() unresolved`);
    }

    let deprecatedReason: DeprecatedReason | null = null;
    if (decl && ts.getJSDocDeprecatedTag(decl)) deprecatedReason = "jsdoc";
    else if (deprecated.has(symName)) deprecatedReason = "scenario_meta";
    else deprecatedReason = "finder_match";

    let signature: string | null = null;
    let sig: ts.Signature | undefined;
    if (call) {
      try {
        sig = checker.getResolvedSignature(call);
        if (sig) signature = short(checker.signatureToString(sig), 110);
      } catch {
        signature = null;
      }
    }

    const args: CallArgFact[] = (call?.arguments ?? []).map((a, i) => {
      const p = sig?.parameters[i];
      let paramType: string | null = null;
      if (p && call) {
        try {
          paramType = typeStr(checker.getTypeOfSymbolAtLocation(p, call));
        } catch {
          paramType = null;
        }
      }
      return {
        index: i,
        text: short(a.getText(sf), 48),
        type: typeAt(a),
        param: p?.name ?? null,
        paramType,
      };
    });

    const csId = `cs:${span.fileName}:${span.start}`;
    const csNode = addNode({
      id: csId,
      kind: "call_site",
      label: call ? `${symName}(…)` : span.kind,
      fileName: span.fileName,
      line: span.startLine,
      start: span.start,
      end: span.end,
      text: short(span.text, 160),
      spanKind: span.kind,
      signature,
      deprecated: true,
      deprecatedReason,
      args,
    });

    let apiNode: CpgNode | null = null;
    if (call) {
      const declFile = decl ? decl.getSourceFile().fileName : null;
      const pkg = declFile ? packageNameOf(declFile) : null;
      const owner = pkg ?? (declFile ? rel(declFile) : "unresolved");
      apiNode = addNode({
        id: `api:${owner}#${symName}`,
        kind: "api_symbol",
        label: `${owner}#${symName}`,
        module: pkg,
        symbolRole: "deprecated",
        resolved: Boolean(decl),
        signature,
        declFile: declFile ? rel(declFile) : null,
        deprecated: true,
        deprecatedReason,
      });
      addEdge({ from: csId, to: apiNode.id, kind: "resolves_to", label: deprecatedReason ?? undefined });
      for (const succ of successorNodes) {
        addEdge({ from: apiNode.id, to: succ.id, kind: "migrates_to" });
      }
    }

    const fnId = enclosingFnId(spanNode);
    if (fnId) addEdge({ from: fnId, to: csId, kind: "contains" });

    // argument_of: variable occurrences inside each argument
    for (const [i, a] of (call?.arguments ?? []).entries()) {
      const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n)) {
          const o = occByStart.get(`${span.fileName}:${n.getStart(sf)}`);
          if (o) {
            addEdge({
              from: o.id,
              to: csId,
              kind: "argument_of",
              label: args[i]?.param ? `→ ${args[i].param}` : `arg ${i}`,
            });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(a);
    }

    // result binding + downstream usages
    let top: ts.Node = call ?? spanNode;
    while (
      top.parent &&
      ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) ||
        (ts.isCallExpression(top.parent) && top.parent.expression === top) ||
        ts.isAwaitExpression(top.parent) ||
        ts.isParenthesizedExpression(top.parent))
    ) {
      top = top.parent;
    }
    let resultBinding: string | null = null;
    let resultType: string | null = null;
    const downstream: string[] = [];
    let returnedFrom: string | null = null;
    if (ts.isVariableDeclaration(top.parent) && ts.isIdentifier(top.parent.name)) {
      const bindingId = top.parent.name;
      resultBinding = bindingId.text;
      resultType = typeAt(bindingId);
      const bindingSym = checker.getSymbolAtLocation(bindingId);
      const scope = fnId ? fnNodeById.get(fnId)?.node : sf;
      const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n !== bindingId && checker.getSymbolAtLocation(n) === bindingSym) {
          const ctx = n.parent && !ts.isBlock(n.parent) ? n.parent : n;
          downstream.push(`${short(ctx.getText(sf), 48)} at line ${lineOf(sf, n.getStart(sf))} (${typeAt(n)})`);
        }
        ts.forEachChild(n, visit);
      };
      if (scope) visit(scope);
    } else if (
      ts.isReturnStatement(top.parent) ||
      (top.parent && ts.isArrowFunction(top.parent) && top.parent.body === top)
    ) {
      returnedFrom = fnId;
      resultType = typeAt(top);
    }

    sites.push({ node: csNode, sf, spanNode, call, apiNode, resultBinding, resultType, downstream, returnedFrom });
  }

  // ── Variable nodes: focus function + argument variables ─────────────────
  const focusSite =
    (input.focus &&
      sites.find((s) => s.node.fileName === input.focus?.fileName && s.node.start === input.focus?.start)) ||
    sites[0] ||
    null;
  const focusFnId = focusSite ? enclosingFnId(focusSite.spanNode) : null;

  const argOccIds = new Set(edges.filter((e) => e.kind === "argument_of").map((e) => e.from));
  for (const [fnId, dfg] of dfgByFn) {
    const keepAll = fnId === focusFnId;
    const keep = new Set<string>();
    for (const o of dfg.occ) if (keepAll || argOccIds.has(o.id)) keep.add(o.id);
    if (!keepAll) {
      // pull in the definition each kept use comes from
      for (const e of dfg.edges) if (e.kind === "comesFrom" && keep.has(e.to)) keep.add(e.from);
    }
    for (const o of dfg.occ) {
      if (!keep.has(o.id)) continue;
      addNode({
        id: o.id,
        kind: "variable",
        label: o.name,
        fileName: path.basename(fnNodeById.get(fnId)?.sf.fileName ?? ""),
        line: o.line,
        start: o.start,
        end: o.end,
        role: o.role,
        type: o.type,
        functionId: fnId,
      });
    }
    for (const e of dfg.edges) {
      if (keep.has(e.from) && keep.has(e.to)) addEdge(e);
    }
  }

  // ── Focus: code, AST outline, typed DFG ─────────────────────────────────
  let focus: CodePropertyGraph["focus"] = null;
  let sliceFacts: SliceFacts | null = null;
  const tokens = { file: 0, slice: 0, facts: 0 };

  if (focusSite) {
    const sf = focusSite.sf;
    const fnEntry = focusFnId ? fnNodeById.get(focusFnId) : undefined;
    const anchor: ts.Node = fnEntry
      ? (ts.isArrowFunction(fnEntry.node) || ts.isFunctionExpression(fnEntry.node)) &&
        ts.isVariableDeclaration(fnEntry.node.parent)
        ? fnEntry.node.parent.parent.parent // VariableStatement
        : fnEntry.node
      : focusSite.spanNode;
    const base = anchor.getStart(sf);
    const code = sf.text.slice(base, anchor.getEnd());
    const spanStart = (focusSite.node.start ?? base) - base;
    const spanEnd = (focusSite.node.end ?? base) - base;

    const dfg = focusFnId ? dfgByFn.get(focusFnId) : undefined;
    const localId = new Map<string, string>();
    (dfg?.occ ?? []).forEach((o, i) => localId.set(o.id, `v${i}`));
    const focusDfg = {
      nodes: (dfg?.occ ?? []).map((o) => ({
        id: localId.get(o.id) as string,
        name: o.name,
        role: o.role,
        start: o.start - base,
        end: o.end - base,
        line: o.line,
        type: o.type,
      })),
      edges: (dfg?.edges ?? []).map((e) => ({
        from: localId.get(e.from) as string,
        to: localId.get(e.to) as string,
        kind: e.kind,
      })),
    };
    const occAt = new Map((dfg?.occ ?? []).map((o) => [o.start, localId.get(o.id) as string]));

    let count = 0;
    let seq = 0;
    const MAX_AST = 130;
    const build = (n: ts.Node): AstOutlineNode | null => {
      if (ts.isModifier(n)) return null;
      count += 1;
      const start = n.getStart(sf);
      const out: AstOutlineNode = {
        id: `a${seq++}`,
        kind: kindName(n.kind),
        label: kindName(n.kind),
        start: start - base,
        end: n.getEnd() - base,
        children: [],
      };
      out.inSpan = out.start >= spanStart && out.end <= spanEnd;
      if (ts.isIdentifier(n)) {
        out.label = n.text;
        out.type = typeAt(n);
        const d = occAt.get(start);
        if (d) out.dfgId = d;
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) {
        out.label = short(n.getText(sf), 24);
      } else if (ts.isTemplateExpression(n)) {
        out.label = "`…${}…`";
      } else if (ts.isTypeNode(n)) {
        out.label = `: ${short(n.getText(sf), 26)}`;
        return out;
      } else if (ts.isCallExpression(n)) {
        out.type = typeAt(n);
      }
      const kids: ts.Node[] = [];
      ts.forEachChild(n, (c) => {
        kids.push(c);
      });
      for (const k of kids) {
        if (count >= MAX_AST) {
          out.collapsed = true;
          break;
        }
        const child = build(k);
        if (child) out.children.push(child);
      }
      return out;
    };

    focus = {
      callSiteId: focusSite.node.id,
      functionId: focusFnId,
      fileName: baseOf(sf),
      code,
      codeStartLine: lineOf(sf, base),
      span: { start: spanStart, end: spanEnd },
      ast: build(anchor),
      dfg: focusDfg,
    };

    // ── Slice facts (what the LLM receives) ───────────────────────────────
    const originOf = (id: ts.Identifier): string | null => {
      const sym = checker.getSymbolAtLocation(id);
      const decl = sym?.declarations?.[0];
      if (!decl) return null;
      const dsf = decl.getSourceFile();
      const line = lineOf(dsf, decl.getStart(dsf));
      if (ts.isParameter(decl)) {
        const owner = enclosingFnId(decl);
        return `parameter of ${owner ? nodeById.get(owner)?.label : "function"} (line ${line})`;
      }
      if (ts.isVariableDeclaration(decl)) return `local binding at line ${line}`;
      if (ts.isImportClause(decl) || ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl)) {
        return `import at line ${line}`;
      }
      return `${kindName(decl.kind)} at line ${line}`;
    };

    const argFacts = (focusSite.node.args ?? []).map((a, i) => {
      const argNode = focusSite.call?.arguments[i];
      const firstId = argNode && ts.isIdentifier(argNode) ? argNode : null;
      return { ...a, origin: firstId ? originOf(firstId) : null };
    });

    const dataFlow: SliceFacts["data_flow"] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.kind !== "argument_of" || e.to !== focusSite.node.id) continue;
      const v = nodeById.get(e.from);
      if (!v || seen.has(v.label)) continue;
      seen.add(v.label);
      const fnDfg = v.functionId ? dfgByFn.get(v.functionId) : undefined;
      const occ = fnDfg?.occ.find((o) => o.id === v.id);
      const defEdge = fnDfg?.edges.find((x) => x.kind === "comesFrom" && x.to === v.id);
      const defOcc = defEdge ? fnDfg?.occ.find((o) => o.id === defEdge.from) : occ;
      const uses = (fnDfg?.edges ?? [])
        .filter((x) => x.kind === "comesFrom" && x.from === (defOcc?.id ?? v.id))
        .map((x) => fnDfg?.occ.find((o) => o.id === x.to))
        .filter((o): o is DfgOcc => Boolean(o))
        .map((o) => `line ${o.line}`);
      dataFlow.push({
        variable: v.label,
        declared_type: defOcc?.type ?? v.type ?? "unknown",
        origin: defOcc ? originOf(defOcc.ident) ?? `${defOcc.role} at line ${defOcc.line}` : "unknown",
        downstream_usages: uses,
      });
    }

    const callers = focusFnId ? callersOf.get(focusFnId) ?? [] : [];
    const fnNode = focusFnId ? nodeById.get(focusFnId) : undefined;
    const api = focusSite.apiNode;
    sliceFacts = {
      target_call: short(focusSite.node.text ?? "", 160),
      slice: {
        file: baseOf(sf),
        bytes: [focusSite.node.start ?? 0, focusSite.node.end ?? 0],
        lines: [
          focusSite.node.line ?? 0,
          lineOf(sf, focusSite.node.end ?? 0),
        ],
      },
      resolved_api: api
        ? {
            symbol: api.label,
            module: api.module ?? null,
            signature: focusSite.node.signature ?? null,
            deprecated: true,
            deprecated_reason: focusSite.node.deprecatedReason ?? null,
          }
        : null,
      successor_api: successorNodes.map((s) => ({
        symbol: s.label,
        module: s.module ?? null,
        signature: s.signature ?? null,
      })),
      arguments: argFacts,
      data_flow: dataFlow,
      result: {
        binding: focusSite.resultBinding,
        type: focusSite.resultType,
        downstream_usages: focusSite.returnedFrom
          ? callers.map(
              (c) => `returned to ${nodeById.get(c.callerId)?.label ?? c.callerId} (${c.file}:${c.line}${c.awaited ? ", awaited" : ""})`
            )
          : focusSite.downstream,
      },
      enclosing_function: fnNode
        ? {
            name: fnNode.label.replace(/\(\)$/, ""),
            async: Boolean(fnNode.async),
            return_type: fnNode.returnType ?? "void",
            params: fnNode.params ?? [],
          }
        : null,
      callers_1hop: callers.map(
        (c) => `${nodeById.get(c.callerId)?.label ?? c.callerId} (${c.file}:${c.line}${c.awaited ? ", awaited" : ", not awaited"})`
      ),
    };

    tokens.file = countTokens(sf.text);
    tokens.slice = countTokens(focusSite.node.text ?? "");
    tokens.facts = countTokens(JSON.stringify(sliceFacts));
  }

  return {
    engine: "typescript-program",
    tsconfig: rel(loaded.configPath),
    nodes,
    edges,
    focus,
    sliceFacts,
    tokens,
    health: {
      anyCollapseRate: health.checked ? health.collapsed.length / health.checked : 0,
      checked: health.checked,
      collapsed: health.collapsed,
      explicitAny: health.explicitAny,
      missingFiles: health.missingFiles,
      configErrors: loaded.configErrors,
    },
  };
}
