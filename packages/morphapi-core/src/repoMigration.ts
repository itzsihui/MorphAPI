/**
 * Whole-repository migration after a real dependency upgrade (discover mode).
 *
 *   bridge the previous version → discover work items from what the new
 *   version breaks → migrate them with the normal pipeline (slices, code
 *   property graph facts, type-checker gate, impact repair) → re-discover on
 *   the result → … until nothing is left or no progress is made.
 *
 * "Complete" is judged against the NEW version only (bridge removed): no new
 * compiler errors versus the pre-upgrade baseline, no imports of a retired
 * package, no alias left, and a final discovery pass that finds nothing.
 */
import * as path from "path";
import * as ts from "typescript";
import {
  aliasOf,
  aliasSpecifiersIn,
  bridgeAliases,
  fromAliasMap,
  rewriteSpecifiers,
  toAliasMap,
  type Bridge,
} from "./bridge";
import { diagnosticKey, discoverWorkItems, findHandoffs, orderByDataFlow, testFailureItems, type Handoff, type WorkItem } from "./discover";
import type { LlmMessage, ModelProfile } from "./llm";
import { lineHunks, runMigration, type ArmId, type MigrationEvent, type MigrationRun } from "./pipeline";
import { ProjectSession, type SessionDiagnostic } from "./program";
import { ProjectCompiler } from "./projectCompiler";
import { setInlineTypeModifiers } from "./importReconcile";

export type RepoMigrationConfig = {
  repoRoot: string;
  tsconfigPath: string;
  /** Previous versions to bridge (one per upgraded package the project imports) */
  bridges: Bridge[];
  /** Module specifiers new code should import from, e.g. ["openai"] or ["firebase/app", "firebase/auth"] */
  successorModules: string[];
  /** Bridged modules replaced by a different package (default: bridges no successor lives under) */
  retiredModules?: string[];
  guide?: string;
  task?: string;
  rules?: string[];
  arm?: ArmId;
  model?: ModelProfile;
  propose?: (messages: LlmMessage[]) => Promise<string>;
  onEvent?: (evt: MigrationEvent) => void;
  /** Discover → migrate rounds (default 6) */
  rounds?: number;
  /** Successor API budget per prompt, in characters (default 12000) */
  apiBudget?: number;
  /** Prompt-cache the guide and API list (default true; Anthropic native API) */
  cacheStaticContext?: boolean;
  /** Migration-guide budget per prompt, in characters (default 10000) */
  guideBudget?: number;
  /**
   * Optional behaviour oracle: run the project's tests on the given texts (absolute path → text, bridge
   * reverted). Used once the type checker finds nothing left; failures become work items.
   */
  verify?: (texts: Record<string, string>) => Promise<{ ok: boolean; output: string }>;
  /** Test-driven rounds after the type checker is satisfied (default 2) */
  testRounds?: number;
  /**
   * Ablation: switch off the code property graph's def-use features (producer-first
   * ordering and error attribution). Slices, facts and the gate are unchanged.
   */
  noDefUse?: boolean;
  /** Restrict to these project files (default: every non-declaration file in the tsconfig) */
  files?: string[];
  /** Extra files to migrate and type-check that the tsconfig leaves out (e.g. tests that mock the SDK) */
  extraFiles?: string[];
};

export type RepoMigrationRun = {
  rounds: Array<{ round: number; items: WorkItem[]; run: MigrationRun }>;
  tests: Array<{ round: number; ok: boolean; failures: number }>;
  final: {
    complete: boolean;
    newDiagnostics: Array<{ file: string; line: number; message: string }>;
    aliasSpecifiersLeft: number;
    retiredImportsLeft: number;
    remainingItems: number;
    /** Untyped hand-offs to packages built for the retired SDK that are still in use */
    handoffsLeft: Array<{ file: string; line: number; pkg: string }>;
  };
  metrics: {
    itemsFound: number;
    stepsAccepted: number;
    steps: number;
    attempts: number;
    escalations: number;
    phantomRejections: number;
    impactFixes: number;
    changedLines: number;
    promptTokens: number;
    completionTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
  /** Repo-relative path → texts with the bridge reverted, ready to write to disk */
  patches: Record<string, { before: string; after: string }>;
  ms: number;
};

const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join("/");

function revert(text: string, file: string, bridges: Bridge[]): string {
  return rewriteSpecifiers(text, file, fromAliasMap(bridges)).text;
}

function retiredImportsIn(text: string, file: string, retired: string[]): number {
  if (!retired.length) return 0;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let n = 0;
  const hit = (spec: string) => retired.some((r) => spec === r || spec.startsWith(`${r}/`));
  const visit = (x: ts.Node) => {
    if ((ts.isImportDeclaration(x) || ts.isExportDeclaration(x)) && x.moduleSpecifier && ts.isStringLiteral(x.moduleSpecifier) && hit(x.moduleSpecifier.text)) n++;
    else if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "require" && x.arguments[0] && ts.isStringLiteralLike(x.arguments[0]) && hit(x.arguments[0].text)) n++;
    ts.forEachChild(x, visit);
  };
  visit(sf);
  return n;
}

