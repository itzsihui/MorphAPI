/**
 * Program layer — builds a real ts.Program + TypeChecker from a project's
 * tsconfig.json so graphs, slices and oracles see resolved types instead of
 * guessing from text.
 */
import * as path from "path";
import * as ts from "typescript";

export type LoadedProgram = {
  program: ts.Program;
  checker: ts.TypeChecker;
  options: ts.CompilerOptions;
  configPath: string;
  projectDir: string;
  rootFiles: string[];
  configErrors: string[];
};

function formatDiagnostic(d: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(d.messageText, "\n");
}

/**
 * Load a project from its tsconfig.json. `extends`, `paths`, `baseUrl`,
 * `include`/`exclude` and module resolution are resolved by TypeScript itself.
 */
export function loadProgram(
  tsconfigPath: string,
  opts: { extraRootFiles?: string[] } = {}
): LoadedProgram {
  const configPath = path.resolve(tsconfigPath);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `Cannot read ${configPath}: ${formatDiagnostic(read.error)}`
    );
  }
  const projectDir = path.dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    projectDir,
    undefined,
    configPath
  );
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
  const rootFiles = [...parsed.fileNames, ...(opts.extraRootFiles ?? [])];
  const host = ts.createCompilerHost(options, true);
  const program = ts.createProgram({ rootNames: rootFiles, options, host });
  return {
    program,
    checker: program.getTypeChecker(),
    options,
    configPath,
    projectDir,
    rootFiles,
    configErrors: parsed.errors.map(formatDiagnostic),
  };
}

/** Walk upward from `startDir` to the nearest tsconfig.json. */
export function findNearestTsconfig(startDir: string): string | null {
  return ts.findConfigFile(startDir, ts.sys.fileExists) ?? null;
}

/** Resolve a bare module specifier (e.g. "mail-send-v2") the way tsc would. */
export function resolveModuleFile(
  moduleName: string,
  containingFile: string,
  options: ts.CompilerOptions,
  mode?: ts.ResolutionMode
): string | null {
  const res = ts.resolveModuleName(moduleName, containingFile, options, ts.sys, undefined, undefined, mode);
  return res.resolvedModule?.resolvedFileName ?? null;
}

