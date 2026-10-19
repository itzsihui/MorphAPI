/**
 * Changed defaults: an option the code does not pass, whose default differs between the previous and the new
 * version of a package. The compiler cannot see this (the option is optional in both versions) and the code's
 * tests usually cannot either. Example (@octokit/webhooks 7 -> 9): `path` defaulted to "/" (Webhooks,
 * createMiddleware: `options.path || "/"`); the new createNodeMiddleware has `{ path = "/api/github/webhooks" }`.
 * Code that calls createNodeMiddleware(webhooks) without `path` now serves a different URL.
 *
 * Only a tool that has both versions installed can see this. MorphAPI's version bridge does.
 *
 * Defaults are read from the packages' JavaScript (what actually runs), not from docs:
 *   function f({ k = <lit> } = {})             destructuring parameter defaults
 *   const { k = <lit> } = options              destructuring of a parameter inside the body
 *   options.k || <lit>,  options.k ?? <lit>     fallbacks on a member of a parameter
 *   Object.assign({ k: <lit> }, options), { k: <lit>, ...options }   defaults objects merged before the options
 * attributed to the enclosing function / method / class (constructor) name.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export type DefaultSite = { fn: string; value: string; file: string };
/** option name -> where a default is defined, per function name */
export type DefaultsTable = Map<string, DefaultSite[]>;

const MAX_FILES = 600;
const MAX_BYTES = 6_000_000;

function packageJsFiles(pkgDir: string): string[] {
  const out: string[] = [];
  let bytes = 0;
  const walk = (d: string) => {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= MAX_FILES || bytes >= MAX_BYTES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(node_modules|test|tests|__tests__|examples?|docs?|benchmarks?|dist-web|esm|es|umd|browser)$/.test(e.name)) walk(p);
      } else if (/\.(c|m)?js$/.test(e.name) && !/\.min\.js$|\.test\.js$|\.spec\.js$/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          if (st.size < 1_500_000) {
            out.push(p);
            bytes += st.size;
          }
        } catch {}
      }
    }
  };
  walk(pkgDir);
  return out;
}

const literalText = (e: ts.Expression, sf: ts.SourceFile): string | null => {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return JSON.stringify(x.text);
  if (ts.isNumericLiteral(x)) return x.text;
  if (ts.isPrefixUnaryExpression(x) && ts.isNumericLiteral(x.operand)) return x.getText(sf);
  if (x.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (x.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (x.kind === ts.SyntaxKind.NullKeyword) return "null";
  if ((ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x)) && x.getText(sf).length <= 60) return x.getText(sf).replace(/\s+/g, " ");
  return null;
};

function enclosingName(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isConstructorDeclaration(p)) {
      const c = p.parent;
      return ts.isClassLike(c) && c.name ? c.name.text : null;
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isPropertyAssignment(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isBinaryExpression(p.parent) && ts.isPropertyAccessExpression(p.parent.left)) return p.parent.left.name.text;
  }
  return null;
}

/** Parameter names of the function enclosing n (incl. names bound by destructuring a parameter). */
function enclosingParams(n: ts.Node): Set<string> {
  const out = new Set<string>();
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) {
      for (const prm of p.parameters) if (ts.isIdentifier(prm.name)) out.add(prm.name.text);
      return out;
    }
  }
  return out;
}

export function extractDefaults(pkgDir: string): DefaultsTable {
  const table: DefaultsTable = new Map();
  const add = (k: string, site: DefaultSite) => {
    const arr = table.get(k) ?? [];
    if (!arr.some((s) => s.fn === site.fn && s.value === site.value)) arr.push(site);
    table.set(k, arr);
  };
  for (const file of packageJsFiles(pkgDir)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/default|\|\||\?\?|=/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const relFile = path.relative(pkgDir, file);
    const visit = (n: ts.Node) => {
      // { k = lit } in a parameter, or const { k = lit } = param
      if (ts.isBindingElement(n) && n.initializer && ts.isObjectBindingPattern(n.parent)) {
        const key = n.propertyName && ts.isIdentifier(n.propertyName) ? n.propertyName.text : ts.isIdentifier(n.name) ? n.name.text : null;
        const v = literalText(n.initializer, sf);
        let pattern: ts.Node = n.parent;
        while (ts.isBindingElement(pattern.parent) && ts.isObjectBindingPattern(pattern.parent.parent)) pattern = pattern.parent.parent; // nested
        const holder = pattern.parent;
        const fromParam = ts.isParameter(holder) || (ts.isVariableDeclaration(holder) && !!holder.initializer && ts.isIdentifier(holder.initializer) && enclosingParams(holder).has(holder.initializer.text));
        const fn = ts.isParameter(holder) ? nameOfFunction(holder.parent) : enclosingName(holder);
        if (key && v != null && fromParam && fn) add(key, { fn, value: v, file: relFile });
      }
      // param.k || lit, param.k ?? lit
      if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        const l = n.left;
        if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) && enclosingParams(n).has(l.expression.text)) {
          const v = literalText(n.right, sf);
          const fn = enclosingName(n);
          if (v != null && fn) add(l.name.text, { fn, value: v, file: relFile });
        }
      }
      // Object.assign({k: lit}, param) and { k: lit, ...param }
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "Object.assign" && n.arguments.length >= 2 && ts.isObjectLiteralExpression(n.arguments[0])) {
        const later = n.arguments.slice(1).some((a) => ts.isIdentifier(a) && enclosingParams(n).has(a.text));
        const fn = enclosingName(n);
        if (later && fn) for (const p of n.arguments[0].properties) addProp(p, fn);
      }
      if (ts.isObjectLiteralExpression(n)) {
        const spreadIdx = n.properties.findIndex((p) => ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression) && enclosingParams(n).has(p.expression.text));
        const fn = spreadIdx > 0 ? enclosingName(n) : null;
        if (fn) for (const p of n.properties.slice(0, spreadIdx)) addProp(p, fn);
      }
      ts.forEachChild(n, visit);
    };
    const addProp = (p: ts.ObjectLiteralElementLike, fn: string) => {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        const v = literalText(p.initializer, sf);
        if (v != null) add(p.name.text, { fn, value: v, file: relFile });
      }
    };
    visit(sf);
  }
  return table;
}

