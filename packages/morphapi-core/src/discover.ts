/**
 * Error-driven work-item discovery. On a real upgrade nobody hands MorphAPI a
 * `module#Export.member` spec; what the consumer has is a project that broke.
 * A work item is any site the upgrade broke, found three ways:
 *
 *  1. new-version diagnostics: errors the project has against the NEW version
 *     that it did not have against the old one (the bridged baseline);
 *  2. missing exports: an import the new version no longer provides
 *     (TS2305/2724/2307/1192/2613) makes its bindings `any`, so the checker
 *     stays silent at the uses; every use of such a binding is a work item;
 *  3. retired modules: a package replaced by a different one (aws-sdk →
 *     @aws-sdk/client-*) must disappear, so every use of its bindings and
 *     every call into it is a work item even when nothing errors.
 *
 * Each item becomes the smallest slice that contains it: a type annotation,
 * the call it is the callee of, the top-level expression it sits in, or as a
 * last resort the enclosing statement. Nested items merge into their container.
 */
import * as path from "path";
import * as ts from "typescript";
import { mapPosition, rewriteSpecifiers, type Bridge, type SpecifierEdit } from "./bridge";
import { resolveAlias, type DeprecatedCallSpan, type ProjectSession, type SessionDiagnostic } from "./program";
import { sliceFor, type SliceKind } from "./sliceMetadata";

export type WorkItem = DeprecatedCallSpan & {
  sliceKind: SliceKind;
  /** Why this site needs migrating (compiler errors, missing exports) */
  notes: string[];
  source: "diagnostic" | "missing_export" | "retired_module" | "test_failure";
};

const MISSING_IMPORT = new Set([2305, 2724, 2307, 1192, 2613, 1259, 2614]);

export function diagnosticKey(d: { file: string; code: number; message: string }): string {
  return `${d.file}|${d.code}|${d.message}`;
}

function inImport(n: ts.Node): ts.ImportDeclaration | ts.ImportEqualsDeclaration | ts.ExportDeclaration | null {
  for (let c: ts.Node | undefined = n; c && !ts.isSourceFile(c); c = c.parent) {
    if (ts.isImportDeclaration(c) || ts.isImportEqualsDeclaration(c) || ts.isExportDeclaration(c)) return c;
  }
  return null;
}

function nodeAt(sf: ts.SourceFile, pos: number): ts.Node {
  let found: ts.Node = sf;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= pos && pos < n.getEnd()) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

function bindingsOf(decl: ts.ImportDeclaration | ts.ImportEqualsDeclaration | ts.ExportDeclaration): ts.Identifier[] {
  if (ts.isImportEqualsDeclaration(decl)) return [decl.name];
  if (ts.isExportDeclaration(decl)) return [];
  const c = decl.importClause;
  const out: ts.Identifier[] = [];
  if (c?.name) out.push(c.name);
  if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) out.push(c.namedBindings.name);
  if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) out.push(...c.namedBindings.elements.map((e) => e.name));
  return out;
}

/** `const x = require("m")` bindings, for CommonJS projects. */
function requireBindings(sf: ts.SourceFile, isTarget: (spec: string) => boolean): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "require" &&
        init.arguments[0] &&
        ts.isStringLiteralLike(init.arguments[0]) &&
        isTarget(init.arguments[0].text)
      ) {
        if (ts.isIdentifier(d.name)) out.push(d.name);
        else for (const el of d.name.elements) if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name)) out.push(el.name);
      }
    }
  }
  return out;
}

