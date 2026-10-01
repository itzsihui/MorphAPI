/**
 * Oracle derived from the successor package's declarations instead of a
 * hand-written JSON file: exported names plus members of reachable types.
 */
import * as ts from "typescript";
import type { ImportCandidate } from "./importReconcile";
import { resolveAlias, resolveModuleFile, type ProjectSession } from "./program";

export type OracleExport = {
  /** Name to import (class name for a default-exported class) */
  name: string;
  kind: "named" | "default";
  typeOnly: boolean;
  signature: string;
};

export type ExtractedOracle = {
  module: string;
  moduleFile: string;
  exports: OracleExport[];
  /** Type or export name → member names */
  members: Record<string, string[]>;
  /** Flat allow-list: names, members, and "Type.member" */
  allowed: string[];
  /** Type name → how to get a value of it (constructor or factory signature) */
  obtain: Record<string, string>;
};

function unwrapPromise(checker: ts.TypeChecker, t: ts.Type): ts.Type {
  const sym = t.getSymbol();
  if (sym?.name === "Promise") {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    if (args[0]) return args[0];
  }
  return t;
}

export function extractOracle(session: ProjectSession, moduleName: string, fromFile: string): ExtractedOracle | null {
  const moduleFile = resolveModuleFile(moduleName, fromFile, session.options, session.sourceFile(fromFile)?.impliedNodeFormat);
  if (!moduleFile) return null;
  if (!session.sourceFile(moduleFile)) session.addRootFiles([moduleFile]);
  const checker = session.checker;
  const sf = session.sourceFile(moduleFile);
  const modSym = sf && checker.getSymbolAtLocation(sf);
  if (!sf || !modSym) return null;

  const exports: OracleExport[] = [];
  const members: Record<string, string[]> = {};
  const obtain: Record<string, string> = {};
  const seenTypes = new Set<ts.Type>();

  const collectMembers = (label: string, t: ts.Type, depth: number) => {
    if (depth > 2 || seenTypes.has(t)) return;
    seenTypes.add(t);
    const props = t.getProperties();
    if (!props.length) return;
    members[label] = [...new Set([...(members[label] ?? []), ...props.map((p) => p.name)])];
    for (const p of props) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      if (!decl) continue;
      const pt = checker.getTypeOfSymbolAtLocation(p, decl);
      for (const sig of pt.getCallSignatures()) {
        const ret = unwrapPromise(checker, sig.getReturnType());
        const rs = ret.getSymbol();
        if (rs && !rs.name.startsWith("__")) collectMembers(rs.name, ret, depth + 1);
      }
      const ps = pt.getSymbol();
      if (ps && ps.name === "__object") collectMembers(`${label}.${p.name}`, pt, depth + 1);
    }
  };

  for (const raw of checker.getExportsOfModule(modSym)) {
    const sym = resolveAlias(checker, raw) ?? raw;
    const isDefault = raw.name === "default";
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    const declName = decl && ts.getNameOfDeclaration(decl);
    const name = isDefault ? (sym.name !== "default" ? sym.name : declName && ts.isIdentifier(declName) ? declName.text : "default") : raw.name;
    if (name.startsWith("__")) continue;
    const typeOnly = !(sym.flags & ts.SymbolFlags.Value);
    const valueType = decl && !typeOnly ? checker.getTypeOfSymbolAtLocation(sym, decl) : undefined;
    exports.push({
      name,
      kind: isDefault ? "default" : "named",
      typeOnly,
      signature: valueType ? checker.typeToString(valueType) : checker.typeToString(checker.getDeclaredTypeOfSymbol(sym)),
    });
    if (sym.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.Enum | ts.SymbolFlags.TypeAlias)) {
      collectMembers(name, checker.getDeclaredTypeOfSymbol(sym), 0);
    }
    if (valueType) {
      const statics = valueType.getProperties().map((p) => p.name).filter((n) => n !== "prototype");
      if (statics.length && !(sym.flags & ts.SymbolFlags.Enum)) members[name] = [...new Set([...(members[name] ?? []), ...statics])];
      for (const sig of valueType.getCallSignatures()) {
        const ret = unwrapPromise(checker, sig.getReturnType());
        const rs = ret.getSymbol();
        if (rs && !rs.name.startsWith("__")) collectMembers(rs.name, ret, 1);
      }
      for (const sig of valueType.getConstructSignatures()) {
        collectMembers(name, sig.getReturnType(), 1);
        obtain[checker.typeToString(sig.getReturnType())] ??= `new ${name}${checker.signatureToString(sig)}`;
      }
      for (const sig of valueType.getCallSignatures()) {
        const ret = checker.typeToString(unwrapPromise(checker, sig.getReturnType()));
        obtain[ret] ??= `${name}${checker.signatureToString(sig)}`;
      }
      if (valueType.getSymbol()?.name === "__object") collectMembers(name, valueType, 1);
    }
  }

  const allowed = new Set<string>();
  for (const e of exports) if (e.name !== "default") allowed.add(e.name);
  for (const [owner, ms] of Object.entries(members)) {
    for (const m of ms) {
      allowed.add(m);
      allowed.add(`${owner}.${m}`);
    }
  }
  return { module: moduleName, moduleFile, exports, members, allowed: [...allowed].sort(), obtain };
}

/** Import candidates for importReconcile from an extracted oracle. */
export function importCandidates(oracle: ExtractedOracle): ImportCandidate[] {
  const named = new Set(oracle.exports.filter((e) => e.kind === "named").map((e) => e.name));
  return oracle.exports
    .filter((e) => e.name !== "default" && (e.kind === "named" || !named.has(e.name)))
    .map((e) => ({ module: oracle.module, name: e.name, kind: e.kind, typeOnly: e.typeOnly }));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Closest valid names: case-insensitive exact match first, then edit
 * distance, with a bonus for `preferred` (successor exports) and for names
 * sharing a prefix or substring with the phantom.
 */
export function suggestSymbols(phantom: string, candidates: string[], k = 3, preferred: string[] = []): string[] {
  const base = phantom.includes(".") ? phantom.split(".").pop()! : phantom;
  const lower = base.toLowerCase();
  const pref = new Set(preferred);
  const uniq = [...new Set(candidates.filter((c) => !c.includes(".")))];
  const exact = uniq.filter((c) => c.toLowerCase() === lower && c !== base);
  const related = (c: string) => {
    const l = c.toLowerCase();
    return l.length >= 3 && (lower.startsWith(l.slice(0, 3)) || lower.includes(l) || l.includes(lower));
  };
  const ranked = uniq
    .filter((c) => !exact.includes(c) && c !== base)
    .map((c) => ({ c, d: levenshtein(lower, c.toLowerCase()) - (pref.has(c) ? 2 : 0) - (related(c) ? 2 : 0) }))
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .map((x) => x.c);
  return [...exact, ...ranked].slice(0, k);
}
