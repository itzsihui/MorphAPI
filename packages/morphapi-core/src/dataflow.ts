/**
 * Mechanism 3 — data-flow propagation. When the successor wraps the old
 * result (e.g. User[] → { data: User[]; pagination }), downstream consumers
 * break. Try a boundary adapter at the call site first; if the binding needs
 * the envelope, rewrite its read paths instead. The TypeChecker decides
 * which edit restores the program.
 */
import * as ts from "typescript";
import type { ProjectSession } from "./program";

export type ShapeRewrite = { line: number; from: string; to: string };

export type ShapeResult = {
  mode: "none" | "adapter" | "read_paths" | "unresolved";
  wrapperPath: string | null;
  diagnosticsBefore: number;
  diagnosticsAfter: number;
  rewrites: ShapeRewrite[];
};

function coveringExpression(sf: ts.SourceFile, start: number, end: number): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      if (ts.isExpression(n) && n.getStart(sf) === start && n.getEnd() === end) found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

function stripType(s: string): string {
  return s.replace(/^Promise<(.*)>$/, "$1").trim();
}

/**
 * @param range replacement range in the session's current text of `file`
 * @param baseline diagnostics count over `files` before the migration
 * @param oldResultType result type before migration (from slice facts)
 */
export function propagateResponseShape(
  session: ProjectSession,
  file: string,
  range: { start: number; end: number },
  opts: { files: string[]; baseline: number; oldResultType?: string | null }
): ShapeResult {
  const count = () => session.diagnostics(opts.files).length;
  const diagnosticsBefore = count();
  const none: ShapeResult = { mode: "none", wrapperPath: null, diagnosticsBefore, diagnosticsAfter: diagnosticsBefore, rewrites: [] };
  if (diagnosticsBefore <= opts.baseline) return none;

  const sf = session.sourceFile(file);
  if (!sf) return { ...none, mode: "unresolved" };
  const expr = coveringExpression(sf, range.start, range.end);
  if (!expr) return { ...none, mode: "unresolved" };
  let target: ts.Expression = expr;
  while (target.parent && (ts.isAwaitExpression(target.parent) || ts.isParenthesizedExpression(target.parent))) {
    target = target.parent as ts.Expression;
  }

  const checker = session.checker;
  const t = checker.getTypeAtLocation(target);
  const awaited = checker.getAwaitedType(t) ?? t;
  const old = opts.oldResultType ? stripType(opts.oldResultType) : null;
  const props = awaited
    .getProperties()
    .map((p) => {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const pt = decl ? checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl)) : "";
      return { name: p.name, type: pt };
    })
    .sort((a, b) => Number(b.type === old) - Number(a.type === old));
  if (!props.length) return { ...none, mode: "unresolved" };

  const original = sf.text;
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const tStart = target.getStart(sf);
  const tEnd = target.getEnd();
  const targetText = original.slice(tStart, tEnd);
  const isPromise = awaited !== t;
  const isAwaited = ts.isAwaitExpression(target) || /^\(?\s*await\b/.test(targetText);
  let fn: ts.Node | undefined = target.parent;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  const inAsync = Boolean(fn && ts.canHaveModifiers(fn) && ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
  if (isPromise && !isAwaited && !inAsync) return { ...none, mode: "unresolved" };

  // 1. Boundary adapter at the call site.
  for (const p of props) {
    const wrapped = isPromise && !isAwaited ? `(await ${targetText}).${p.name}` : `(${targetText}).${p.name}`;
    session.update({ [file]: original.slice(0, tStart) + wrapped + original.slice(tEnd) });
    const after = count();
    if (after <= opts.baseline) {
      return {
        mode: "adapter",
        wrapperPath: p.name,
        diagnosticsBefore,
        diagnosticsAfter: after,
        rewrites: [{ line: lineOf(tStart), from: targetText, to: wrapped }],
      };
    }
  }
  session.update({ [file]: original });

  // 2. Read-path rewrite on the binding the result flows into.
  const decl = target.parent;
  if (decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
    const sf2 = session.sourceFile(file)!;
    const checker2 = session.checker;
    const declNode = coveringExpression(sf2, tStart, tEnd)?.parent;
    const bindingSym =
      declNode && ts.isVariableDeclaration(declNode) && ts.isIdentifier(declNode.name)
        ? checker2.getSymbolAtLocation(declNode.name)
        : undefined;
    const reads: ts.Identifier[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === decl.name.getText(sf) && n.getStart(sf2) > tEnd) {
        if (checker2.getSymbolAtLocation(n) === bindingSym) reads.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf2);
    for (const p of props) {
      const edits = reads
        .filter((r) => {
          const parent = r.parent;
          return !(ts.isPropertyAccessExpression(parent) && parent.expression === r && props.some((q) => q.name === parent.name.text));
        })
        .map((r) => ({ start: r.getStart(sf2), end: r.getEnd(), text: `${r.text}.${p.name}` }));
      if (!edits.length) continue;
      let text = original;
      for (const e of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
      session.update({ [file]: text });
      const after = count();
      if (after <= opts.baseline) {
        return {
          mode: "read_paths",
          wrapperPath: p.name,
          diagnosticsBefore,
          diagnosticsAfter: after,
          rewrites: edits.map((e) => ({ line: lineOf(e.start), from: original.slice(e.start, e.end), to: e.text })),
        };
      }
    }
    session.update({ [file]: original });
  }

  return { ...none, mode: "unresolved", diagnosticsAfter: count() };
}