function nameOfFunction(fn: ts.SignatureDeclaration): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (ts.isConstructorDeclaration(fn) && ts.isClassLike(fn.parent) && fn.parent.name) return fn.parent.name.text;
  return enclosingName((((fn as ts.FunctionLikeDeclaration).body as ts.Node | undefined) ?? fn) as ts.Node);
}

export type ChangedDefault = { option: string; fn: string; newValue: string; oldValues: Array<{ fn: string; value: string }> };

/** Options whose default in `fn` (new version) differs from every default the old version had for that option. */
export function changedDefaultsFor(oldT: DefaultsTable, newT: DefaultsTable, fn: string): ChangedDefault[] {
  const out: ChangedDefault[] = [];
  for (const [opt, sites] of newT) {
    for (const s of sites.filter((x) => x.fn === fn)) {
      const old = oldT.get(opt);
      if (!old || !old.length) continue; // no old default to compare with
      const sameFn = old.filter((o) => o.fn === fn);
      const pool = sameFn.length ? sameFn : old; // same function if it existed, else any old function
      if (pool.some((o) => o.value === s.value)) continue;
      out.push({ option: opt, fn, newValue: s.value, oldValues: pool.slice(0, 3).map((o) => ({ fn: o.fn, value: o.value })) });
    }
  }
  return out;
}

export type ChangedDefaultUse = ChangedDefault & { file: string; line: number; module: string };

/**
 * Calls in the project to functions of the upgraded packages (resolved with the type checker, so instance methods
 * count too) that do not pass an option whose default changed.
 */
export function changedDefaultUses(
  program: ts.Program,
  files: string[],
  packages: Array<{ module: string; oldDir: string; newDir: string }>,
  rel: (f: string) => string
): ChangedDefaultUse[] {
  const checker = program.getTypeChecker();
  const tables = packages.map((p) => ({ ...p, oldT: extractDefaults(p.oldDir), newT: extractDefaults(p.newDir) }));
  const out: ChangedDefaultUse[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const sf = program.getSourceFile(path.resolve(f));
    if (!sf) continue;
    const visit = (n: ts.Node) => {
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.expression) {
        const callee = n.expression;
        const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
        if (nameNode) {
          let sym = checker.getSymbolAtLocation(nameNode);
          if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
          const decl = sym?.declarations?.[0];
          const dfile = decl?.getSourceFile().fileName ?? "";
          const pkg = tables.find((t) => dfile.includes(`/node_modules/${t.module}/`) && !dfile.includes("__previous"));
          if (pkg && sym) {
            const fnName = sym.name === "__constructor" || ts.isClassDeclaration(decl!) ? sym.name : sym.name;
            const passed = new Set<string>();
            let opaque = false;
            for (const a of n.arguments ?? []) {
              if (ts.isObjectLiteralExpression(a)) {
                for (const p of a.properties) {
                  if (ts.isSpreadAssignment(p)) opaque = true;
                  else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) passed.add(p.name.text);
                }
              } else if (!ts.isIdentifier(a) || /option|config|opts|settings/i.test(a.text)) {
                // an options value we cannot see into
                const t = checker.getTypeAtLocation(a);
                if (t.getProperties().length && !(t.flags & ts.TypeFlags.Object && checker.getSignaturesOfType(t, ts.SignatureKind.Call).length)) {
                  for (const p of t.getProperties()) if (!(p.flags & ts.SymbolFlags.Optional)) passed.add(p.name);
                  opaque = opaque || t.getProperties().some((p) => !!(p.flags & ts.SymbolFlags.Optional));
                }
              }
            }
            if (!opaque) {
              for (const c of changedDefaultsFor(pkg.oldT, pkg.newT, fnName)) {
                if (passed.has(c.option)) continue;
                const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
                const key = `${rel(f)}:${line}:${c.option}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ ...c, file: rel(f), line, module: pkg.module });
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** All changed defaults of the upgraded packages (for an upfront summary), capped. */
export function changedDefaultsSummary(packages: Array<{ module: string; oldDir: string; newDir: string }>, cap = 20): string[] {
  const out: string[] = [];
  for (const p of packages) {
    const oldT = extractDefaults(p.oldDir);
    const newT = extractDefaults(p.newDir);
    const fns = new Set<string>();
    for (const sites of newT.values()) for (const s of sites) fns.add(s.fn);
    for (const fn of fns) {
      for (const c of changedDefaultsFor(oldT, newT, fn)) {
        out.push(`${p.module}: \`${c.fn}\` option \`${c.option}\` defaults to ${c.newValue}; before: ${c.oldValues.map((o) => `${o.value} (${o.fn})`).join(", ")}`);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}