/** Binding names imported from the aliases: the deprecated names the graph and gate look for. */
function aliasBindingNames(session: ProjectSession, files: string[], bridges: Bridge[]): string[] {
  const aliases = bridges.map((b) => aliasOf(b.module));
  const names = new Set<string>();
  for (const f of files) {
    const sf = session.sourceFile(f);
    if (!sf) continue;
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      if (!aliases.some((a) => st.moduleSpecifier.getText(sf).includes(a))) continue;
      const c = st.importClause;
      if (c?.name) names.add(c.name.text);
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.add(c.namedBindings.name.text);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.add(e.name.text);
    }
  }
  return [...names];
}

export async function runRepoMigration(cfg: RepoMigrationConfig): Promise<RepoMigrationRun> {
  const t0 = Date.now();
  const emit = (type: string, payload: Record<string, unknown> = {}) => cfg.onEvent?.({ type, ...payload });
  const bridges = cfg.bridges.map((b) => ({ ...b, previousDir: path.resolve(b.previousDir) }));
  const retiredNames =
    cfg.retiredModules ??
    bridges.filter((b) => !cfg.successorModules.some((s) => s === b.module || s.startsWith(`${b.module}/`))).map((b) => b.module);
  const retired = bridges.filter((b) => retiredNames.includes(b.module));

  // Old world: the project as it was, with the previous version under its alias.
  const extraRootFiles = (cfg.extraFiles ?? []).map((f) => path.resolve(f));
  const bridged = ProjectSession.open(cfg.tsconfigPath, { requireDeps: true, aliases: bridgeAliases(bridges), extraRootFiles });
  const files = [...new Set([...(cfg.files ?? bridged.projectFiles), ...extraRootFiles].map((f) => path.resolve(f)))];
  const originals = Object.fromEntries(files.map((f) => [f, bridged.text(f)]));
  const toAlias = toAliasMap(bridges);
  const rewritten: Record<string, string> = {};
  for (const f of files) {
    const r = rewriteSpecifiers(originals[f], f, toAlias);
    if (r.edits.length) rewritten[f] = r.text;
  }
  bridged.update(rewritten);
  const unalias = (m: string) => bridges.reduce((s, b) => s.split(aliasOf(b.module)).join(b.module), m);
  // Verdicts come from the PROJECT's own TypeScript (its version may be older than ours).
  const pc = ProjectCompiler.load(cfg.tsconfigPath, { extraRootFiles, aliases: bridgeAliases(bridges) });
  setInlineTypeModifiers(pc.supportsInlineTypeModifiers);
  const oldDiags = pc.diagnostics(Object.fromEntries(files.map((f) => [f, bridged.text(f)])), files);
  const baseline = new Map<string, number>();
  for (const d of oldDiags) {
    const k = diagnosticKey({ ...d, message: unalias(d.message) });
    baseline.set(k, (baseline.get(k) ?? 0) + 1);
  }
  emit("bridge", {
    bridges: bridges.map((b) => ({ module: b.module, alias: aliasOf(b.module), previousDir: b.previousDir })),
    retired: retiredNames,
    files: files.length,
    rewrittenFiles: Object.keys(rewritten).map((f) => rel(cfg.repoRoot, f)),
    oldWorldDiagnostics: oldDiags.length,
    projectTypeScript: `${pc.version} (${pc.source})`,
  });

  const handoffs: Handoff[] = retired.length ? findHandoffs(bridged, files, retired.map((b) => b.previousDir)) : [];
  if (handoffs.length) emit("handoffs", { items: handoffs.map((h) => ({ file: rel(cfg.repoRoot, h.file), line: h.startLine, pkg: h.pkg })) });

  // New world: the project against the upgraded node_modules only.

  const current = () => Object.fromEntries(files.map((f) => [f, revert(bridged.text(f), f, bridges)]));
  const newWorldDiags = (texts: Record<string, string>): SessionDiagnostic[] =>
    pc.diagnostics(texts, files).map((d) => ({ ...d, message: unalias(d.message) }));
  const triedProducers = new Set<string>();
  const accepted = () =>
    rounds.flatMap((r) => [
      ...r.run.steps.map((s) => ({ abs: path.resolve(cfg.repoRoot, s.file), accepted: s.accepted })),
      ...r.run.impactFixes.map((x) => ({ abs: path.resolve(cfg.repoRoot, x.file), accepted: x.after })),
    ]);
  const discover = (texts: Record<string, string>, attribute = true) =>
    discoverWorkItems({
      accepted: attribute && !cfg.noDefUse ? accepted() : undefined,
      triedProducers,
      bridged,
      newWorld: newWorldDiags(texts),
      baseline,
      newWorldText: (f) => texts[path.resolve(f)] ?? revert(bridged.text(f), f, bridges),
      bridges,
      retired,
      files,
    });

  const rounds: RepoMigrationRun["rounds"] = [];
  const tests: RepoMigrationRun["tests"] = [];
  const maxRounds = cfg.rounds ?? 6;
  const deferredOnce = new Set<string>();
  /** file|slice text → rejected attempts there in earlier rounds */
  const rejected = new Map<string, string[]>();
  const siteKey = (file: string, text: string) => `${path.resolve(file)}|${text.trim()}`;
  let testBudget = cfg.verify ? cfg.testRounds ?? 2 : 0;
  const totalRounds = maxRounds + testBudget;
  for (let round = 1; round <= totalRounds; round++) {
    let found = discover(current());
    if (round === 1 && handoffs.length) {
      const taken = new Set(found.map((i) => `${i.file}:${i.start}`));
      found = [...found, ...handoffs.filter((h) => !taken.has(`${h.file}:${h.start}`))];
    }
    if (!found.length && testBudget > 0 && cfg.verify) {
      // Type checker satisfied: ask the tests.
      const res = await cfg.verify(current());
      const failing = res.ok ? [] : testFailureItems(bridged, res.output, files, cfg.repoRoot);
      for (const it of failing) {
        // Tell the model what the previous test-driven fix at this site was, so it does not repeat it.
        const prev = rounds.flatMap((r) => r.run.steps).filter((s) => s.accepted && path.resolve(cfg.repoRoot, s.file) === path.resolve(it.file) && s.line >= it.startLine && s.line <= it.endLine );
        const last = prev[prev.length - 1];
        if (last) it.notes.push(`A previous fix here still failed the same way at runtime: ${last.accepted!.trim().slice(0, 400)}`);
      }
      tests.push({ round, ok: res.ok, failures: failing.length });
      emit("tests", { round, ok: res.ok, items: failing.map((i) => ({ file: rel(cfg.repoRoot, i.file), line: i.startLine, notes: i.notes })) });
      testBudget--;
      found = failing;
    }
    if (!found.length) {
      emit("discover", { round, items: [], deferred: [] });
      break;
    }
    const ordered = cfg.noDefUse ? { ready: found, deferred: [] as WorkItem[] } : orderByDataFlow(bridged, found);
    // Defer an item at most once: a producer that keeps failing must not starve its consumers.
    const items = [...ordered.ready, ...ordered.deferred.filter((i) => deferredOnce.has(siteKey(i.file, i.text)))];
    const deferred = ordered.deferred.filter((i) => !deferredOnce.has(siteKey(i.file, i.text)));
    for (const i of deferred) deferredOnce.add(siteKey(i.file, i.text));
    for (const i of items) {
      const prev = rejected.get(siteKey(i.file, i.text));
      if (prev?.length) i.notes.push(`Earlier attempts here were rejected (do not repeat them): ${prev.slice(-3).join(" || ")}`);
    }
    emit("discover", {
      round,
      items: items.map((i) => ({ file: rel(cfg.repoRoot, i.file), line: i.startLine, kind: i.sliceKind, source: i.source, notes: i.notes })),
      deferred: deferred.map((i) => ({ file: rel(cfg.repoRoot, i.file), line: i.startLine })),
    });
    const aliasSpecs = [...new Set(files.flatMap((f) => aliasSpecifiersIn(bridged.text(f), f, bridges)))];
    const notRetired = aliasSpecs.filter((a) => !retired.some((b) => a === aliasOf(b.module) || a.startsWith(`${aliasOf(b.module)}/`)));
    const run = await runMigration({
      repoRoot: cfg.repoRoot,
      tsconfigPath: cfg.tsconfigPath,
      files,
      session: bridged,
      spans: items,
      deprecatedSymbols: aliasBindingNames(bridged, files, bridges),
      deprecatedModules: aliasSpecs.length ? aliasSpecs : bridges.map((b) => aliasOf(b.module)),
      deprecatedDirs: bridges.map((b) => b.previousDir),
      successorModule: cfg.successorModules[0],
      successorModules: cfg.successorModules,
      successorSymbols: [],
      // Same-name upgrades: names that still exist move to the new version up front.
      swapPairs: notRetired.map((a) => ({ from: a, to: unalias(a) })),
      migrationLabel: bridges.map((b) => `${b.module} (previous version)`).join(", "),
      successorLabel: `${cfg.successorModules.join(", ")} (new version)`,
      apiBudget: cfg.apiBudget ?? 12000,
      cacheStaticContext: cfg.cacheStaticContext ?? true,
      guideBudget: cfg.guideBudget ?? 10000,
      impactAllFiles: true,
      impactRounds: 2,
      impactLimit: 12,
      rules: cfg.rules,
      guide: cfg.guide,
      task: cfg.task,
      arm: cfg.arm,
      model: cfg.model,
      propose: cfg.propose,
      onEvent: (e) => cfg.onEvent?.({ ...e, round }),
      noAttribution: cfg.noDefUse,
      projectParse: (text, file) => pc.parseErrors(text, file),
      priorAccepted: rounds.flatMap((r) => [
        ...r.run.steps.map((s) => ({ file: s.file, accepted: s.accepted })),
        ...r.run.impactFixes.map((x) => ({ file: x.file, accepted: x.after })),
      ]),
    });
    rounds.push({ round, items, run });
    for (const s of run.steps) {
      if (s.accepted) continue;
      const last = s.attempts.slice(-2).map((a) => `${a.candidate.trim().slice(0, 300)} → ${a.findings[0]?.message.slice(0, 160) ?? "rejected"}`);
      const k = siteKey(path.resolve(cfg.repoRoot, s.file), s.text);
      rejected.set(k, [...(rejected.get(k) ?? []), ...last]);
    }
    const progress = run.steps.some((s) => s.accepted != null) || run.impactFixes.some((x) => x.after != null);
    if (!progress && !deferred.length) break;
  }

  // Final verdict, against the new version only.
  const finalTexts = current();
  const finalDiags = newWorldDiags(finalTexts);
  const remaining = new Map(baseline);
  const newDiagnostics: RepoMigrationRun["final"]["newDiagnostics"] = [];
  for (const d of finalDiags) {
    const k = diagnosticKey(d);
    const n = remaining.get(k) ?? 0;
    if (n > 0) remaining.set(k, n - 1);
    else newDiagnostics.push({ file: rel(cfg.repoRoot, d.file), line: d.line, message: `TS${d.code}: ${d.message}` });
  }
  const aliasLeft = files.reduce((n, f) => n + aliasSpecifiersIn(finalTexts[f], f, bridges).length, 0);
  const retiredLeft = files.reduce((n, f) => n + retiredImportsIn(finalTexts[f], f, retiredNames), 0);
  const remainingItems = discover(finalTexts, false).length;
  const importsPkg = (text: string, file: string, pkg: string) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true).statements.some(
      (st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === pkg
    );
  const handoffsLeft = handoffs
    .filter((h) => importsPkg(finalTexts[h.file] ?? "", h.file, h.pkg))
    .map((h) => ({ file: rel(cfg.repoRoot, h.file), line: h.startLine, pkg: h.pkg }));

  const patches: RepoMigrationRun["patches"] = {};
  let changedLines = 0;
  for (const f of files) {
    if (finalTexts[f] === originals[f]) continue;
    patches[rel(cfg.repoRoot, f)] = { before: originals[f], after: finalTexts[f] };
    for (const h of lineHunks(originals[f].split("\n"), finalTexts[f].split("\n"))) changedLines += h.a2 - h.a1 + (h.b2 - h.b1);
  }
  const runs = rounds.map((r) => r.run);
  const steps = runs.flatMap((r) => r.steps);
  const attempts = steps.flatMap((s) => s.attempts);
  const result: RepoMigrationRun = {
    rounds,
    tests,
    final: {
      complete: newDiagnostics.length === 0 && aliasLeft === 0 && retiredLeft === 0 && remainingItems === 0 && handoffsLeft.length === 0,
      newDiagnostics,
      aliasSpecifiersLeft: aliasLeft,
      retiredImportsLeft: retiredLeft,
      remainingItems,
      handoffsLeft,
    },
    metrics: {
      itemsFound: rounds.reduce((n, r) => n + r.items.length, 0),
      stepsAccepted: steps.filter((s) => s.accepted != null).length,
      steps: steps.length,
      attempts: attempts.length,
      escalations: steps.filter((s) => s.escalated).length,
      phantomRejections: attempts.reduce((n, a) => n + a.findings.filter((f) => f.kind === "phantom").length, 0),
      impactFixes: runs.reduce((n, r) => n + r.impactFixes.filter((x) => x.after != null).length, 0),
      changedLines,
      promptTokens: runs.reduce((n, r) => n + r.metrics.promptTokens, 0),
      cacheWriteTokens: runs.reduce((n, r) => n + (r.metrics.cacheWriteTokens ?? 0), 0),
      cacheReadTokens: runs.reduce((n, r) => n + (r.metrics.cacheReadTokens ?? 0), 0),
      completionTokens: runs.reduce((n, r) => n + r.metrics.completionTokens, 0),
    },
    patches,
    ms: Date.now() - t0,
  };
  emit("repo_done", { final: result.final, metrics: result.metrics });
  return result;
}
