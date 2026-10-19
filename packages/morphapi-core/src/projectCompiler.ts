/**
 * The project's OWN TypeScript compiler, loaded from its node_modules.
 *
 * MorphAPI analyses code with its bundled TypeScript, but a migration is only
 * correct if the project's compiler accepts it: a project on TypeScript 4.1
 * cannot parse `import { type X }` (4.5+) or `satisfies` (4.9+). This class
 * gives the verdicts that matter (parse errors of an edit, the new-version
 * diagnostics used for discovery, and the final check) from the project's own
 * compiler. It supports the version bridge's aliases through the older
 * `resolveModuleNames` host hook, which every TypeScript 3.x-5.x supports.
 */
import * as fs from "fs";
import * as path from "path";
import type { ModuleAlias, SessionDiagnostic } from "./program";

// The project's typescript module: typed loosely because its version differs from ours.
type AnyTs = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function loadProjectTs(projectDir: string): { ts: AnyTs; dir: string } | null {
  try {
    const entry = require.resolve("typescript", { paths: [projectDir] });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return { ts: require(entry), dir: path.dirname(path.dirname(entry)) };
  } catch {
    return null;
  }
}

export class ProjectCompiler {
  readonly ts: AnyTs;
  readonly version: string;
  /** Where the compiler was loaded from ("project" or "bundled" when the project has none) */
  readonly source: "project" | "bundled";
  private options: AnyTs;
  private roots: string[];
  private aliases: ModuleAlias[];
  private sfCache = new Map<string, { text: string; sf: AnyTs }>();
  private oldProgram: AnyTs | undefined;

  private constructor(tsMod: AnyTs, source: "project" | "bundled", configPath: string, opts: { extraRootFiles?: string[]; aliases?: ModuleAlias[] }) {
    this.ts = tsMod;
    this.source = source;
    this.version = String(tsMod.version);
    const dir = path.dirname(configPath);
    const read = tsMod.readConfigFile(configPath, tsMod.sys.readFile);
    const parsed = tsMod.parseJsonConfigFileContent(read.config ?? {}, tsMod.sys, dir, undefined, configPath);
    this.options = { ...parsed.options, noEmit: true };
    this.roots = [...parsed.fileNames, ...(opts.extraRootFiles ?? []).map((f) => path.resolve(f))];
    this.aliases = opts.aliases ?? [];
  }

  static load(tsconfigPath: string, opts: { extraRootFiles?: string[]; aliases?: ModuleAlias[] } = {}): ProjectCompiler {
    const configPath = path.resolve(tsconfigPath);
    const found = loadProjectTs(path.dirname(configPath));
    if (found) return new ProjectCompiler(found.ts, "project", configPath, opts);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return new ProjectCompiler(require("typescript"), "bundled", configPath, opts);
  }

  /** major.minor as a number, e.g. 4.1 → 4.1, 5.9 → 5.9 */
  get versionNumber(): number {
    const [maj, min] = this.version.split(".").map(Number);
    return maj + min / 100;
  }

  /** `import { type X }` needs TypeScript 4.5. */
  get supportsInlineTypeModifiers(): boolean {
    return this.versionNumber >= 4.05;
  }

  /** Syntax errors the project's compiler reports for `text` (message strings). */
  parseErrors(text: string, fileName: string): string[] {
    const ts = this.ts;
    const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const diags: AnyTs[] = sf.parseDiagnostics ?? [];
    return diags.map((d: AnyTs) => {
      const pos = d.start != null ? sf.getLineAndCharacterOfPosition(d.start) : { line: 0 };
      return `line ${pos.line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
    });
  }

  /**
   * Full diagnostics of `files` with `texts` overriding disk contents, from the
   * project's compiler. Alias specifiers (the version bridge) resolve as their module from the alias's folder.
   */
  diagnostics(texts: Record<string, string>, files: string[], opts: { libraries?: boolean } = {}): SessionDiagnostic[] {
    const ts = this.ts;
    const overrides = new Map(Object.entries(texts).map(([f, t]) => [path.resolve(f), t]));
    const base = ts.createCompilerHost(this.options, true);
    const host = Object.create(base);
    host.fileExists = (f: string) => overrides.has(path.resolve(f)) || base.fileExists(f);
    host.readFile = (f: string) => overrides.get(path.resolve(f)) ?? base.readFile(f);
    host.getSourceFile = (f: string, lang: AnyTs, onError?: AnyTs, create?: boolean) => {
      const key = path.resolve(f);
      const text = overrides.get(key) ?? (fs.existsSync(key) ? fs.readFileSync(key, "utf8") : undefined);
      if (text == null) return base.getSourceFile(f, lang, onError, create);
      const hit = this.sfCache.get(key);
      if (hit && hit.text === text) return hit.sf;
      const sf = ts.createSourceFile(f, text, lang, true);
      this.sfCache.set(key, { text, sf });
      return sf;
    };
    if (this.aliases.length) {
      host.resolveModuleNames = (names: string[], containingFile: string) =>
        names.map((name) => {
          const a = this.aliases.find((x) => name === x.alias || name.startsWith(`${x.alias}/`));
          const spec = a ? a.module + name.slice(a.alias.length) : name;
          const from = a ? a.fromFile : containingFile;
          return ts.resolveModuleName(spec, from, this.options, host).resolvedModule;
        });
    }
    const program = ts.createProgram({ rootNames: this.roots, options: this.options, host, oldProgram: this.oldProgram });
    this.oldProgram = program;
    const out: SessionDiagnostic[] = [];
    const targets: AnyTs[] = files.map((f) => program.getSourceFile(path.resolve(f))).filter(Boolean);
    if (opts.libraries && !this.options.skipLibCheck) {
      // Errors inside installed packages' declaration files, as tsc reports them without skipLibCheck.
      const own = new Set(targets);
      for (const sf of program.getSourceFiles()) {
        if (!own.has(sf) && !program.isSourceFileDefaultLibrary(sf) && /[\\/]node_modules[\\/]/.test(sf.fileName)) targets.push(sf);
      }
    }
    for (const sf of targets) {
      for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
        out.push({
          file: sf.fileName,
          line: d.start != null ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
          start: d.start ?? -1,
          length: d.length ?? 0,
          code: d.code,
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        });
      }
    }
    return out;
  }
}
