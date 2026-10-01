/**
 * Mechanism 4 — program-level 1-hop impact. After patches land in the
 * session, check the patched files and the files one hop away (importers and
 * callers of changed functions) using resolved symbols and per-file
 * diagnostics, not text matching.
 */
import * as path from "path";
import * as ts from "typescript";
import {
  findDeprecatedReferences,
  findReferences,
  resolveAlias,
  resolveSymbolSpec,
  type ProjectSession,
  type SessionDiagnostic,
} from "./program";

export type ProgramImpactReason = "same_api_leftover" | "missing_await" | "stale_import" | "new_type_error";

export type ProgramImpactFinding = {
  reason: ProgramImpactReason;
  file: string;
  line: number;
  start?: number;
  symbol?: string;
  detail: string;
};

export type FunctionSignatures = Map<string, { file: string; name: string; returnType: string }>;

type FnDecl = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function functionsIn(sf: ts.SourceFile): Array<{ name: string; node: FnDecl; nameNode: ts.Node }> {
  const out: Array<{ name: string; node: FnDecl; nameNode: ts.Node }> = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
      out.push({ name: n.name.text, node: n, nameNode: n.name });
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      out.push({ name: n.name.text, node: n.initializer, nameNode: n.name });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Return types of every function in `files`, keyed `file#name`. */
export function snapshotSignatures(session: ProjectSession, files: string[]): FunctionSignatures {
  const checker = session.checker;
  const out: FunctionSignatures = new Map();
  for (const f of files) {
    const sf = session.sourceFile(f);
    if (!sf) continue;
    for (const fn of functionsIn(sf)) {
      const sig = checker.getSignatureFromDeclaration(fn.node);
      if (!sig) continue;
      out.set(`${sf.fileName}#${fn.name}`, {
        file: sf.fileName,
        name: fn.name,
        returnType: checker.typeToString(checker.getReturnTypeOfSignature(sig)),
      });
    }
  }
  return out;
}

export function diagnosticKeys(diags: SessionDiagnostic[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of diags) {
    const k = `${d.file}|${d.code}|${d.message}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Files that import any of `targets` (resolved by the checker). */
function importersOf(session: ProjectSession, targets: Set<string>, candidates: string[]): string[] {
  const checker = session.checker;
  const out: string[] = [];
  for (const f of candidates) {
    const sf = session.sourceFile(f);
    if (!sf || targets.has(sf.fileName)) continue;
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st)) continue;
      const mod = checker.getSymbolAtLocation(st.moduleSpecifier);
      const decl = mod?.declarations?.[0];
      if (decl && targets.has(decl.getSourceFile().fileName)) {
        out.push(sf.fileName);
        break;
      }
    }
  }
  return out;
}

function isAwaitedUse(call: ts.CallExpression): boolean {
  let p: ts.Node = call.parent;
  while (ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isAwaitExpression(p)) return true;
  if (ts.isReturnStatement(p)) return true;
  if (ts.isArrowFunction(p) && p.body === call) return true;
  if (ts.isPropertyAccessExpression(p) && ["then", "catch", "finally"].includes(p.name.text)) return true;
  if (ts.isArrayLiteralExpression(p) || ts.isCallExpression(p)) return true;
  if (ts.isVariableDeclaration(p)) return true;
  return false;
}

export type ProgramImpactResult = {
  oneHopFiles: string[];
  changedFunctions: Array<{ file: string; name: string; before: string; after: string }>;
  findings: ProgramImpactFinding[];
  complete: boolean;
};

export function programImpact(
  session: ProjectSession,
  opts: {
    deprecatedSpec: string;
    projectFiles: string[];
    changedFiles: string[];
    baselineDiagnostics: Map<string, number>;
    signaturesBefore: FunctionSignatures;
    deprecatedModule?: string;
  }
): ProgramImpactResult {
  const changed = new Set(opts.changedFiles.map((f) => path.resolve(f)));
  const after = snapshotSignatures(session, [...changed]);
  const changedFunctions: ProgramImpactResult["changedFunctions"] = [];
  for (const [k, v] of after) {
    const before = opts.signaturesBefore.get(k);
    if (before && before.returnType !== v.returnType) {
      changedFunctions.push({ file: v.file, name: v.name, before: before.returnType, after: v.returnType });
    }
  }

  const checker = session.checker;
  const findings: ProgramImpactFinding[] = [];
  const callerFiles = new Set<string>();

  for (const cf of changedFunctions) {
    const sf = session.sourceFile(cf.file);
    const fn = sf && functionsIn(sf).find((f) => f.name === cf.name);
    const sym = fn && resolveAlias(checker, checker.getSymbolAtLocation(fn.nameNode));
    if (!sym) continue;
    const becameAsync = /^Promise</.test(cf.after) && !/^Promise</.test(cf.before);
    for (const ref of findReferences(session, sym, { files: opts.projectFiles })) {
      if (ref.kind !== "call") continue;
      callerFiles.add(ref.file);
      const callee = ts.isPropertyAccessExpression(ref.node.parent) ? ref.node.parent : ref.node;
      const call = callee.parent as ts.CallExpression;
      if (becameAsync && !isAwaitedUse(call)) {
        findings.push({
          reason: "missing_await",
          file: ref.file,
          line: ref.line,
          start: call.getStart(ref.node.getSourceFile()),
          symbol: cf.name,
          detail: `${cf.name}() now returns ${cf.after} (was ${cf.before}); this call is not awaited`,
        });
      }
    }
  }

  const oneHop = new Set<string>([
    ...changed,
    ...callerFiles,
    ...importersOf(session, changed, opts.projectFiles),
  ]);

  const from = opts.projectFiles[0];
  for (const left of findDeprecatedReferences(session, opts.deprecatedSpec, { files: opts.projectFiles, fromFile: from })) {
    findings.push({
      reason: "same_api_leftover",
      file: left.file,
      line: left.startLine,
      start: left.start,
      symbol: opts.deprecatedSpec,
      detail: `Still calls ${opts.deprecatedSpec.split("#")[1]}: ${left.text.slice(0, 60)}`,
    });
  }

  const resolved = from ? resolveSymbolSpec(session, opts.deprecatedSpec, from) : null;
  if (resolved) {
    const refs = findReferences(session, resolved.symbol, { files: opts.projectFiles });
    const byFile = new Map<string, typeof refs>();
    for (const r of refs) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    for (const [file, rs] of byFile) {
      if (rs.every((r) => r.kind === "import")) {
        for (const r of rs) {
          findings.push({
            reason: "stale_import",
            file,
            line: r.line,
            symbol: r.node.text,
            detail: `Import of deprecated ${r.node.text} is no longer used`,
          });
        }
      }
    }
  }

  const remaining = new Map(opts.baselineDiagnostics);
  for (const d of session.diagnostics([...oneHop])) {
    const k = `${d.file}|${d.code}|${d.message}`;
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      continue;
    }
    findings.push({
      reason: d.code === 2305 || d.code === 2307 || d.code === 6133 ? "stale_import" : "new_type_error",
      file: d.file,
      line: d.line,
      start: d.start,
      detail: `TS${d.code}: ${d.message}`,
    });
  }

  return {
    oneHopFiles: [...oneHop].sort(),
    changedFunctions,
    findings,
    complete: findings.length === 0,
  };
}
