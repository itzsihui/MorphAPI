/**
 * Deterministic import reconciliation after a call-site splice: add imports
 * for successor symbols the patch now uses, and drop deprecated-module
 * specifiers that are no longer referenced. No LLM involved.
 */
import * as ts from "typescript";

export type ImportCandidate = {
  module: string;
  name: string;
  kind: "named" | "default";
  typeOnly?: boolean;
};

export type ImportEdits = {
  code: string;
  added: string[];
  removed: string[];
  linesChanged: number;
};

function parse(code: string, fileName: string) {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function moduleOf(decl: ts.ImportDeclaration): string {
  return (decl.moduleSpecifier as ts.StringLiteral).text;
}

/** Local names bound by import declarations. */
function importedLocals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const c = st.importClause;
    if (c.name) out.add(c.name.text);
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) out.add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) out.add(el.name.text);
  }
  return out;
}

/** Names declared in the file (variables, functions, classes, params, types). */
function declaredLocals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      (ts.isVariableDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isParameter(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isEnumDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Identifier uses outside import declarations, excluding property names and keys. */
function referencedNames(sf: ts.SourceFile): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isQualifiedName(p) && p.right === n) ||
        (ts.isPropertySignature(p) && p.name === n) ||
        (ts.isMethodDeclaration(p) && p.name === n);
      if (!isPropName) counts.set(n.text, (counts.get(n.text) ?? 0) + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return counts;
}

function applyEdits(code: string, edits: Array<{ start: number; end: number; text: string }>): string {
  let out = code;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Remove specifiers from `modules` whose local binding is no longer used. */
export function removeUnusedImports(code: string, fileName: string, modules: string[]): { code: string; removed: string[] } {
  const sf = parse(code, fileName);
  const refs = referencedNames(sf);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const removed: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !modules.includes(moduleOf(st))) continue;
    const c = st.importClause;
    const keepDefault = c.name && refs.has(c.name.text) ? c.name.text : null;
    if (c.name && !keepDefault) removed.push(`${moduleOf(st)}#default(${c.name.text})`);
    const nb = c.namedBindings;
    let keepNs: string | null = null;
    let keepNamed: ts.ImportSpecifier[] = [];
    if (nb && ts.isNamespaceImport(nb)) {
      keepNs = refs.has(nb.name.text) ? nb.name.text : null;
      if (!keepNs) removed.push(`${moduleOf(st)}#*(${nb.name.text})`);
    } else if (nb && ts.isNamedImports(nb)) {
      keepNamed = nb.elements.filter((el) => refs.has(el.name.text));
      for (const el of nb.elements) if (!keepNamed.includes(el)) removed.push(`${moduleOf(st)}#${el.name.text}`);
    }
    const unchanged =
      Boolean(keepDefault) === Boolean(c.name) &&
      (nb && ts.isNamespaceImport(nb) ? Boolean(keepNs) : true) &&
      (nb && ts.isNamedImports(nb) ? keepNamed.length === nb.elements.length : true);
    if (unchanged) continue;
    const start = st.getFullStart();
    const end = st.getEnd();
    const lead = code.slice(start, st.getStart(sf));
    if (!keepDefault && !keepNs && !keepNamed.length) {
      const trailingNl = code[end] === "\n" ? 1 : 0;
      edits.push({ start: st.getStart(sf), end: end + trailingNl, text: "" });
      continue;
    }
    const parts: string[] = [];
    if (keepDefault) parts.push(keepDefault);
    if (keepNs) parts.push(`* as ${keepNs}`);
    if (keepNamed.length) parts.push(`{ ${keepNamed.map((el) => el.getText(sf)).join(", ")} }`);
    const typeKw = c.isTypeOnly ? "type " : "";
    edits.push({ start, end, text: `${lead}import ${typeKw}${parts.join(", ")} from ${st.moduleSpecifier.getText(sf)};` });
  }
  return { code: applyEdits(code, edits), removed };
}