/** The smallest sensible slice around `node`. */
export function chooseSlice(sf: ts.SourceFile, node: ts.Node): { start: number; end: number; kind: SliceKind } {
  // Inside a type annotation → type slice.
  for (let c: ts.Node | undefined = node; c && !ts.isSourceFile(c); c = c.parent) {
    if (ts.isTypeNode(c)) {
      const s = sliceFor(sf, { start: c.getStart(sf), end: c.getEnd() }, "type");
      return { start: s.start, end: s.end, kind: "type" };
    }
    if (ts.isStatement(c) || ts.isExpression(c) && !ts.isIdentifier(c) && !ts.isPropertyAccessExpression(c) && !ts.isQualifiedName(c)) break;
  }
  // Callee of a call / new → that call (sliceFor extends through `.promise()` chains).
  for (let c: ts.Node | undefined = node; c && !ts.isSourceFile(c) && !ts.isStatement(c); c = c.parent) {
    const p: ts.Node | undefined = c.parent;
    if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === c) {
      const s = sliceFor(sf, { start: p.getStart(sf), end: p.getEnd() }, "expression");
      return { start: s.start, end: s.end, kind: "expression" };
    }
    if (p && (ts.isArrowFunction(p) || ts.isFunctionExpression(p))) break;
  }
  // Top-level expression: climb while the parent is still an expression, but never out of a function body.
  let cur: ts.Node = node;
  if (ts.isExpression(cur) || ts.isIdentifier(cur)) {
    while (
      cur.parent &&
      ts.isExpression(cur.parent) &&
      !ts.isArrowFunction(cur.parent) &&
      !ts.isFunctionExpression(cur.parent) &&
      !ts.isClassExpression(cur.parent) &&
      !ts.isObjectLiteralExpression(cur.parent)
    ) {
      cur = cur.parent;
    }
    if (ts.isExpression(cur) && !ts.isObjectLiteralExpression(cur)) {
      const s = sliceFor(sf, { start: cur.getStart(sf), end: cur.getEnd() }, "expression");
      return { start: s.start, end: s.end, kind: "expression" };
    }
  }
  const s = sliceFor(sf, { start: node.getStart(sf), end: node.getEnd() }, "statement");
  return { start: s.start, end: s.end, kind: "statement" };
}

export type DiscoverInput = {
  /** Session with the bridge applied (old version visible under its alias) */
  bridged: ProjectSession;
  /** New-version diagnostics of the same files (bridge reverted), from a plain session */
  newWorld: SessionDiagnostic[];
  /** Old-version baseline: diagnostic keys the project already had before the upgrade */
  baseline: Map<string, number>;
  /** Original file text (bridge reverted) per file, to map positions */
  newWorldText: (file: string) => string;
  bridges: Bridge[];
  /** Bridged modules that are being replaced by a different package */
  retired: Bridge[];
  files: string[];
};

/**
 * Split items into those ready now and those that read a variable another
 * item in the batch produces (def-use through a variable initializer).
 * Migrating a consumer before its producer makes the model write against a
 * value that is about to change; deferred items are rediscovered next round.
 */
