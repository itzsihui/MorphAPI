/**
 * Behaviour checks: what a migration can break while the compiler stays silent.
 *
 * Observed in held-out runs (supabase-js v1→v2, all six agent runs): the code type-checked, yet
 *  - a wrapper that the new version still exports (`withApiAuth`) was dropped, so unauthenticated
 *    requests were no longer rejected;
 *  - a file serving a route was deleted while a link to that route remained (`/api/auth/logout`);
 *  - an instruction in the migration guide that applied to the project was not followed.
 * None of these is a type error. The checks below report them as items to confirm, not as errors:
 * each may be intended, but each must be a decision rather than an accident.
 *
 *  1. droppedUses       — uses of an upgraded package's export that still exists in the new version
 *                         were removed (project-wide count fell).
 *  2. danglingRefs      — a deleted file is still referenced: by path (strings, configs, scripts) or,
 *                         for file-routed frameworks (Next.js pages/ and app/), by a URL it served.
 *  3. guideChecklist    — guide sentences that say an API was removed/renamed/replaced, whose old
 *                         names occur in the project's code at the start; still open while they remain.
 *  4. publicApiChanges  — the project's own exported surface changed: an export, a member of an
 *                         exported type, or a parameter was removed (or became required). For a
 *                         library this is a breaking change for its users; for an app it is a hint
 *                         that behaviour moved.
 */
import * as path from "path";
import * as ts from "typescript";

export type BehaviourFinding = { check: "dropped_use" | "dangling_ref" | "guide" | "public_api"; file?: string; line?: number; message: string };

type Texts = Record<string, string>; // relative path → text

const isCode = (f: string) => /\.(m|c)?[jt]sx?$/.test(f) && !/\.d\.ts$/.test(f);
const kindOf = (f: string) => (/\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.jsx$/.test(f) ? ts.ScriptKind.JSX : /\.(m|c)?js$/.test(f) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const parse = (f: string, text: string) => ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kindOf(f));
const lineAt = (text: string, pos: number) => text.slice(0, pos).split("\n").length;

// ---------------------------------------------------------------- 1. dropped uses

type Use = { name: string; module: string; file: string; line: number };

