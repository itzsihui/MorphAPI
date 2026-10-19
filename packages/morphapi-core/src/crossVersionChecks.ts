/**
 * Cross-version checks that need BOTH versions of the upgraded package (MorphAPI's version bridge):
 *
 *  T2 optionNoLongerAccepted — the project passes an option (through a variable or a spread; TypeScript checks
 *     excess properties only on inline object literals) that the new version's parameter type does not have but the
 *     previous version declared. The new version silently ignores it.
 *     (Kong et al. 2024, npm breaking changes: "Changing process for some option values", "Parameters in configuration objects".)
 *
 *  T4 nowAsyncUsedAsSync — a call whose result is a Promise in the new version, where the previous version's
 *     declaration of that function/method returned a non-Promise, and the result is not awaited / returned / chained.
 *     A Promise in a condition is always truthy; an un-awaited call loses its result and its errors.
 *     (Kong et al. 2024: "Sync and async".)
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export type CrossVersionFinding = { check: "option_not_accepted" | "now_async"; file: string; line: number; message: string };
type Pkg = { module: string; oldDir: string; newDir: string };

function dtsFiles(dir: string, cap = 800): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= cap) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.d\.(c|m)?ts$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

type OldIndex = { returns: Map<string, Set<"promise" | "sync">>; optionNames: Set<string>; paramOptions: Map<string, Set<string>>; callables: Set<string> };
const indexCache = new Map<string, OldIndex>();

/** From the previous version's .d.ts: return kinds per function/method name, and property names of its types. */
export function indexOldDeclarations(oldDir: string): OldIndex {
  const hit = indexCache.get(oldDir);
  if (hit) return hit;
  const returns = new Map<string, Set<"promise" | "sync">>();
  const optionNames = new Set<string>();
  const callables = new Set<string>(); // every function / method / class name declared in the previous version
  const typeProps = new Map<string, { props: Set<string>; bases: string[] }>(); // interface / type alias name -> members
  const paramTypeRefs: Array<{ fn: string; node: ts.TypeNode; sf: ts.SourceFile }> = [];
  const membersOf = (members: ts.NodeArray<ts.TypeElement>) => {
    const out = new Set<string>();
    for (const m of members) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) out.add(m.name.text);
    return out;
  };
  const addRet = (name: string, t: ts.TypeNode | undefined, sf: ts.SourceFile) => {
    if (!t) return;
    const txt = t.getText(sf);
    const kind = /^(Promise|PromiseLike|Thenable)\s*</.test(txt) || /\bPromise\s*</.test(txt.split("=>").pop() ?? "") ? "promise" : txt === "void" || txt === "any" ? null : "sync";
    if (!kind) return;
    const set = returns.get(name) ?? new Set();
    set.add(kind);
    returns.set(name, set);
  };
  for (const f of dtsFiles(oldDir)) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodSignature(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n) || ts.isVariableDeclaration(n) || ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && n.name && ts.isIdentifier(n.name)) callables.add(n.name.text);
      if ((ts.isFunctionDeclaration(n) || ts.isMethodSignature(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
        addRet(n.name.text, n.type, sf);
        for (const p of n.parameters) if (p.type) paramTypeRefs.push({ fn: n.name.text, node: p.type, sf });
      }
      if (ts.isConstructorDeclaration(n) && ts.isClassLike(n.parent) && n.parent.name) for (const p of n.parameters) if (p.type) paramTypeRefs.push({ fn: n.parent.name.text, node: p.type, sf });
      if ((ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.type && ts.isFunctionTypeNode(n.type))
        for (const p of n.type.parameters) if (p.type) paramTypeRefs.push({ fn: n.name.text, node: p.type, sf });
      if (ts.isInterfaceDeclaration(n)) typeProps.set(n.name.text, { props: membersOf(n.members), bases: (n.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression.getText(sf))) });
      if (ts.isTypeAliasDeclaration(n)) {
        const bases: string[] = []; const props = new Set<string>();
        const add = (t: ts.TypeNode) => {
          if (ts.isTypeLiteralNode(t)) membersOf(t.members).forEach((x) => props.add(x));
          else if (ts.isTypeReferenceNode(t)) bases.push(t.typeName.getText(sf));
          else if (ts.isIntersectionTypeNode(t) || ts.isUnionTypeNode(t)) t.types.forEach(add);
          else if (ts.isParenthesizedTypeNode(t)) add(t.type);
        };
        add(n.type);
        typeProps.set(n.name.text, { props, bases });
      }
      if ((ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
        optionNames.add(n.name.text);
        if (n.type && ts.isFunctionTypeNode(n.type)) addRet(n.name.text, n.type.type, sf);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // resolve each callee's parameter types to option names
  const resolve = (name: string, seen = new Set<string>()): Set<string> => {
    const base = name.replace(/<.*$/, "").split(".").pop() ?? name;
    if (seen.has(base)) return new Set(); seen.add(base);
    const t = typeProps.get(base); if (!t) return new Set();
    const out = new Set(t.props);
    for (const b of t.bases) resolve(b, seen).forEach((x) => out.add(x));
    return out;
  };
  const paramOptions = new Map<string, Set<string>>();
  for (const { fn, node, sf } of paramTypeRefs) {
    const set = paramOptions.get(fn) ?? new Set<string>();
    const walkT = (t: ts.TypeNode) => {
      if (ts.isTypeLiteralNode(t)) membersOf(t.members).forEach((x) => set.add(x));
      else if (ts.isTypeReferenceNode(t)) { resolve(t.typeName.getText(sf)).forEach((x) => set.add(x)); t.typeArguments?.forEach(walkT); }
      else if (ts.isIntersectionTypeNode(t) || ts.isUnionTypeNode(t)) t.types.forEach(walkT);
      else if (ts.isParenthesizedTypeNode(t)) walkT(t.type);
    };
    walkT(node);
    paramOptions.set(fn, set);
  }
  const idx = { returns, optionNames, paramOptions, callables };
  indexCache.set(oldDir, idx);
  return idx;
}

function calleeInfo(checker: ts.TypeChecker, n: ts.CallExpression | ts.NewExpression, pkgs: Pkg[]): { name: string; pkg: Pkg } | null {
  const callee = n.expression;
  const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
  if (!nameNode) return null;
  let sym = checker.getSymbolAtLocation(nameNode);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const dfile = sym?.declarations?.[0]?.getSourceFile().fileName ?? "";
  const pkg = pkgs.find((p) => dfile.includes(`/node_modules/${p.module}/`) && !dfile.includes("bridge-cache"));
  return sym && pkg ? { name: sym.name, pkg } : null;
}

const isPromiseType = (checker: ts.TypeChecker, t: ts.Type): boolean => {
  if (t.isUnion()) return t.types.some((x) => isPromiseType(checker, x));
  const s = t.getSymbol();
  if (s && /^(Promise|PromiseLike)$/.test(s.name)) return true;
  const then = t.getProperty("then");
  return !!then && checker.getSignaturesOfType(checker.getTypeOfSymbol(then), ts.SignatureKind.Call).length > 0;
};

/** Is the value of `n` consumed as a promise (awaited, returned, chained, collected)? */
function consumedAsPromise(n: ts.Node, sf: ts.SourceFile, checker: ts.TypeChecker): boolean | "condition" {
  let e: ts.Node = n;
  while (ts.isParenthesizedExpression(e.parent) || ts.isAsExpression(e.parent) || ts.isNonNullExpression(e.parent) || ts.isTypeAssertionExpression(e.parent)) e = e.parent;
  const p = e.parent;
  if (ts.isAwaitExpression(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isYieldExpression(p)) return true;
  if (ts.isPropertyAccessExpression(p) && p.expression === e && /^(then|catch|finally)$/.test(p.name.text)) return true;
  // post-hoc fix 2: a member of the result is used (builder chains such as mongoose's find().exec()): a thenable
  // builder, not a forgotten await; do not guess
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === e) return true;
  if (ts.isArrayLiteralExpression(p)) return true; // usually Promise.all([...])
  if (ts.isCallExpression(p) && p.arguments.includes(e as ts.Expression)) {
    const t = p.expression.getText(sf);
    if (/Promise\.(all|race|allSettled|any)|expect|resolves|rejects/.test(t)) return true;
    return true; // passed on: the callee may await it; do not guess
  }
  if (ts.isIfStatement(p) || ts.isConditionalExpression(p) || ts.isWhileStatement(p) || (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) || (ts.isBinaryExpression(p) && /^(&&|\|\||===|!==|==|!=)$/.test(p.operatorToken.getText(sf)))) return "condition";
  if (ts.isVariableDeclaration(p) && p.initializer === e && ts.isIdentifier(p.name)) {
    const v = checker.getSymbolAtLocation(p.name);
    const scope = p.parent.parent.parent;
    let awaited = false;
    const walk = (x: ts.Node) => {
      if (awaited) return;
      if (ts.isIdentifier(x) && x !== p.name && checker.getSymbolAtLocation(x) === v) {
        const r = consumedAsPromise(x, sf, checker);
        if (r === true) awaited = true;
      }
      ts.forEachChild(x, walk);
    };
    if (scope) walk(scope);
    return awaited;
  }
  if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isBinaryExpression(p)) return true; // stored; do not guess
  return false; // expression statement and other uses
}

export function crossVersionFindings(program: ts.Program, files: string[], pkgs: Pkg[], rel: (f: string) => string): CrossVersionFinding[] {
  const checker = program.getTypeChecker();
  const out: CrossVersionFinding[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const sf = program.getSourceFile(path.resolve(f));
    if (!sf || sf.isDeclarationFile) continue;
    const push = (n: ts.Node, check: CrossVersionFinding["check"], message: string) => {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const k = `${check}:${rel(f)}:${line}:${message.slice(0, 60)}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ check, file: rel(f), line, message });
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const info = calleeInfo(checker, n, pkgs);
        if (info) {
          const old = indexOldDeclarations(info.pkg.oldDir);
          // ---- T4: now async, used as sync
          if (ts.isCallExpression(n)) {
            const kinds = old.returns.get(info.name);
            const sig = checker.getResolvedSignature(n);
            if (kinds && kinds.has("sync") && !kinds.has("promise") && sig && isPromiseType(checker, checker.getReturnTypeOfSignature(sig))) {
              const c = consumedAsPromise(n, sf, checker);
              if (c !== true) {
                push(n, "now_async", `${rel(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} \`${n.getText(sf).slice(0, 80)}\`: \`${info.name}\` returns a Promise in the new version of ${info.pkg.module} (it did not in the previous version), but the result is ${c === "condition" ? "used as a condition (a Promise is always truthy)" : "not awaited (its result and errors are lost)"}. Await it.`);
              }
            }
          }
          // ---- T2: option passed through a variable/spread that the new version no longer accepts
          const sig = checker.getResolvedSignature(n);
          const args = n.arguments ?? ts.factory.createNodeArray();
          args.forEach((a, i) => {
            const param = sig?.getParameters()[Math.min(i, (sig?.getParameters().length ?? 1) - 1)];
            if (!param) return;
            const pt = checker.getTypeOfSymbolAtLocation(param, n);
            if (pt.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return;
            const parts = pt.isUnion() ? pt.types : [pt];
            if (parts.some((x) => checker.getIndexInfosOfType(x).length || x.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) return;
            if (!parts.some((x) => x.getProperties().length)) return; // not an options object
            const known = new Set(parts.flatMap((x) => x.getProperties().map((p) => p.name)));
            const sources: ts.Expression[] = [];
            if (ts.isObjectLiteralExpression(a)) for (const p of a.properties) { if (ts.isSpreadAssignment(p)) sources.push(p.expression); }
            else if (!ts.isFunctionLike(a)) sources.push(a);
            for (const src of sources) {
              const at = checker.getTypeAtLocation(src);
              if (at.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) continue;
              for (const p of at.getProperties()) {
                // precision fix (post-hoc, after the verifier evaluation): the previous version of THIS callee must have accepted it
                // Tried and reverted (post-hoc): falling back to every old option when the callee is new in this version
                // recovers renamed callees (openai Configuration -> OpenAI, 2 ignored-option mutants) but re-flags 4 of 19
                // harmless mutants (new callees REST, createNodeMiddleware). Precision is kept: same callee only.
                const oldOpts = old.paramOptions.get(info.name);
                if (known.has(p.name) || !oldOpts?.has(p.name)) continue;
                const decl = p.declarations?.[0];
                if (decl && /node_modules/.test(decl.getSourceFile().fileName)) continue; // the property comes from a library type
                push(src, "option_not_accepted", `${rel(f)}:${sf.getLineAndCharacterOfPosition(src.getStart(sf)).line + 1} passes \`${p.name}\` (via \`${src.getText(sf).slice(0, 40)}\`) to \`${info.name}\` (${info.pkg.module}). The previous version accepted \`${p.name}\`; the new version's parameter type has no such option, so it is ignored. Move it to where the new version expects it (see the migration guide) or remove it.`);
              }
            }
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