/** Add imports for candidates the code references but does not bind. */
export function addMissingImports(code: string, fileName: string, candidates: ImportCandidate[]): { code: string; added: string[] } {
  const sf = parse(code, fileName);
  const refs = referencedNames(sf);
  const bound = new Set([...importedLocals(sf), ...declaredLocals(sf)]);
  const needed = candidates.filter((c) => refs.has(c.name) && !bound.has(c.name));
  if (!needed.length) return { code, added: [] };

  const imports = sf.statements.filter(ts.isImportDeclaration);
  const quote = imports[0]?.moduleSpecifier.getText(sf).startsWith("'") ? "'" : '"';
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const newLines: string[] = [];
  const added: string[] = [];

  const byModule = new Map<string, ImportCandidate[]>();
  for (const c of needed) byModule.set(c.module, [...(byModule.get(c.module) ?? []), c]);

  for (const [mod, list] of byModule) {
    const decl = imports.find((d) => moduleOf(d) === mod && d.importClause && !d.importClause.isTypeOnly);
    const named = list.filter((c) => c.kind === "named");
    const def = list.find((c) => c.kind === "default");
    const spec = (c: ImportCandidate) => (c.typeOnly ? `type ${c.name}` : c.name);
    const nb = decl?.importClause?.namedBindings;
    if (decl && nb && ts.isNamedImports(nb) && named.length) {
      const last = nb.elements[nb.elements.length - 1];
      const at = last ? last.getEnd() : nb.getStart(sf) + 1;
      edits.push({ start: at, end: at, text: `${last ? ", " : " "}${named.map(spec).join(", ")}` });
      added.push(...named.map((c) => `${mod}#${c.name}`));
    } else if (decl && !nb && decl.importClause?.name && named.length) {
      const at = decl.importClause.name.getEnd();
      edits.push({ start: at, end: at, text: `, { ${named.map(spec).join(", ")} }` });
      added.push(...named.map((c) => `${mod}#${c.name}`));
    } else if (named.length) {
      newLines.push(`import { ${named.map(spec).join(", ")} } from ${quote}${mod}${quote};`);
      added.push(...named.map((c) => `${mod}#${c.name}`));
    }
    if (def && !(decl?.importClause?.name)) {
      newLines.push(`import ${def.name} from ${quote}${mod}${quote};`);
      added.push(`${mod}#default(${def.name})`);
    }
  }

  let out = applyEdits(code, edits);
  if (newLines.length) {
    const sf2 = parse(out, fileName);
    const lastImport = [...sf2.statements].filter(ts.isImportDeclaration).pop();
    const at = lastImport ? lastImport.getEnd() : 0;
    const text = lastImport ? `\n${newLines.join("\n")}` : `${newLines.join("\n")}\n`;
    out = out.slice(0, at) + text + out.slice(at);
  }
  return { code: out, added };
}

/**
 * Move imports of names that exist in both modules (e.g. a client factory
 * `createS3Client`) from the deprecated module to the successor, so the
 * values they produce get successor types. `exclude` keeps names that still
 * have unmigrated call sites.
 */
export function swapSharedImports(
  code: string,
  fileName: string,
  opts: { from: string; to: string; shared: { named: string[]; hasDefault: boolean }; exclude?: string[] }
): { code: string; moved: string[] } {
  const sf = parse(code, fileName);
  const exclude = new Set(opts.exclude ?? []);
  const shared = new Set(opts.shared.named);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const moved: string[] = [];
  const quoteOf = (d: ts.ImportDeclaration) => (d.moduleSpecifier.getText(sf).startsWith("'") ? "'" : '"');
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || moduleOf(st) !== opts.from || !st.importClause) continue;
    const c = st.importClause;
    const kw = c.isTypeOnly ? "import type" : "import";
    const moveDefault = Boolean(c.name && opts.shared.hasDefault && !exclude.has(c.name.text) && !exclude.has("default"));
    const nb = c.namedBindings;
    const named = nb && ts.isNamedImports(nb) ? [...nb.elements] : [];
    const moveNamed = named.filter((el) => shared.has((el.propertyName ?? el.name).text) && !exclude.has((el.propertyName ?? el.name).text));
    if (!moveDefault && !moveNamed.length) continue;
    const keepNamed = named.filter((el) => !moveNamed.includes(el));
    const q = quoteOf(st);
    const build = (mod: string, def: string | null, ns: string | null, els: ts.ImportSpecifier[]) => {
      const parts: string[] = [];
      if (def) parts.push(def);
      if (ns) parts.push(`* as ${ns}`);
      if (els.length) parts.push(`{ ${els.map((el) => el.getText(sf)).join(", ")} }`);
      return parts.length ? `${kw} ${parts.join(", ")} from ${q}${mod}${q};` : "";
    };
    const nsName = nb && ts.isNamespaceImport(nb) ? nb.name.text : null;
    const keep = build(opts.from, moveDefault ? null : (c.name?.text ?? null), nsName, keepNamed);
    const move = build(opts.to, moveDefault ? c.name!.text : null, null, moveNamed);
    if (moveDefault) moved.push(`default(${c.name!.text})`);
    moved.push(...moveNamed.map((el) => el.name.text));
    edits.push({ start: st.getStart(sf), end: st.getEnd(), text: [keep, move].filter(Boolean).join("\n") });
  }
  return { code: applyEdits(code, edits), moved };
}

function changedLines(a: string, b: string): number {
  const la = a.split("\n");
  const lb = b.split("\n");
  const setA = new Map<string, number>();
  for (const l of la) setA.set(l, (setA.get(l) ?? 0) + 1);
  let common = 0;
  for (const l of lb) {
    const n = setA.get(l) ?? 0;
    if (n > 0) {
      common++;
      setA.set(l, n - 1);
    }
  }
  return la.length - common + (lb.length - common);
}

/** Header splice: add successor imports, then clean deprecated ones. */
export function reconcileImports(
  code: string,
  fileName: string,
  opts: { add: ImportCandidate[]; cleanupModules: string[] }
): ImportEdits {
  const a = addMissingImports(code, fileName, opts.add);
  const r = removeUnusedImports(a.code, fileName, opts.cleanupModules);
  return { code: r.code, added: a.added, removed: r.removed, linesChanged: changedLines(code, r.code) };
}