/** Uses (not the import itself) of names imported from `modules`, incl. `ns.name` for namespace imports. */
export function importedUses(files: Texts, modules: string[]): Use[] {
  const out: Use[] = [];
  const fromUpgraded = (spec: string) => modules.some((m) => spec === m || spec.startsWith(`${m}/`));
  for (const [file, text] of Object.entries(files)) {
    if (!isCode(file)) continue;
    const sf = parse(file, text);
    const locals = new Map<string, { name: string; module: string }>();
    const namespaces = new Map<string, string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !fromUpgraded(st.moduleSpecifier.text)) continue;
      const mod = st.moduleSpecifier.text;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) locals.set(el.name.text, { name: (el.propertyName ?? el.name).text, module: mod });
      if (nb && ts.isNamespaceImport(nb)) namespaces.set(nb.name.text, mod);
    }
    // require('x').name and const { a } = require('x') are rare in TS projects; not handled.
    if (!locals.size && !namespaces.size) continue;
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isMember = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n) || (ts.isPropertyAssignment(p) && p.name === n);
        if (!isMember && locals.has(n.text) && !inTypePosition(n)) {
          const l = locals.get(n.text)!;
          out.push({ ...l, file, line: lineAt(text, n.getStart(sf)) });
        }
      }
      if ((ts.isPropertyAccessExpression(n) || ts.isQualifiedName(n)) && ts.isIdentifier(ts.isPropertyAccessExpression(n) ? n.expression : n.left)) {
        const left = (ts.isPropertyAccessExpression(n) ? n.expression : n.left) as ts.Identifier;
        const right = ts.isPropertyAccessExpression(n) ? n.name : n.right;
        if (namespaces.has(left.text) && ts.isIdentifier(right) && !inTypePosition(n)) out.push({ name: right.text, module: namespaces.get(left.text)!, file, line: lineAt(text, n.getStart(sf)) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Inside a type annotation / type argument / type declaration: removing such a use cannot remove behaviour. */
function inTypePosition(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isHeritageClause(p) && p.token === ts.SyntaxKind.ImplementsKeyword) return true;
    if (ts.isExpression(p) && !ts.isExpressionWithTypeArguments(p)) return false;
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Names the new version no longer exports, read from new-version diagnostics on the start code. */
export function namesMissingInNewVersion(messages: string[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    for (const re of [/has no exported member(?: named)? '([^']+)'/g, /'([^']+)' is not (?:a )?(?:named )?export/g]) {
      let x: RegExpExecArray | null;
      while ((x = re.exec(m))) out.add(x[1]);
    }
  }
  return out;
}

export function droppedUses(start: Texts, now: Texts, modules: string[], missingInNew: Set<string>): BehaviourFinding[] {
  const before = importedUses(start, modules);
  const after = importedUses(now, modules);
  const count = (us: Use[]) => {
    const m = new Map<string, Use[]>();
    for (const u of us) {
      const k = `${u.module}|${u.name}`;
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    return m;
  };
  const b = count(before);
  const a = count(after);
  const out: BehaviourFinding[] = [];
  for (const [k, uses] of b) {
    const [module, name] = k.split("|");
    if (missingInNew.has(name)) continue; // gone from the new version: replacing it is the migration
    const left = a.get(k)?.length ?? 0;
    if (left >= uses.length) continue;
    // Report the start sites in files whose count fell.
    const perFileNow = new Map<string, number>();
    for (const u of a.get(k) ?? []) perFileNow.set(u.file, (perFileNow.get(u.file) ?? 0) + 1);
    const perFileStart = new Map<string, Use[]>();
    for (const u of uses) perFileStart.set(u.file, [...(perFileStart.get(u.file) ?? []), u]);
    const sites: string[] = [];
    for (const [f, us] of perFileStart) if ((perFileNow.get(f) ?? 0) < us.length) sites.push(...us.map((u) => `${u.file}:${u.line}`));
    out.push({
      check: "dropped_use",
      file: sites[0]?.split(":")[0],
      message: `\`${name}\` from ${module} still exists in the new version, but your edits removed ${uses.length - left} of its ${uses.length} use(s) (originally at ${sites.slice(0, 6).join(", ")}). If it provided behaviour (authentication, validation, error handling, retries, cleanup), keep it or reproduce that behaviour; if removing it is intended, ignore this.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 2. dangling references

/** URL pattern served by a file-routed page (Next.js pages/ or app/), or null. */
export function routeOf(file: string): RegExp | null {
  let m = /^(?:src\/)?pages\/(.+)\.(?:[jt]sx?|mdx)$/.exec(file);
  let segs: string[] | null = null;
  if (m && !/^_(app|document|error)$/.test(m[1]) && !/(^|\/)_/.test(m[1])) segs = m[1].split("/");
  m = /^(?:src\/)?app\/(.*?)\/?(?:page|route)\.(?:[jt]sx?)$/.exec(file);
  if (!segs && m) segs = m[1] ? m[1].split("/").filter((s) => !/^\(.*\)$/.test(s)) : [];
  if (!segs) return null;
  if (segs[segs.length - 1] === "index") segs.pop();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (const s of segs) {
    if (/^\[\[\.\.\..+\]\]$/.test(s)) re += "(?:/[^\\s?#\"'`]*)?";
    else if (/^\[\.\.\..+\]$/.test(s)) re += "/[^\\s?#\"'`]+";
    else if (/^\[.+\]$/.test(s)) re += "/[^/\\s?#\"'`]+";
    else re += `/${esc(s)}`;
  }
  return new RegExp(`^${re || "/"}/?(?:[?#].*)?$`);
}

const STRING_LIT = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

export function danglingRefs(start: Texts, now: Texts): BehaviourFinding[] {
  const deleted = Object.keys(start).filter((f) => !(f in now));
  if (!deleted.length) return [];
  const out: BehaviourFinding[] = [];
  const liveRoutes = Object.keys(now).map(routeOf).filter((r): r is RegExp => !!r);
  for (const del of deleted) {
    const noExt = del.replace(/\.[^./]+$/, "");
    const route = routeOf(del);
    for (const [f, text] of Object.entries(now)) {
      if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f) || f === "MIGRATION_GUIDE.md") continue;
      let x: RegExpExecArray | null;
      STRING_LIT.lastIndex = 0;
      while ((x = STRING_LIT.exec(text))) {
        const s = x[2];
        // (a) by path: relative to the referencing file, or to the project root
        let hit = false;
        if (/^\.{1,2}\//.test(s) || s.startsWith("/") === false) {
          const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), s)).replace(/\.[^./]+$/, "");
          const fromRoot = path.posix.normalize(s.replace(/^\.\//, "")).replace(/\.[^./]+$/, "");
          if ((s.includes("/") || s.includes(".")) && (rel === noExt || fromRoot === noExt || rel === del || fromRoot === del)) hit = true;
        }
        if (hit) {
          out.push({ check: "dangling_ref", file: f, line: lineAt(text, x.index), message: `${f}:${lineAt(text, x.index)} refers to \`${s}\`, but you deleted ${del}.` });
          continue;
        }
        // (b) by URL served by the deleted page/route
        if (route && s.startsWith("/") && route.test(s) && !liveRoutes.some((r) => r.test(s))) {
          out.push({ check: "dangling_ref", file: f, line: lineAt(text, x.index), message: `${f}:${lineAt(text, x.index)} links to \`${s}\`, which was served by ${del}; you deleted that file and nothing serves the URL now (a 404 at runtime). Update the link or replace what the route did.` });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. guide checklist

export type GuideItem = { text: string; oldTokens: string[] };

const REMOVAL = /\b(removed|no longer|deprecated|dropped|replaced|renamed|instead of|not supported|has been moved|have been moved|moved to|in favou?r of|is gone|are gone)\b/i;
const GENERIC = new Set(["true", "false", "null", "undefined", "string", "number", "boolean", "any", "unknown", "object", "void", "await", "async", "import", "export", "require", "new", "this", "function", "const", "let", "var", "return"]);

function cleanToken(t: string): string | null {
  let s = t.trim().replace(/\(\s*\)$/, "").replace(/<[^>]*>$/, "").replace(/;$/, "");
  if (/^(npm|yarn|pnpm|npx)\s/.test(s) || /\s/.test(s.replace(/\s*=\s*/, "="))) return null;
  if (s.length < 3 || GENERIC.has(s)) return null;
  if (/^[a-z]{1,4}$/.test(s)) return null; // short plain words (`auth`, `data`) match everywhere
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(s)) return null; // unscoped package names (`supabase-js`)
  if (/^@?[\w.-]+\/[\w.-]+(@[\w.^~-]+)?$/.test(s) && !s.startsWith("/")) return null; // a package name
  if (/^\^?\d/.test(s)) return null; // a version
  return s;
}

/** Guide sentences that retire an API, with the old names they mention. */
export function guideItems(guide: string): GuideItem[] {
  const noCode = guide
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\]\([^)\s]*\)/g, "]") // markdown link targets (`#strictquery-is-removed-...` anchors are not prose)
    .replace(/\{#[^}]*\}/g, " "); // heading ids
  const blocks = noCode.split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)|\n(?=#+\s)/);
  const items: GuideItem[] = [];
  for (const block of blocks) {
    const text = block.replace(/\s+/g, " ").trim();
    if (!text || !REMOVAL.test(text)) continue;
    const old = new Set<string>();
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z`])/)) {
      const m = REMOVAL.exec(sentence);
      if (!m) continue;
      const kw = m[1].toLowerCase();
      // "use `b` instead of `a`" → old after the keyword; "`a` was replaced by/in favour of `b`" → old before
      const part = kw === "instead of" ? sentence.slice(m.index) : sentence.slice(0, m.index) || sentence;
      for (const c of part.matchAll(/`([^`\n]+)`/g)) {
        const t = cleanToken(c[1]);
        if (t) old.add(t);
      }
    }
    if (old.size) items.push({ text: text.slice(0, 400), oldTokens: [...old] });
  }
  return items;
}

/** Where a token occurs in code (identifier/member chains and string contents; comments ignored). */
/** Names the file declares itself (variables, parameters, destructuring, functions, classes); imports excluded. */
function localDeclarations(file: string, text: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name && ts.isIdentifier(n.name)) out.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(parse(file, text));
  return out;
}

export function tokenSites(files: Texts, token: string): string[] {
  const sites: string[] = [];
  const plainIdent = /^[A-Za-z_$][\w$]*$/.test(token);
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w$])${esc}(?![\\w$])`, "g");
  for (const [f, text] of Object.entries(files)) {
    if (!isCode(f)) continue;
    // A name the file declares itself is the project's own variable, not the retired API (e.g. `const supabaseClient = useSupabaseClient()`).
    if (plainIdent && text.includes(token) && localDeclarations(f, text).has(token)) continue;
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, (c, p) => p + " ".repeat(c.length - p.length));
    let x: RegExpExecArray | null;
    while ((x = re.exec(stripped))) {
      if (plainIdent) {
        // A retired export is a free name: skip member names (`a.x`), object/destructuring keys (`x:`) and JSX props (`x=`).
        const before = stripped.slice(Math.max(0, x.index - 2), x.index);
        const after = stripped.slice(x.index + token.length, x.index + token.length + 3);
        if (/\.\s*$/.test(before) || /^\s*:(?!:)/.test(after) && /[{,]\s*$/.test(stripped.slice(Math.max(0, x.index - 40), x.index)) || /^\s*=(?![=>])/.test(after) && /[\s{(]$/.test(before) && /<[\w.]+[^<>]*$/.test(stripped.slice(Math.max(0, x.index - 300), x.index))) continue;
      }
      sites.push(`${f}:${lineAt(text, x.index)}`);
    }
  }
  return sites;
}

export function guideChecklist(items: GuideItem[], start: Texts, now: Texts): { applies: GuideItem[]; open: Array<{ item: GuideItem; sites: string[] }> } {
  const applies = items.filter((it) => it.oldTokens.some((t) => tokenSites(start, t).length));
  const open: Array<{ item: GuideItem; sites: string[] }> = [];
  for (const it of applies) {
    const sites = it.oldTokens.flatMap((t) => tokenSites(now, t).map((s) => `${s} \`${t}\``));
    if (sites.length) open.push({ item: it, sites });
  }
  return { applies, open };
}