export function orderByDataFlow(session: ProjectSession, items: WorkItem[]): { ready: WorkItem[]; deferred: WorkItem[] } {
  const checker = session.checker;
  const ready: WorkItem[] = [];
  const deferred: WorkItem[] = [];
  for (const it of items) {
    const sf = session.sourceFile(it.file);
    if (!sf) {
      ready.push(it);
      continue;
    }
    let dependsOn: WorkItem | undefined;
    const visit = (n: ts.Node) => {
      if (dependsOn || n.getEnd() < it.start || n.getStart(sf) > it.end) return;
      if (ts.isIdentifier(n) && n.getStart(sf) >= it.start && n.getEnd() <= it.end) {
        const decl = checker.getSymbolAtLocation(n)?.valueDeclaration;
        const init = decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
        if (init) {
          const f = path.resolve(decl!.getSourceFile().fileName);
          dependsOn = items.find(
            (o) => o !== it && path.resolve(o.file) === f && o.start >= init.getStart(decl!.getSourceFile()) && o.end <= init.getEnd()
          );
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    (dependsOn ? deferred : ready).push(it);
  }
  // A cycle would defer everything; then just go in order.
  return ready.length ? { ready, deferred } : { ready: items, deferred: [] };
}

/**
 * Work items from a failing test run: each failure's first stack frame inside
 * a project file becomes a statement slice, with the runtime error as its note.
 * Understands the `file:line:col` frames printed by vitest, jest, mocha and node.
 */
export function testFailureItems(session: ProjectSession, output: string, files: string[], repoRoot: string, limit = 10): WorkItem[] {
  const byRel = new Map(files.map((f) => [path.relative(repoRoot, f).split(path.sep).join("/"), path.resolve(f)]));
  const resolveFile = (p: string) => byRel.get(p.replace(/^\.\//, "")) ?? byRel.get(path.relative(repoRoot, path.resolve(repoRoot, p)).split(path.sep).join("/"));
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const items: WorkItem[] = [];
  const seen = new Set<string>();
  let message = "";
  for (const line of lines) {
    if (/\b(\w*Error|AssertionError|Expected|expected|Received|toBe|toEqual|TypeError)\b/.test(line) && !/node_modules/.test(line)) message = line.trim().slice(0, 300);
    const m = /((?:\/|\.\/)?[\w@.\/-]+\.(?:ts|tsx|mts|cts)):(\d+):(\d+)/.exec(line);
    if (!m || /node_modules/.test(m[1])) continue;
    const file = resolveFile(m[1]);
    const sf = file ? session.sourceFile(file) : undefined;
    if (!file || !sf) continue;
    const lineNo = Number(m[2]) - 1;
    if (lineNo < 0 || lineNo >= sf.getLineStarts().length) continue;
    const pos = sf.getPositionOfLineAndCharacter(lineNo, 0) + Math.max(0, Number(m[3]) - 1);
    const s = sliceFor(sf, { start: pos, end: pos + 1 }, "statement");
    const key = `${file}:${s.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = sf.getLineAndCharacterOfPosition(s.start);
    const b = sf.getLineAndCharacterOfPosition(s.end);
    items.push({
      fileName: path.basename(file),
      file,
      start: s.start,
      end: s.end,
      startLine: a.line + 1,
      startChar: a.character,
      endLine: b.line + 1,
      endChar: b.character,
      text: s.text,
      kind: "test_failure:statement",
      sliceKind: "statement",
      notes: [`It type-checks, but running the tests fails here at runtime: ${message || "test failure"}`],
      source: "test_failure",
    });
    message = "";
    if (items.length >= limit) break;
  }
  return items;
}

export function discoverWorkItems(input: DiscoverInput): WorkItem[] {
  const { bridged } = input;
  const checker = bridged.checker;
  const files = new Set(input.files.map((f) => path.resolve(f)));
  const aliasMap = Object.fromEntries(input.bridges.map((b) => [b.module, `${b.module}__previous`]));
  const edits = new Map<string, SpecifierEdit[]>();
  const editsFor = (file: string) => {
    if (!edits.has(file)) edits.set(file, rewriteSpecifiers(input.newWorldText(file), file, aliasMap).edits);
    return edits.get(file)!;
  };
  const raw: Array<{ file: string; node: ts.Node; note: string; source: WorkItem["source"] }> = [];
  const missing: Array<{ ident: ts.Identifier; note: string; source: WorkItem["source"] }> = [];

  // 1 + 2: diagnostics against the new version that the old version did not have.
  const remaining = new Map(input.baseline);
  for (const d of input.newWorld) {
    const file = path.resolve(d.file);
    if (!files.has(file) || d.start < 0) continue;
    const k = diagnosticKey(d);
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      continue;
    }
    const sf = bridged.sourceFile(file);
    if (!sf) continue;
    const node = nodeAt(sf, mapPosition(editsFor(file), d.start));
    const imp = inImport(node);
    if (imp) {
      if (!MISSING_IMPORT.has(d.code)) continue;
      // A named element is flagged → only that binding; a whole-module error → every binding.
      const spec = (() => {
        for (let c: ts.Node | undefined = node; c && c !== imp; c = c.parent) if (ts.isImportSpecifier(c)) return c;
        return null;
      })();
      const idents = spec ? [spec.name] : bindingsOf(imp);
      for (const ident of idents) missing.push({ ident, note: `TS${d.code}: ${d.message}`, source: "missing_export" });
      continue;
    }
    raw.push({ file, node, note: `TS${d.code} (new version): ${d.message}`, source: "diagnostic" });
  }

  // 3: retired modules — every binding of theirs is a work item.
  const retiredDirs = input.retired.map((b) => path.resolve(b.previousDir) + path.sep);
  const isRetiredSpec = (spec: string) =>
    input.retired.some((b) => spec === `${b.module}__previous` || spec.startsWith(`${b.module}__previous/`));
  for (const file of files) {
    const sf = bridged.sourceFile(file);
    if (!sf || !input.retired.length) continue;
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && isRetiredSpec(st.moduleSpecifier.text)) {
        const name = st.moduleSpecifier.text.replace("__previous", "");
        for (const ident of bindingsOf(st)) missing.push({ ident, note: `${name} is replaced by a different package after the upgrade; stop using it.`, source: "retired_module" });
      }
    }
    for (const ident of requireBindings(sf, isRetiredSpec)) {
      missing.push({ ident, note: "This package is replaced by a different package after the upgrade; stop using it.", source: "retired_module" });
    }
    // Calls whose callee is declared in the retired package (e.g. a client created elsewhere and passed in).
    const visit = (n: ts.Node) => {
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && !inImport(n)) {
        const e = n.expression;
        const id = ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : null;
        const sym = id ? resolveAlias(checker, checker.getSymbolAtLocation(id)) : undefined;
        const decl = sym?.declarations?.[0];
        if (decl && retiredDirs.some((d) => decl.getSourceFile().fileName.startsWith(d))) {
          raw.push({ file, node: id!, note: `${id!.text} comes from a package that is replaced after the upgrade.`, source: "retired_module" });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Every use of a missing or retired binding.
  for (const m of missing) {
    const sf = m.ident.getSourceFile();
    const sym = checker.getSymbolAtLocation(m.ident);
    if (!sym) continue;
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n !== m.ident && !inImport(n) && checker.getSymbolAtLocation(n) === sym) {
        // Skip the `x` in `const x = require(...)` itself.
        if (!(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
          raw.push({ file: sf.fileName, node: n, note: `\`${m.ident.text}\`: ${m.note}`, source: m.source });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Slice, merge identical slices, drop slices nested in another.
  type Acc = { file: string; start: number; end: number; kind: SliceKind; notes: Set<string>; source: WorkItem["source"] };
  const bySlice = new Map<string, Acc>();
  for (const r of raw) {
    const sf = bridged.sourceFile(r.file)!;
    const s = chooseSlice(sf, r.node);
    const key = `${r.file}:${s.start}:${s.end}`;
    const acc = bySlice.get(key) ?? { file: r.file, ...s, notes: new Set<string>(), source: r.source };
    acc.notes.add(r.note);
    bySlice.set(key, acc);
  }
  const all = [...bySlice.values()].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start || b.end - a.end);
  const kept: Acc[] = [];
  for (const a of all) {
    const container = kept.find((k) => k.file === a.file && k.start <= a.start && a.end <= k.end);
    if (container) {
      a.notes.forEach((n) => container.notes.add(n));
      continue;
    }
    // Partial overlap: keep the first; the next round rediscovers what is left.
    if (kept.some((k) => k.file === a.file && a.start < k.end && k.start < a.end)) continue;
    kept.push(a);
  }

  return kept.map((a) => {
    const sf = bridged.sourceFile(a.file)!;
    const s = sf.getLineAndCharacterOfPosition(a.start);
    const e = sf.getLineAndCharacterOfPosition(a.end);
    return {
      fileName: path.basename(a.file),
      file: a.file,
      start: a.start,
      end: a.end,
      startLine: s.line + 1,
      startChar: s.character,
      endLine: e.line + 1,
      endChar: e.character,
      text: sf.text.slice(a.start, a.end),
      kind: `${a.source}:${a.kind}`,
      sliceKind: a.kind,
      notes: [...a.notes].slice(0, 6),
      source: a.source,
    };
  });
}