/** Follow import aliases (`import x from "m"`) to the real declaration symbol. */
export function resolveAlias(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined
): ts.Symbol | undefined {
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

// ── Incremental project session ──────────────────────────────────────────

export type SessionDiagnostic = {
  file: string;
  line: number;
  start: number;
  length: number;
  code: number;
  message: string;
};

function textVersion(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${h >>> 0}`;
}

export class DepsNotInstalledError extends Error {
  constructor(projectDir: string) {
    super(`No node_modules found above ${projectDir}; install dependencies before loading the program`);
    this.name = "DepsNotInstalledError";
  }
}

function hasNodeModules(dir: string): boolean {
  let cur = path.resolve(dir);
  for (let i = 0; i < 12; i++) {
    if (ts.sys.directoryExists(path.join(cur, "node_modules"))) return true;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

/**
 * A ts.Program that can be patched in memory. `update()` swaps file contents
 * without touching disk; unchanged SourceFiles and per-file semantic
 * diagnostics are reused by the builder program.
 */
export class ProjectSession {
  readonly configPath: string;
  readonly projectDir: string;
  readonly options: ts.CompilerOptions;
  readonly configErrors: string[];
  private roots: string[];
  private overrides = new Map<string, string>();
  private diskCache = new Map<string, ts.SourceFile>();
  private overrideCache = new Map<string, { version: string; sf: ts.SourceFile }>();
  private host: ts.CompilerHost;
  private builder: ts.EmitAndSemanticDiagnosticsBuilderProgram;

  private constructor(configPath: string, opts: { extraRootFiles?: string[] }) {
    this.configPath = path.resolve(configPath);
    this.projectDir = path.dirname(this.configPath);
    const read = ts.readConfigFile(this.configPath, ts.sys.readFile);
    if (read.error) throw new Error(`Cannot read ${this.configPath}: ${formatDiagnostic(read.error)}`);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, this.projectDir, undefined, this.configPath);
    this.options = { ...parsed.options, noEmit: true };
    this.configErrors = parsed.errors.map(formatDiagnostic);
    this.roots = [...parsed.fileNames, ...(opts.extraRootFiles ?? []).map((f) => path.resolve(f))];

    const base = ts.createIncrementalCompilerHost(this.options, ts.sys);
    const norm = (f: string) => path.resolve(f);
    this.host = {
      ...base,
      fileExists: (f) => this.overrides.has(norm(f)) || base.fileExists(f),
      readFile: (f) => this.overrides.get(norm(f)) ?? base.readFile(f),
      getSourceFile: (f, langVersion, onError, shouldCreate) => {
        const key = norm(f);
        const text = this.overrides.get(key);
        if (text != null) {
          const version = textVersion(text);
          const hit = this.overrideCache.get(key);
          if (hit && hit.version === version) return hit.sf;
          const sf = ts.createSourceFile(f, text, langVersion, true);
          (sf as ts.SourceFile & { version?: string }).version = version;
          this.overrideCache.set(key, { version, sf });
          return sf;
        }
        const cached = this.diskCache.get(key);
        if (cached) return cached;
        const sf = base.getSourceFile(f, langVersion, onError, shouldCreate);
        if (sf) {
          const v = sf as ts.SourceFile & { version?: string };
          if (!v.version) v.version = textVersion(sf.text);
          this.diskCache.set(key, sf);
        }
        return sf;
      },
    };
    this.builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(this.roots, this.options, this.host);
  }

  static open(
    tsconfigPath: string,
    opts: { extraRootFiles?: string[]; requireDeps?: boolean } = {}
  ): ProjectSession {
    const dir = path.dirname(path.resolve(tsconfigPath));
    if (opts.requireDeps && !hasNodeModules(dir)) throw new DepsNotInstalledError(dir);
    return new ProjectSession(tsconfigPath, opts);
  }

  get program(): ts.Program {
    return this.builder.getProgram();
  }

  get checker(): ts.TypeChecker {
    return this.program.getTypeChecker();
  }

  get rootFiles(): string[] {
    return [...this.roots];
  }

  /** Project source files: tsconfig roots minus .d.ts and node_modules. */
  get projectFiles(): string[] {
    return this.roots.filter((f) => !f.endsWith(".d.ts") && !f.includes(`${path.sep}node_modules${path.sep}`));
  }

  sourceFile(file: string): ts.SourceFile | undefined {
    return this.program.getSourceFile(path.resolve(file));
  }

  text(file: string): string {
    const key = path.resolve(file);
    return this.overrides.get(key) ?? this.sourceFile(key)?.text ?? ts.sys.readFile(key) ?? "";
  }

  /** Patched file contents (absolute path → text). */
  get patches(): Record<string, string> {
    return Object.fromEntries(this.overrides);
  }

  private rebuild() {
    this.builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(this.roots, this.options, this.host, this.builder);
  }

  /** Replace file contents in memory and rebuild incrementally. */
  update(changes: Record<string, string>): void {
    for (const [f, text] of Object.entries(changes)) this.overrides.set(path.resolve(f), text);
    this.rebuild();
  }

  /** Drop all in-memory patches. */
  reset(): void {
    this.overrides.clear();
    this.rebuild();
  }

  addRootFiles(files: string[]): void {
    const add = files.map((f) => path.resolve(f)).filter((f) => !this.roots.includes(f));
    if (!add.length) return;
    this.roots.push(...add);
    // Reusing the old builder here drops the new roots from the program.
    this.builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(this.roots, this.options, this.host);
  }

  /** Syntactic + semantic diagnostics for the given files only. */
  diagnostics(files: string[]): SessionDiagnostic[] {
    const out: SessionDiagnostic[] = [];
    for (const f of files) {
      const sf = this.sourceFile(f);
      if (!sf) continue;
      const diags = [
        ...this.builder.getSyntacticDiagnostics(sf),
        ...this.builder.getSemanticDiagnostics(sf),
      ];
      for (const d of diags) {
        out.push({
          file: sf.fileName,
          line: d.start != null ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
          start: d.start ?? -1,
          length: d.length ?? 0,
          code: d.code,
          message: formatDiagnostic(d),
        });
      }
    }
    return out;
  }

  /** Same shape as loadProgram(), for code that takes a LoadedProgram. */
  asLoaded(): LoadedProgram {
    return {
      program: this.program,
      checker: this.checker,
      options: this.options,
      configPath: this.configPath,
      projectDir: this.projectDir,
      rootFiles: this.rootFiles,
      configErrors: this.configErrors,
    };
  }
}

// ── Symbols and references ───────────────────────────────────────────────

/**
 * Resolve `"module#Export.member.member"` to a ts.Symbol, as seen from
 * `fromFile`. `default` names the default export. Adds the module file to the
 * session if the program does not include it yet.
 */
export function resolveSymbolSpec(
  session: ProjectSession,
  spec: string,
  fromFile: string
): { symbol: ts.Symbol; moduleFile: string } | null {
  const [moduleName, dotted] = spec.split("#");
  if (!moduleName || !dotted) return null;
  const mode = session.sourceFile(fromFile)?.impliedNodeFormat;
  const moduleFile = resolveModuleFile(moduleName, path.resolve(fromFile), session.options, mode);
  if (!moduleFile) return null;
  if (!session.sourceFile(moduleFile)) session.addRootFiles([moduleFile]);
  const checker = session.checker;
  const sf = session.sourceFile(moduleFile);
  if (!sf) return null;
  const moduleSym = checker.getSymbolAtLocation(sf);
  if (!moduleSym) return null;
  const [head, ...members] = dotted.split(".");
  let sym = resolveAlias(
    checker,
    checker.getExportsOfModule(moduleSym).find((s) => s.name === head)
  );
  for (const m of members) {
    if (!sym) return null;
    const decl = sym.declarations?.[0];
    const instance =
      sym.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
        ? checker.getDeclaredTypeOfSymbol(sym).getProperty(m)
        : undefined;
    const value = decl ? checker.getTypeOfSymbolAtLocation(sym, decl).getProperty(m) : undefined;
    sym = instance ?? value;
  }
  return sym ? { symbol: sym, moduleFile } : null;
}

export type SymbolReference = {
  file: string;
  start: number;
  end: number;
  line: number;
  kind: "import" | "call" | "reference";
  node: ts.Identifier;
};

export function sameSymbol(checker: ts.TypeChecker, a: ts.Symbol | undefined, target: ts.Symbol): boolean {
  if (!a) return false;
  if (a === target) return true;
  const ra = resolveAlias(checker, a);
  if (ra === target) return true;
  const decl = target.declarations?.[0];
  return Boolean(decl && ra?.declarations?.includes(decl));
}

/**
 * Scoped two-phase reference search: text-filter candidate files for the
 * symbol's name, then keep identifiers the checker resolves to `target`.
 */
export function findReferences(
  session: ProjectSession,
  target: ts.Symbol,
  opts: { files?: string[] } = {}
): SymbolReference[] {
  const checker = session.checker;
  const name = target.name;
  const candidates = (opts.files ?? session.projectFiles).filter((f) => session.text(f).includes(name));
  const refs: SymbolReference[] = [];
  for (const file of candidates) {
    const sf = session.sourceFile(file);
    if (!sf) continue;
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        if (sameSymbol(checker, checker.getSymbolAtLocation(node), target)) {
          let kind: SymbolReference["kind"] = "reference";
          let cur: ts.Node = node;
          while (cur.parent && !ts.isSourceFile(cur.parent)) {
            if (ts.isImportDeclaration(cur.parent)) {
              kind = "import";
              break;
            }
            cur = cur.parent;
          }
          if (kind !== "import") {
            const callee = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
            if (ts.isCallExpression(callee.parent) && callee.parent.expression === callee) kind = "call";
          }
          refs.push({
            file: sf.fileName,
            start: node.getStart(sf),
            end: node.getEnd(),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            kind,
            node,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return refs;
}

export type DeprecatedCallSpan = {
  fileName: string;
  file: string;
  start: number;
  end: number;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
  kind: string;
};

/**
 * Generic finder: every call to the symbol named by `spec`, as a span over
 * the CallExpression. Replaces per-scenario hand finders on unseen repos.
 */
export function findDeprecatedReferences(
  session: ProjectSession,
  spec: string,
  opts: { files?: string[]; fromFile?: string } = {}
): DeprecatedCallSpan[] {
  const from = opts.fromFile ?? opts.files?.[0] ?? session.projectFiles[0];
  if (!from) return [];
  const resolved = resolveSymbolSpec(session, spec, from);
  if (!resolved) return [];
  const spans: DeprecatedCallSpan[] = [];
  for (const ref of findReferences(session, resolved.symbol, { files: opts.files })) {
    if (ref.kind !== "call") continue;
    const sf = ref.node.getSourceFile();
    const callee = ts.isPropertyAccessExpression(ref.node.parent) ? ref.node.parent : ref.node;
    const call = callee.parent as ts.CallExpression;
    const start = call.getStart(sf);
    const end = call.getEnd();
    const s = sf.getLineAndCharacterOfPosition(start);
    const e = sf.getLineAndCharacterOfPosition(end);
    spans.push({
      fileName: path.basename(sf.fileName),
      file: sf.fileName,
      start,
      end,
      startLine: s.line + 1,
      startChar: s.character,
      endLine: e.line + 1,
      endChar: e.character,
      text: call.getText(sf),
      kind: `call:${spec}`,
    });
  }
  return spans;
}

/** Name of the npm package that owns `fileName` (nearest package.json). */
export function packageNameOf(fileName: string): string | null {
  let dir = path.dirname(fileName);
  for (let i = 0; i < 12; i++) {
    const pkg = path.join(dir, "package.json");
    if (ts.sys.fileExists(pkg)) {
      try {
        const json = JSON.parse(ts.sys.readFile(pkg) ?? "{}");
        if (typeof json.name === "string") return json.name;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