// ---------------------------------------------------------------- 4. public API changes

/** Source files behind package.json's entry points (types/main/module/exports), mapped from build output to src. */
export function packageEntryFiles(projectDir: string, files: string[]): string[] {
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(require("fs").readFileSync(path.join(projectDir, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const specs: string[] = [];
  for (const k of ["types", "typings", "main", "module"]) if (typeof pkg[k] === "string") specs.push(pkg[k] as string);
  const ex = pkg.exports as unknown;
  const collect = (v: unknown) => {
    if (typeof v === "string") specs.push(v);
    else if (v && typeof v === "object") for (const x of Object.values(v as object)) collect(x);
  };
  if (ex && typeof ex === "object" && "." in (ex as object)) collect((ex as Record<string, unknown>)["."]);
  else collect(ex);
  const have = new Set(files.map((f) => path.resolve(f)));
  const out = new Set<string>();
  for (const sp of specs) {
    const base = sp.replace(/^\.\//, "").replace(/\.d\.ts$|\.(m|c)?js$/, "");
    for (const cand of [base, base.replace(/^(lib|dist|build|out)\//, "src/"), base.replace(/^(lib|dist|build|out)\//, "")]) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const p = path.resolve(projectDir, cand + ext);
        if (have.has(p)) out.add(p);
      }
    }
  }
  return [...out];
}

type Surface = Map<string, { kind: string; members: Map<string, boolean>; params: Array<{ name: string; optional: boolean }> | null; file: string; line: number }>;

/** Exported surface of the project's own files: export → members (name → optional) and parameters. */
export function exportedSurface(program: ts.Program, files: string[], rel: (f: string) => string, entryFiles: string[] = []): Surface {
  const checker = program.getTypeChecker();
  const out: Surface = new Map();
  const own = new Set(files.map((f) => path.resolve(f)));
  // Public = imported by another project file, or exposed by the package entry point.
  const publicKeys = new Set<string>();
  const keyOf = (sym: ts.Symbol, name: string) => {
    const d = sym.declarations?.[0];
    return d ? `${rel(d.getSourceFile().fileName)}#${name}` : null;
  };
  for (const f of files) {
    const sf = program.getSourceFile(path.resolve(f));
    if (!sf) continue;
    const isEntry = entryFiles.some((e) => path.resolve(e) === path.resolve(f));
    if (isEntry) {
      const mod = checker.getSymbolAtLocation(sf);
      for (const ex of mod ? checker.getExportsOfModule(mod) : []) {
        const sym = ex.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ex) : ex;
        const k = keyOf(sym, sym.name === "default" || ex.name === "default" ? "default" : ex.flags & ts.SymbolFlags.Alias ? sym.name : ex.name);
        if (k) publicKeys.add(k);
        if (ex.flags & ts.SymbolFlags.Alias) { const k2 = keyOf(sym, ex.name); if (k2) publicKeys.add(k2); }
      }
    }
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
      const visit = (n: ts.Node) => {
        if (ts.isImportSpecifier(n) || ts.isExportSpecifier(n) || ts.isImportClause(n)) {
          const id = ts.isImportClause(n) ? n.name : n.name;
          const s0 = id && checker.getSymbolAtLocation(id);
          if (s0 && s0.flags & ts.SymbolFlags.Alias) {
            const t = checker.getAliasedSymbol(s0);
            const d = t.declarations?.[0];
            if (d && own.has(path.resolve(d.getSourceFile().fileName))) {
              const name = ts.isImportClause(n) ? "default" : (n.propertyName ?? n.name).text;
              publicKeys.add(`${rel(d.getSourceFile().fileName)}#${name}`);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(st);
    }
  }
  for (const f of files) {
    const sf = program.getSourceFile(path.resolve(f));
    if (!sf || sf.isDeclarationFile) continue;
    const mod = checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (const ex of checker.getExportsOfModule(mod)) {
      const sym = ex.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ex) : ex;
      const decl = sym.declarations?.[0];
      if (!decl || path.resolve(decl.getSourceFile().fileName) !== path.resolve(sf.fileName)) continue; // re-exports: counted where declared
      const members = new Map<string, boolean>();
      let params: Array<{ name: string; optional: boolean }> | null = null;
      let kind = ts.SyntaxKind[decl.kind];
      const declaredHere = (p: ts.Symbol) => (p.declarations ?? []).some((d) => own.has(path.resolve(d.getSourceFile().fileName)));
      if (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) {
        const t = checker.getDeclaredTypeOfSymbol(sym);
        for (const p of checker.getPropertiesOfType(t)) if (declaredHere(p)) members.set(p.name, !!(p.flags & ts.SymbolFlags.Optional));
        if (ts.isClassDeclaration(decl)) {
          const ctor = checker.getTypeOfSymbolAtLocation(sym, decl).getConstructSignatures()[0];
          if (ctor) params = ctor.getParameters().map((p) => ({ name: p.name, optional: isOptionalParam(p) }));
        }
      } else {
        const t = checker.getTypeOfSymbolAtLocation(sym, decl);
        const sig = t.getCallSignatures()[0];
        if (sig) {
          kind = "function";
          params = sig.getParameters().map((p) => ({ name: p.name, optional: isOptionalParam(p) }));
        }
      }
      if (!publicKeys.has(`${rel(f)}#${ex.name}`)) continue;
      out.set(`${rel(f)}#${ex.name}`, { kind, members, params, file: rel(f), line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1 });
    }
  }
  return out;
}

function isOptionalParam(p: ts.Symbol): boolean {
  const d = p.valueDeclaration;
  return !!d && ts.isParameter(d) && (!!d.questionToken || !!d.initializer || !!d.dotDotDotToken);
}

export function publicApiChanges(before: Surface, after: Surface): BehaviourFinding[] {
  const out: BehaviourFinding[] = [];
  const afterByName = new Map<string, string>();
  for (const k of after.keys()) afterByName.set(k.split("#")[1], k);
  for (const [k, b] of before) {
    const name = k.split("#")[1];
    const a = after.get(k) ?? (afterByName.has(name) ? after.get(afterByName.get(name)!) : undefined);
    if (!a) {
      out.push({ check: "public_api", file: b.file, line: b.line, message: `the exported \`${name}\` (${b.file}:${b.line}) no longer exists; code that imports it will break.` });
      continue;
    }
    for (const [m, opt] of b.members) {
      if (!a.members.has(m)) out.push({ check: "public_api", file: a.file, line: a.line, message: `\`${m}\` was removed from the exported \`${name}\` (${a.file}:${a.line}); callers that pass or read it will break or be ignored silently.` });
      else if (opt && a.members.get(m) === false) out.push({ check: "public_api", file: a.file, line: a.line, message: `\`${name}.${m}\` became required (${a.file}:${a.line}).` });
    }
    if (b.params && a.params) {
      const bn = b.params.map((p) => p.name);
      for (const p of b.params) if (!a.params.some((q) => q.name === p.name) && a.params.length < b.params.length) out.push({ check: "public_api", file: a.file, line: a.line, message: `parameter \`${p.name}\` was removed from the exported \`${name}\` (${a.file}:${a.line}).` });
      a.params.forEach((q, i) => {
        if (!q.optional && (i >= bn.length || b.params![i].optional)) out.push({ check: "public_api", file: a.file, line: a.line, message: `parameter \`${q.name}\` of the exported \`${name}\` is now required (${a.file}:${a.line}); existing callers do not pass it.` });
      });
    }
  }
  return out;
}
