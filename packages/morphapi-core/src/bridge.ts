/**
 * Version bridge. After an upgrade, node_modules holds only the NEW version of
 * the SDK, so the consumer's old code no longer type-checks and the checker
 * cannot tell us what the old calls meant. The bridge loads the PREVIOUS
 * version next to it under an alias (`openai__previous`), rewrites the
 * project's import specifiers to the alias in memory only, and reverts them
 * when the patches are written out. Both versions are then visible to one
 * TypeScript program: old code resolves to the old declarations, new code to
 * the new ones. Works for same-name upgrades (openai 3 → 4) and renames
 * (aws-sdk → @aws-sdk/client-sqs).
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export type Bridge = {
  /** Module name as the project imports it, e.g. "openai" or "aws-sdk" */
  module: string;
  /** Root folder of the previous version's package (contains its package.json) */
  previousDir: string;
};

export const ALIAS_SUFFIX = "__previous";

export function aliasOf(moduleName: string): string {
  return `${moduleName}${ALIAS_SUFFIX}`;
}

/** compilerOptions.paths entries mapping each alias to the previous version. */
export function bridgePaths(bridges: Bridge[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of bridges) {
    const dir = path.resolve(b.previousDir);
    out[aliasOf(b.module)] = [dir];
    out[`${aliasOf(b.module)}/*`] = [`${dir}/*`];
  }
  return out;
}

/**
 * Install `module@version` into a cache folder (outside the project) and
 * return the package root. Install scripts are not run.
 */
export function installPreviousVersion(opts: { module: string; version: string; cacheDir: string; npm?: string }): string {
  const slot = path.join(opts.cacheDir, `${opts.module.replace(/[/@]/g, "_")}@${opts.version}`);
  const pkgDir = path.join(slot, "node_modules", ...opts.module.split("/"));
  if (fs.existsSync(path.join(pkgDir, "package.json"))) return pkgDir;
  fs.mkdirSync(slot, { recursive: true });
  fs.writeFileSync(
    path.join(slot, "package.json"),
    JSON.stringify({ name: "morphapi-bridge", private: true, dependencies: { [opts.module]: opts.version } }, null, 2)
  );
  execFileSync(
    opts.npm ?? "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps", "--omit=dev"],
    { cwd: slot, stdio: "pipe" }
  );
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) throw new Error(`Bridge install failed for ${opts.module}@${opts.version}`);
  return pkgDir;
}

export type SpecifierEdit = { pos: number; del: number; text: string };

function matches(spec: string, from: string): boolean {
  return spec === from || spec.startsWith(`${from}/`);
}

/** String literals that name a module: imports, exports, require(), import(), import types, `declare module`. */
function moduleSpecifierLiterals(sf: ts.SourceFile): ts.StringLiteralLike[] {
  const out: ts.StringLiteralLike[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier);
    } else if (ts.isExternalModuleReference(n) && ts.isStringLiteral(n.expression)) {
      out.push(n.expression);
    } else if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) &&
      n.arguments.length === 1 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      out.push(n.arguments[0]);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      out.push(n.argument.literal);
    } else if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      out.push(n.name);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Rewrite module specifiers (exact name or a subpath of it) through `map`.
 * Returns the new text plus the edits, so positions can be mapped between the
 * two texts with `mapPosition`.
 */
export function rewriteSpecifiers(text: string, fileName: string, map: Record<string, string>): { text: string; edits: SpecifierEdit[] } {
  const froms = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!froms.some((f) => text.includes(f))) return { text, edits: [] };
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: SpecifierEdit[] = [];
  for (const lit of moduleSpecifierLiterals(sf)) {
    const from = froms.find((f) => matches(lit.text, f));
    if (!from) continue;
    const replaced = map[from] + lit.text.slice(from.length);
    // Keep the quotes: edit only the inside of the literal.
    edits.push({ pos: lit.getStart(sf) + 1, del: lit.text.length, text: replaced });
  }
  let out = text;
  for (const e of [...edits].sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.del);
  return { text: out, edits: edits.sort((a, b) => a.pos - b.pos) };
}

/** Position in the original text → position in the rewritten text. */
export function mapPosition(edits: SpecifierEdit[], pos: number): number {
  let shift = 0;
  for (const e of edits) {
    if (e.pos + e.del <= pos) shift += e.text.length - e.del;
    else break;
  }
  return pos + shift;
}

/** Module → alias for every bridge. */
export function toAliasMap(bridges: Bridge[]): Record<string, string> {
  return Object.fromEntries(bridges.map((b) => [b.module, aliasOf(b.module)]));
}

/** Alias → module for every bridge (used when writing patches out). */
export function fromAliasMap(bridges: Bridge[]): Record<string, string> {
  return Object.fromEntries(bridges.map((b) => [aliasOf(b.module), b.module]));
}

/** Module specifiers in `text` that start with one of the aliases. */
export function aliasSpecifiersIn(text: string, fileName: string, bridges: Bridge[]): string[] {
  const aliases = bridges.map((b) => aliasOf(b.module));
  if (!aliases.some((a) => text.includes(a))) return [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  return [...new Set(moduleSpecifierLiterals(sf).map((l) => l.text).filter((t) => aliases.some((a) => matches(t, a))))];
}
