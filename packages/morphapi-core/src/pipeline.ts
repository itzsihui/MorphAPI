/**
 * Generic MorphAPI migration pipeline over a real ts.Program:
 *   findDeprecatedReferences → slice + facts → LLM → gate (+ feedback) →
 *   import reconciliation → response-shape propagation → 1-hop impact.
 * Arms toggle mechanisms so ablations run the same code path.
 */
import * as path from "path";
import * as ts from "typescript";
import { anyProfile, feedbackFor, gateSpan, repairLoop, type AttemptRecord, type GateResult } from "./gate";
import { propagateResponseShape, type ShapeResult } from "./dataflow";
import { reconcileImports, addMissingImports, swapSharedImports, type ImportCandidate } from "./importReconcile";
import {
  diagnosticKeys,
  programImpact,
  snapshotSignatures,
  type ProgramImpactResult,
} from "./impactProgram";
import { generateCode, type LlmMessage, type ModelProfile } from "./llm";
import { extractOracle, importCandidates, mergeOracles, type ExtractedOracle } from "./oracleExtract";
import { ProjectSession, findDeprecatedReferences, resolveAlias, type DeprecatedCallSpan } from "./program";
import { producerOf } from "./discover";
import { bindingsIn, type RuleBook } from "./ruleBook";
import {
  buildSlicePrompt,
  needsStatementSlice,
  parsesAs,
  sliceFactsFor,
  sliceFor,
  type Slice,
  type SliceKind,
  type SuccessorKind,
} from "./sliceMetadata";
import type { SliceFacts } from "./codePropertyGraph";

export type ArmId = "arm0_llm_only" | "arm1_morphapi" | "ablA_no_slices" | "ablB_no_oracle" | "ablC_no_impact";

export type ArmConfig = {
  context: "slice" | "file";
  oracle: boolean;
  dataflow: boolean;
  impact: boolean;
};

export const ARMS: Record<Exclude<ArmId, "arm0_llm_only">, ArmConfig> = {
  arm1_morphapi: { context: "slice", oracle: true, dataflow: true, impact: true },
  ablA_no_slices: { context: "file", oracle: true, dataflow: true, impact: true },
  ablB_no_oracle: { context: "slice", oracle: false, dataflow: true, impact: true },
  ablC_no_impact: { context: "slice", oracle: true, dataflow: true, impact: false },
};

export type MigrationConfig = {
  repoRoot: string;
  tsconfigPath: string;
  /** Absolute paths of project files to migrate / check */
  files: string[];
  /** `module#Export.member`. Optional when `spans` are supplied (discover mode). */
  deprecatedSpec?: string;
  deprecatedSymbols: string[];
  successorModule: string;
  successorSymbols: string[];
  /** Several successor modules (e.g. firebase/app, firebase/auth); merged into one oracle. */
  successorModules?: string[];
  /** Reuse an open (e.g. bridged) session instead of opening tsconfigPath. */
  session?: ProjectSession;
  /** Work items to migrate instead of calls to `deprecatedSpec`. */
  spans?: WorkSpan[];
  /** Modules whose leftover imports are cleaned up / reported (default: the spec's module). */
  deprecatedModules?: string[];
  /** Folders of the previous SDK version; references into them are leftovers. */
  deprecatedDirs?: string[];
  /** Shared-import swaps to try (default: deprecated module → successor module). */
  swapPairs?: Array<{ from: string; to: string }>;
  /** Text after "## Migration" in prompts (default: the spec). */
  migrationLabel?: string;
  /** Character budget for the Successor API list in each prompt (default: unbounded). */
  apiBudget?: number;
  /** Character budget for the migration guide in each prompt: most relevant sections first (default: whole guide). */
  guideBudget?: number;
  /** Text for the successor side of "## Migration" (default: the successor module names). */
  successorLabel?: string;
  /** Impact repair: extra rounds and findings repaired per round (defaults 2 and 8). */
  impactRounds?: number;
  impactLimit?: number;
  /** Scan every file (not only changed ones) for uses of the retired modules. */
  impactAllFiles?: boolean;
  /**
   * Put the guide and a large successor-API list into one prompt-cached system block shared by every
   * call (Anthropic native API); each call then carries only a short relevant-symbol excerpt.
   */
  cacheStaticContext?: boolean;
  /** Syntax errors the PROJECT's compiler reports for a file text (see ProjectCompiler). */
  projectParse?: (text: string, file: string) => string[];
  /** Learned rewrite rules shared across rounds (learn-once, verified by the gate at every use). */
  ruleBook?: RuleBook;
  /** Ablation: no def-use attribution in impact repair. */
  noAttribution?: boolean;
  /** Rewrites accepted in earlier rounds (repo-relative file + code), for def-use attribution. */
  priorAccepted?: Array<{ file: string; accepted: string | null }>;
  successorKind?: SuccessorKind;
  rules?: string[];
  /** Prose migration guide given to every arm */
  guide?: string;
  task?: string;
  arm?: ArmId;
  model?: ModelProfile;
  maxAttempts?: number;
  /** Override the LLM (tests / replay) */
  propose?: (messages: LlmMessage[]) => Promise<string>;
  onEvent?: (evt: MigrationEvent) => void;
};

export type MigrationEvent = { type: string; [k: string]: unknown };

/** A site to migrate: a call to the deprecated API, or a discovered work item. */
export type WorkSpan = DeprecatedCallSpan & { sliceKind?: SliceKind; notes?: string[] };

/**
 * Keep the Successor API list inside `budget` characters: entries named in
 * `mention` (slice, compiler errors) first, then entries named in the guide,
 * then the rest in declaration order.
 */
/**
 * The guide sections most relevant to `mention`, within `budget` characters,
 * kept in their original order. Sections are split at markdown headings.
 */
export function boundGuide(guide: string | undefined, mention: string, budget?: number): string | undefined {
  if (!guide || !budget || guide.length <= budget) return guide;
  const sections = guide.split(/\n(?=#{1,4} )/);
  const words = new Set((mention.match(/[A-Za-z_$][\w$]{2,}/g) ?? []).map((w) => w.toLowerCase()));
  const scored = sections.map((text, i) => {
    const toks = text.match(/[A-Za-z_$][\w$]{2,}/g) ?? [];
    const hits = new Set(toks.map((t) => t.toLowerCase()).filter((t) => words.has(t)));
    return { text, i, score: hits.size };
  });
  const picked: typeof scored = [];
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (s.score === 0 && picked.length) break;
    if (used + s.text.length > budget) continue;
    picked.push(s);
    used += s.text.length;
  }
  return picked.sort((a, b) => a.i - b.i).map((s) => s.text).join("\n\n[…]\n\n");
}

export function boundApi(
  api: Array<{ symbol: string; signature: string | null }>,
  mention: string,
  guide: string,
  budget?: number
): Array<{ symbol: string; signature: string | null }> {
  if (!budget) return api;
  const size = (a: { symbol: string; signature: string | null }) => a.symbol.length + (a.signature?.length ?? 0) + 6;
  if (api.reduce((n, a) => n + size(a), 0) <= budget) return api;
  const words = (t: string) => new Set(t.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const m = words(mention);
  const g = words(guide);
  const owner = (a: { symbol: string }) => a.symbol.replace(/ members$/, "").split(".")[0];
  const score = (a: { symbol: string }) => (m.has(owner(a)) ? 2 : g.has(owner(a)) ? 1 : 0);
  const ranked = api.map((a, i) => ({ a, i, s: score(a) })).sort((x, y) => y.s - x.s || x.i - y.i);
  const out: typeof ranked = [];
  let used = 0;
  for (const r of ranked) {
    const entry = r.a.signature && r.a.signature.length > 400 ? { ...r.a, signature: `${r.a.signature.slice(0, 397)}...` } : r.a;
    if (used + size(entry) > budget) continue;
    used += size(entry);
    out.push({ ...r, a: entry });
  }
  return out.sort((x, y) => x.i - y.i).map((r) => r.a);
}

export type SpanStep = {
  file: string;
  line: number;
  text: string;
  slice: { kind: SliceKind; startLine: number; text: string };
  escalated: boolean;
  prompt: string;
  facts: SliceFacts | null;
  attempts: AttemptRecord[];
  accepted: string | null;
  imports: string[];
  dataflow: ShapeResult | null;
  /** Accepted from a learned rule without an LLM call */
  viaRule?: boolean;
};

export type ImpactFix = {
  reason: string;
  file: string;
  line: number;
  before: string;
  after: string | null;
  attempts: number;
  tries?: AttemptRecord[];
};

export type MigrationRun = {
  arm: ArmId;
  model: string;
  deprecatedSpec: string;
  successorModule: string;
  oracle: { exports: number; allowed: number } | null;
  steps: SpanStep[];
  impact: ProgramImpactResult | null;
  impactFixes: ImpactFix[];
  final: {
    leftovers: number;
    deprecatedModuleUses: number;
    newDiagnostics: Array<{ file: string; line: number; message: string }>;
    phantomDiagnostics: number;
    complete: boolean;
  };
  metrics: {
    spansFound: number;
    spansMigrated: number;
    attempts: number;
    phantomRejections: number;
    escalations: number;
    dynamicAccessWarnings: number;
    changedLines: number;
    linesOutsideSpans: number;
    importLinesChanged: number;
    churnRatio: number;
    promptTokens: number;
    completionTokens: number;
    /** Prompt-cache writes and reads (Anthropic native API); not included in promptTokens */
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
  patches: Record<string, { before: string; after: string }>;
  ms: number;
};

const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join("/");

function cleanProposal(raw: string, kind: SliceKind, awaitBefore: boolean, original: string): string {
  let s = raw
    .split("\n")
    .filter((l) => !/^\s*import\s.+from\s/.test(l))
    .join("\n")
    .trim();
  // Inline-code markup around a non-template slice would type-check as a string literal.
  const inline = /^`([^`]*)`;?$/.exec(s);
  if (inline && !original.trim().startsWith("`")) s = inline[1].trim();
  if (kind === "expression" || kind === "type") {
    s = s.replace(/;\s*$/, "");
    if (awaitBefore) s = s.replace(/^await\s+/, "");
  }
  return s;
}

/** Indent continuation lines of a proposal to the indentation of the line it lands on. */
function reindent(code: string, text: string, at: number): string {
  const lines = code.split("\n");
  if (lines.length < 2) return code;
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", at - 1) + 1))![0];
  if (!indent) return code;
  const rest = lines.slice(1).filter((l) => l.trim());
  // Already written at absolute indentation (e.g. copied from the slice).
  if (rest.every((l) => l.startsWith(indent))) return code;
  return [lines[0], ...lines.slice(1).map((l) => (l.trim() ? indent + l : l))].join("\n");
}

type TextEdit = { pos: number; del: number; text: string };

/**
 * Edits that make the function enclosing `pos` async: an `async` modifier and
 * a `Promise<…>` return annotation. All edits lie before `pos`.
 */
function asyncifyEdits(sf: ts.SourceFile, pos: number): TextEdit[] {
  let fn: ts.FunctionLikeDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) > pos || n.getEnd() < pos) return;
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) && n.body) fn = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!fn || fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return [];
  const edits: TextEdit[] = [];
  const kw = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
  const at = kw ? kw.getStart(sf) : ts.isMethodDeclaration(fn) ? fn.name.getStart(sf) : fn.getStart(sf);
  edits.push({ pos: at, del: 0, text: "async " });
  if (fn.type && !/^Promise</.test(fn.type.getText(sf))) {
    edits.push({ pos: fn.type.getStart(sf), del: fn.type.getWidth(sf), text: `Promise<${fn.type.getText(sf)}>` });
  }
  return edits;
}

function applyTextEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.del);
  return out;
}

function lastImportEnd(sf: ts.SourceFile): number {
  const imps = sf.statements.filter(ts.isImportDeclaration);
  return imps.length ? imps[imps.length - 1].getEnd() : 0;
}

/** Line-level diff hunks (LCS). Ranges are 0-based [start, end). */
export function lineHunks(a: string[], b: string[]): Array<{ a1: number; a2: number; b1: number; b2: number }> {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: Array<{ a1: number; a2: number; b1: number; b2: number }> = [];
  let i = 0;
  let j = 0;
  let cur: { a1: number; a2: number; b1: number; b2: number } | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { a1: i, a2: i, b1: j, b2: j };
      cur.b2 = ++j;
    } else {
      cur ??= { a1: i, a2: i, b1: j, b2: j };
      cur.a2 = ++i;
    }
  }
  flush();
  return hunks;
}

/** Reject an edit the project's own compiler cannot parse (e.g. syntax newer than its TypeScript). */
function projectSyntaxCheck(cfg: MigrationConfig, gate: GateResult, before: string, after: string, file: string): void {
  if (!cfg.projectParse) return;
  const old = new Set(cfg.projectParse(before, file));
  const fresh = cfg.projectParse(after, file).filter((e) => !old.has(e));
  if (!fresh.length) return;
  gate.ok = false;
  gate.findings.push({
    kind: "parse",
    message: `This project's TypeScript compiler cannot parse the result (${fresh.slice(0, 2).join("; ")}). Use only syntax it supports.`,
  });
}

/** Errors that mean a binding was lost: used before assigned, cannot find name, redeclared. */
const BINDING_ERRORS = new Set([2454, 2304, 2552, 2448, 2451, 2300]);

/** Names of the project's own functions called inside `range` (declared in project files, not packages). */
function projectCallees(session: ProjectSession, sf: ts.SourceFile, range: { start: number; end: number }, oldDirs: string[]): string[] {
  const checker = session.checker;
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (n.getEnd() < range.start || n.getStart(sf) > range.end) return;
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.getStart(sf) >= range.start && n.getEnd() <= range.end) {
      const e = n.expression;
      const id = ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : null;
      const decl = id ? resolveAlias(checker, checker.getSymbolAtLocation(id))?.declarations?.[0] : undefined;
      const f = decl?.getSourceFile().fileName ?? "";
      if (id && decl && !f.includes(`${path.sep}node_modules${path.sep}`) && !f.endsWith(".d.ts") && !oldDirs.some((d) => f.startsWith(d))) out.add(id.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...out];
}

export async function runMigration(cfg: MigrationConfig): Promise<MigrationRun> {
  const t0 = Date.now();
  const armId: ArmId = cfg.arm ?? "arm1_morphapi";
  const emit = (type: string, payload: Record<string, unknown> = {}) => cfg.onEvent?.({ type, ...payload });
  const usage = { prompt: 0, completion: 0, cacheWrite: 0, cacheRead: 0 };
  const ask = async (messages: LlmMessage[]) => {
    if (cfg.propose) return cfg.propose(messages);
    const r = await generateCode({ messages, model: cfg.model });
    usage.prompt += r.usage.prompt;
    usage.completion += r.usage.completion;
    usage.cacheWrite += r.usage.cacheWrite ?? 0;
    usage.cacheRead += r.usage.cacheRead ?? 0;
    return r.code;
  };

  const session = cfg.session ?? ProjectSession.open(cfg.tsconfigPath, { requireDeps: true });
  const label = cfg.migrationLabel ?? cfg.deprecatedSpec ?? `${cfg.deprecatedModules?.join(", ") ?? "previous version"} → ${cfg.successorModule}`;
  const files = cfg.files.map((f) => path.resolve(f));
  const originals = Object.fromEntries(files.map((f) => [f, session.text(f)]));
  const baselineDiags = session.diagnostics(files);
  const baseline = diagnosticKeys(baselineDiags);
  const signaturesBefore = snapshotSignatures(session, files);
  const deprecatedModule = cfg.deprecatedModules?.[0] ?? (cfg.deprecatedSpec ?? "").split("#")[0];
  // Discover mode also drops successor imports that end up unused (an earlier attempt may have added them).
  const cleanupModules = [...(cfg.deprecatedModules ?? [deprecatedModule]), ...(cfg.spans ? cfg.successorModules ?? [cfg.successorModule] : [])];
  const oracle: ExtractedOracle | null = mergeOracles(
    (cfg.successorModules ?? [cfg.successorModule])
      .map((m) => extractOracle(session, m, files[0]))
      .filter((o): o is ExtractedOracle => o != null)
  );
  const candidates: ImportCandidate[] = oracle ? importCandidates(oracle) : [];
  const gateOpts = { deprecatedNames: cfg.deprecatedSymbols, deprecatedSpec: cfg.deprecatedSpec, deprecatedDirs: cfg.deprecatedDirs, keepReceivers: Boolean(cfg.spans) };
  const successorApi: Array<{ symbol: string; signature: string | null }> = oracle
    ? oracle.exports.map((e) => ({ symbol: e.name, signature: e.signature }))
    : cfg.successorSymbols.map((s) => ({ symbol: s, signature: null }));
  for (const [owner, ms] of Object.entries(oracle?.members ?? {})) {
    const st = cfg.spans ? oracle?.statics?.[owner] : undefined;
    if (st?.length) {
      // Discover mode: say which members live on the class and which on its instances.
      const inst = ms.filter((m) => !st.includes(m));
      successorApi.push({ symbol: `${owner} static members (${owner}.X)`, signature: st.join(", ") });
      if (inst.length) successorApi.push({ symbol: `${owner} instance members (new ${owner}(…).x)`, signature: inst.join(", ") });
    } else successorApi.push({ symbol: `${owner} members`, signature: ms.join(", ") });
  }

  // Static context, identical across calls so the provider can cache it.
  const staticContext = cfg.cacheStaticContext
    ? [
        `## Successor API (${(cfg.successorModules ?? [cfg.successorModule]).join(", ")}, read from its declarations)\n` +
          boundApi(successorApi, "", cfg.guide ?? "", 40000)
            .map((a) => `- ${a.symbol}${a.signature ? `: ${a.signature}` : ""}`)
            .join("\n"),
        cfg.guide ? `## Migration guide (prose; the Successor API list wins on conflicts)\n${cfg.guide.slice(0, 60000)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : null;
  /** Insert the cached static block after the system instructions. */
  const withStatic = (msgs: LlmMessage[]): LlmMessage[] =>
    staticContext ? [msgs[0], { role: "system", content: staticContext, cache: true }, ...msgs.slice(1)] : msgs;
  const apiExcerpt = (mention: string) => boundApi(successorApi, mention, cfg.guide ?? "", staticContext ? 3000 : cfg.apiBudget);

  const spans: WorkSpan[] = cfg.spans ?? (cfg.deprecatedSpec ? findDeprecatedReferences(session, cfg.deprecatedSpec, { files }) : []);
  emit("start", {
    arm: armId,
    model: cfg.model?.model ?? "custom",
    spans: spans.map((s) => ({ file: rel(cfg.repoRoot, s.file), line: s.startLine, text: s.text })),
    oracle: oracle ? { module: oracle.module, exports: oracle.exports.length, allowed: oracle.allowed.length } : null,
    baselineDiagnostics: baselineDiags.length,
  });

  const steps: SpanStep[] = [];
  /** Lines changed by deterministic follow-ups (async conversion, data-flow rewrites) */
  const structural = { old: [] as string[], new: [] as string[] };

  if (armId === "arm0_llm_only") {
    const byFile = new Map<string, DeprecatedCallSpan[]>();
    for (const s of spans) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
    for (const [file, list] of byFile) {
      const messages: LlmMessage[] = [
        { role: "system", content: "You migrate TypeScript code to a new API version. Output ONLY the complete updated file." },
        {
          role: "user",
          content: [
            `Migrate every use of ${label} to ${cfg.successorModule}.`,
            cfg.task ?? "",
            cfg.guide ? `## Migration guide\n${cfg.guide}` : "",
            `## ${path.basename(file)}\n\`\`\`ts\n${session.text(file)}\n\`\`\``,
          ].join("\n\n"),
        },
      ];
      const out = await ask(messages);
      session.update({ [file]: out });
      steps.push({
        file: rel(cfg.repoRoot, file),
        line: 1,
        text: `${list.length} call(s)`,
        slice: { kind: "statement", startLine: 1, text: "(whole file)" },
        escalated: false,
        prompt: messages[1].content,
        facts: null,
        attempts: [{ attempt: 1, candidate: out, ok: true, findings: [], warnings: [] }],
        accepted: out,
        imports: [],
        dataflow: null,
      });
      emit("file_rewritten", { file: rel(cfg.repoRoot, file) });
    }
  } else {
    const arm = ARMS[armId];
    const maxAttempts = arm.oracle ? (cfg.maxAttempts ?? 3) : 1;
    const byFile = new Map<string, WorkSpan[]>();
    for (const s of spans) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);

    const factsBySpan = new Map<string, SliceFacts | null>();
    if (arm.context === "slice") {
      for (const s of spans) {
        factsBySpan.set(
          `${s.file}:${s.start}`,
          sliceFactsFor(session, {
            repoRoot: cfg.repoRoot,
            files,
            span: { file: s.file, start: s.start, end: s.end, text: s.text },
            deprecatedSymbols: cfg.deprecatedSymbols,
            successorModule: cfg.successorModule,
            successorSymbols: cfg.successorSymbols,
          }).facts
        );
      }
    }
    const v1 = extractOracle(session, deprecatedModule, files[0]);
    const v2Named = new Set(oracle?.exports.filter((e) => e.kind === "named").map((e) => e.name) ?? []);
    const v1Default = v1?.exports.find((e) => e.kind === "default")?.name;
    const shared = {
      named: (v1?.exports ?? []).filter((e) => e.kind === "named" && v2Named.has(e.name)).map((e) => e.name),
      hasDefault: Boolean(v1Default && v1Default !== "default" && oracle?.exports.some((e) => e.kind === "default" && e.name === v1Default)),
    };

    const swapShift = new Map<string, number>();
    const swapped: Record<string, string> = {};
    const pairs = cfg.swapPairs ?? [{ from: deprecatedModule, to: cfg.successorModule }];
    const sharedFor = (from: string, to: string) => {
      if (from === deprecatedModule && to === cfg.successorModule && !cfg.swapPairs) return shared;
      const o1 = extractOracle(session, from, files[0]);
      const o2 = extractOracle(session, to, files[0]);
      const named = new Set(o2?.exports.filter((e) => e.kind === "named").map((e) => e.name) ?? []);
      const d1 = o1?.exports.find((e) => e.kind === "default")?.name;
      return {
        named: (o1?.exports ?? []).filter((e) => e.kind === "named" && named.has(e.name)).map((e) => e.name),
        hasDefault: Boolean(d1 && d1 !== "default" && o2?.exports.some((e) => e.kind === "default" && e.name === d1)),
      };
    };
    for (const pair of pairs) {
      const sh = sharedFor(pair.from, pair.to);
      if (!sh.named.length && !sh.hasDefault) continue;
      for (const f of files) {
        const before = session.text(f);
        const swap = swapSharedImports(before, f, { from: pair.from, to: pair.to, shared: sh });
        if (!swap.moved.length) continue;
        swapShift.set(f, (swapShift.get(f) ?? 0) + swap.code.length - before.length);
        swapped[f] = swap.code;
        session.update({ [f]: swap.code });
        emit("imports", { file: rel(cfg.repoRoot, f), swapped: swap.moved, from: pair.from, to: pair.to });
      }
    }
    if (Object.keys(swapped).length) session.update(swapped);

    for (const [file, list0] of byFile) {
      const shift = swapShift.get(file) ?? 0;
      const list = list0.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift, origStart: s.start }));
      let body = session.text(file);
      const descending = [...list].sort((a, b) => b.start - a.start);
      const hdr = lastImportEnd(session.sourceFile(file)!);

      const inserted: TextEdit[] = [];
      const shiftOf = (p: number) => inserted.filter((e) => e.pos <= p).reduce((n, e) => n + e.text.length - e.del, 0);
      /** Lowest start of a slice already rewritten in this file; spans are processed in descending order. */
      let consumedFrom = Infinity;
      for (const span0 of descending) {
        const span = { ...span0, start: span0.start + shiftOf(span0.start), end: span0.end + shiftOf(span0.start) };
        const bodySf = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
        let kind: SliceKind = span0.sliceKind ?? (needsStatementSlice(cfg.successorKind) ? "statement" : "expression");
        let slice: Slice = sliceFor(bodySf, span, kind);
        if (slice.end > consumedFrom) {
          // An earlier (escalated) rewrite already covered this site; its text has moved.
          emit("skipped", { file: rel(cfg.repoRoot, file), line: span.startLine, reason: "overlaps an earlier rewrite" });
          continue;
        }
        const spanRules = [...(span0.notes?.length ? [`The upgrade breaks this code: ${span0.notes.join(" | ")}`] : []), ...(cfg.rules ?? [])];
        let escalated = false;

        session.update({ [file]: body });
        // Pre-edit program, kept for rule learning/matching (TypeScript programs are immutable).
        const preSf = session.sourceFile(file)!;
        const preChecker = session.checker;
        const facts = factsBySpan.get(`${file}:${span.origStart}`) ?? null;

        const promptFor = (feedback?: string): LlmMessage[] => {
          const msgs = buildSlicePrompt({
            slice,
            facts,
            successorApi: apiExcerpt(`${slice.text}\n${spanRules.join("\n")}\n${feedback ?? ""}`),
            deprecatedSpec: label,
            successorModule: cfg.successorLabel ?? (cfg.successorModules ?? [cfg.successorModule]).join(", "),
            rules: spanRules,
            guide: staticContext ? undefined : boundGuide(cfg.guide, `${slice.text}\n${spanRules.join("\n")}`, cfg.guideBudget),
            feedback,
          });
          if (arm.context === "file") {
            msgs[1].content = msgs[1].content.replace(
              /## Facts \(TypeScript checker\)[\s\S]*?```json[\s\S]*?```/,
              `## File ${path.basename(file)}\n\`\`\`ts\n${body}\n\`\`\``
            );
          }
          return withStatic(msgs);
        };
        const firstPrompt = promptFor().slice(-1)[0].content;
        emit("span", { file: rel(cfg.repoRoot, file), line: span.startLine, slice: slice.text, kind, prompt: firstPrompt, facts });

        let accepted: string | null = null;
        let acceptedImports: string[] = [];
        let acceptedRange: { start: number; end: number } | null = null;
        let acceptedAsync: TextEdit[] = [];
        let acceptedBindings = "";
        let originalAny = cfg.spans ? anyProfile(session.sourceFile(file)!, session.checker, slice) : undefined;
        const bindingBefore = cfg.spans ? session.diagnostics([file]).filter((d) => BINDING_ERRORS.has(d.code)) : [];
        let keepCalls = cfg.spans ? projectCallees(session, session.sourceFile(file)!, slice, cfg.deprecatedDirs ?? []) : undefined;
        const evaluate = (candidate: string): GateResult => {
          const awaitBefore = /await\s*$/.test(body.slice(Math.max(0, slice.start - 8), slice.start));
          const code = reindent(cleanProposal(candidate, slice.kind, awaitBefore, slice.text), body, slice.start);
          if (!parsesAs(code, slice.kind)) {
            return {
              ok: false,
              findings: [{ kind: "parse", message: `Output must parse as a single ${slice.kind === "expression" ? "expression" : "statement list"}.` }],
              warnings: [],
            };
          }
          const asyncEdits = /\bawait\b/.test(code) ? asyncifyEdits(bodySf, slice.start) : [];
          const shift = asyncEdits.reduce((n, e) => n + e.text.length - e.del, 0);
          const base = applyTextEdits(body, asyncEdits);
          const spliced = base.slice(0, slice.start + shift) + code + base.slice(slice.end + shift);
          const withImports = addMissingImports(spliced, file, candidates);
          const delta = withImports.code.length - spliced.length;
          session.update({ [file]: withImports.code });
          const range = { start: slice.start + shift + delta, end: slice.start + shift + delta + code.length };
          const gate = gateSpan(session, file, range, oracle, { ...gateOpts, original: slice.text, originalAny, keepCalls });
          projectSyntaxCheck(cfg, gate, body, withImports.code, file);
          if (cfg.spans) {
            // A rewrite must not break bindings outside its slice (dropped assignment or declaration).
            const broken = session.diagnostics([file]).filter((d) => BINDING_ERRORS.has(d.code) && (d.start < range.start || d.start > range.end));
            const fresh = broken.filter((d) => !bindingBefore.some((b) => b.code === d.code && b.message === d.message));
            for (const d of fresh.slice(0, 3)) gate.findings.push({ kind: "type_error", line: d.line, code: d.code, message: `Your replacement breaks code outside the slice (line ${d.line}): ${d.message} Keep every assignment and declaration the slice made.` });
            if (fresh.length) gate.ok = false;
          }
          const result = arm.oracle ? gate : { ok: true, findings: [], warnings: [...gate.findings, ...gate.warnings] };
          if (result.ok) {
            accepted = code;
            acceptedImports = withImports.added;
            acceptedRange = range;
            acceptedAsync = asyncEdits;
            acceptedBindings = cfg.ruleBook ? bindingsIn(session.sourceFile(file)!, session.checker, range.start, range.end) : "";
          } else {
            session.update({ [file]: addMissingImports(body, file, []).code });
          }
          return result;
        };

        let attempts: AttemptRecord[] = [];
        // Learned rule first: no LLM call if the gate accepts it and its names resolve as where it was learned.
        const ruleAttempts: AttemptRecord[] = [];
        let viaRule = false;
        const suggestion = cfg.ruleBook?.suggest(preSf, preChecker, slice) ?? null;
        if (suggestion) {
          const r = evaluate(suggestion.text);
          if (r.ok && suggestion.rule.newBindings != null && acceptedBindings !== suggestion.rule.newBindings) {
            // Same text, different meaning here (e.g. a local class shadowing the SDK type): undo.
            r.ok = false;
            r.findings.push({ kind: "type_error", message: `Learned rule resolves differently here (${acceptedBindings} vs ${suggestion.rule.newBindings}).` });
            accepted = null;
            acceptedRange = null;
            acceptedImports = [];
            acceptedAsync = [];
            session.update({ [file]: addMissingImports(body, file, []).code });
          }
          ruleAttempts.push({ attempt: 0, candidate: suggestion.text, ok: r.ok, findings: r.findings, warnings: r.warnings, sliceKind: slice.kind });
          if (r.ok) suggestion.rule.uses++;
          else suggestion.rule.fails++;
          viaRule = r.ok;
          emit(r.ok ? "rule_applied" : "rule_rejected", {
            file: rel(cfg.repoRoot, file),
            line: span.startLine,
            rule: suggestion.rule.kind,
            from: `${rel(cfg.repoRoot, suggestion.rule.from.file)}:${suggestion.rule.from.line}`,
            findings: r.findings.slice(0, 2).map((f) => f.message.slice(0, 200)),
          });
        }
        const loop = viaRule
          ? { accepted: suggestion!.text, attempts: [] as AttemptRecord[] }
          : await repairLoop({
              maxAttempts,
              propose: (feedback, attempt) => {
                emit("propose", { file: rel(cfg.repoRoot, file), line: span.startLine, attempt, feedback: feedback ?? null });
                return ask(promptFor(feedback));
              },
              evaluate,
              onAttempt: (rec) => emit("attempt", { file: rel(cfg.repoRoot, file), line: span.startLine, ...rec, sliceKind: slice.kind }),
            });
        attempts = [...ruleAttempts, ...loop.attempts.map((a) => ({ ...a, sliceKind: slice.kind }))];

        const needsStatements = (fs: GateResult["findings"]) => fs.some((f) => f.kind === "parse" || f.receiverOwners?.length);
        if (!accepted && slice.kind !== "statement" && attempts.some((a) => needsStatements(a.findings) || slice.kind === "type")) {
          kind = "statement";
          slice = sliceFor(bodySf, span, "statement");
          escalated = true;
          if (cfg.spans) originalAny = anyProfile(session.sourceFile(file)!, session.checker, slice);
          if (cfg.spans) keepCalls = projectCallees(session, session.sourceFile(file)!, slice, cfg.deprecatedDirs ?? []);
          emit("escalate", { file: rel(cfg.repoRoot, file), line: span.startLine, slice: slice.text });
          const retry = await repairLoop({
            maxAttempts: arm.oracle ? 2 : 1,
            propose: (feedback) =>
              ask(promptFor(feedback ?? feedbackFor({ ok: false, findings: attempts[attempts.length - 1].findings, warnings: [] }))),
            evaluate,
            onAttempt: (rec) =>
              emit("attempt", { file: rel(cfg.repoRoot, file), line: span.startLine, ...rec, attempt: attempts.length + rec.attempt, sliceKind: "statement", escalated: true }),
          });
          attempts.push(...retry.attempts.map((a) => ({ ...a, attempt: attempts.length + a.attempt, sliceKind: kind, escalated: true })));
        }

        let dataflow: ShapeResult | null = null;
        if (accepted && acceptedRange) {
          const range = acceptedRange as { start: number; end: number };
          const acceptedCode = accepted as string;
          const linesBefore = body.split("\n");
          if (arm.dataflow) {
            dataflow = propagateResponseShape(session, file, range, {
              files,
              baseline: baselineDiags.length,
              oldResultType: facts?.result.type ?? null,
            });
            if (dataflow.mode !== "none") emit("dataflow", { file: rel(cfg.repoRoot, file), line: span.startLine, ...dataflow });
          }
          const sessionText = session.text(file);
          const withImportsLen = addMissingImports(body.slice(0, slice.start) + acceptedCode + body.slice(slice.end), file, candidates).code.length;
          const splicedLen = body.length - (slice.end - slice.start) + acceptedCode.length;
          const delta = withImportsLen - splicedLen;
          body = body.slice(0, hdr) + sessionText.slice(hdr + delta);
          if (acceptedAsync.length || dataflow?.rewrites.length) {
            const sliceText = new Set(slice.text.split("\n"));
            const linesAfter = body.split("\n");
            for (const h of lineHunks(linesBefore, linesAfter)) {
              const old = linesBefore.slice(h.a1, h.a2).filter((l) => !sliceText.has(l));
              structural.old.push(...old);
              structural.new.push(...linesAfter.slice(h.b1, h.b2));
            }
          }
          if (acceptedAsync.length) {
            inserted.push(...acceptedAsync);
            emit("asyncified", { file: rel(cfg.repoRoot, file), line: bodySf.getLineAndCharacterOfPosition(acceptedAsync[0].pos).line + 1 });
          }
          consumedFrom = Math.min(consumedFrom, slice.start);
          if (cfg.ruleBook && !viaRule) cfg.ruleBook.learn(preSf, preChecker, slice, acceptedCode, acceptedBindings);
          emit("accepted", { file: rel(cfg.repoRoot, file), line: span.startLine, code: acceptedCode, imports: acceptedImports });
        } else {
          session.update({ [file]: addMissingImports(body, file, []).code });
          emit("failed", { file: rel(cfg.repoRoot, file), line: span.startLine });
        }

        steps.push({
          file: rel(cfg.repoRoot, file),
          line: span.startLine,
          text: span.text,
          slice: { kind: slice.kind, startLine: slice.startLine, text: slice.text },
          escalated,
          prompt: firstPrompt,
          facts,
          attempts,
          accepted,
          imports: acceptedImports,
          dataflow,
          viaRule,
        });
      }

      const fin = reconcileImports(body, file, { add: candidates, cleanupModules });
      session.update({ [file]: fin.code });
      if (fin.added.length || fin.removed.length) emit("imports", { file: rel(cfg.repoRoot, file), added: fin.added, removed: fin.removed });
    }
  }

  // ── 1-hop impact + bounded repair of what it finds ─────────────────────
  const changedFiles = files.filter((f) => session.text(f) !== originals[f]);
  const impactFixes: ImpactFix[] = [];
  let impact: ProgramImpactResult | null = null;
  const armCfg = armId === "arm0_llm_only" ? null : ARMS[armId];
  const runImpact = () =>
    programImpact(session, {
      deprecatedSpec: cfg.deprecatedSpec,
      projectFiles: files,
      changedFiles,
      baselineDiagnostics: baseline,
      signaturesBefore,
      deprecatedModule: cfg.deprecatedModules ? undefined : deprecatedModule,
      deprecatedModules: cfg.deprecatedModules,
      moduleUseFiles: cfg.impactAllFiles ? files : undefined,
    });

  if (armCfg?.impact) {
    impact = runImpact();
    let current = impact;
    emit("impact", { round: 1, oneHopFiles: impact.oneHopFiles.map((f) => rel(cfg.repoRoot, f)), findings: impact.findings, changedFunctions: impact.changedFunctions });
    for (let round = 2; round <= 1 + (cfg.impactRounds ?? 2) && !current.complete; round++) {
      let fixed = 0;
      const repairedStatements = new Set<string>();
      const ordered = [...current.findings].sort((a, b) => a.file.localeCompare(b.file) || (b.start ?? 0) - (a.start ?? 0));
      for (const f of ordered.slice(0, cfg.impactLimit ?? 8)) {
        const sf = session.sourceFile(f.file);
        if (!sf || f.start == null) continue;
        if (f.reason === "missing_await") {
          const text = session.text(f.file);
          const before = session.diagnostics([f.file]).length;
          const next = text.slice(0, f.start) + "await " + text.slice(f.start);
          session.update({ [f.file]: next });
          if (session.diagnostics([f.file]).length > before) {
            session.update({ [f.file]: text });
            continue;
          }
          const lineAt = (t: string, p: number) => t.slice(t.lastIndexOf("\n", p - 1) + 1, t.indexOf("\n", p) < 0 ? t.length : t.indexOf("\n", p));
          structural.old.push(lineAt(text, f.start));
          structural.new.push(lineAt(next, f.start));
          impactFixes.push({ reason: f.reason, file: rel(cfg.repoRoot, f.file), line: f.line, before: "", after: "await ", attempts: 0 });
          fixed++;
          continue;
        }
        if (f.reason !== "new_type_error" && f.reason !== "same_api_leftover" && f.reason !== "deprecated_module_use") continue;
        // Def-use attribution: if the broken statement reads a value produced by a site we
        // already rewrote, repair that producer instead of patching over the symptom here.
        // Producer first; once it has been tried, later findings repair their own statement.
        const accepted = [...(cfg.priorAccepted ?? []), ...steps].map((x) => ({ ...x, abs: path.resolve(cfg.repoRoot, x.file) }));
        const found = f.reason === "new_type_error" && cfg.spans && !cfg.noAttribution ? producerOf(session, sf, f.start, accepted) : null;
        const foundSf = found ? session.sourceFile(found.file) : undefined;
        const producer = found && foundSf && !repairedStatements.has(`${found.file}:${sliceFor(foundSf, found, "statement").start}`) ? found : null;
        // The statement to repair may live in another file (a rewritten type alias, say).
        const tFile = producer?.file ?? f.file;
        const tsf = session.sourceFile(tFile)!;
        const slice = sliceFor(tsf, producer ?? { start: f.start, end: f.start + 1 }, "statement");
        if (producer) emit("attributed", { file: rel(cfg.repoRoot, f.file), line: f.line, producerFile: rel(cfg.repoRoot, tFile), producerLine: slice.startLine, detail: f.detail });
        const stmtKey = `${tFile}:${slice.start}`;
        if (repairedStatements.has(stmtKey)) continue;
        repairedStatements.add(stmtKey);
        const moduleUse = f.reason === "deprecated_module_use" ? new RegExp(`\\b${f.symbol}\\b`) : null;
        const text = session.text(tFile);
        const checkFiles = [...new Set([tFile, f.file])];
        const fileDiagsBefore = session.diagnostics(checkFiles).length;
        let acceptedFix: string | null = null;
        const repairFacts =
          armCfg.context === "slice" && cfg.spans
            ? sliceFactsFor(session, {
                repoRoot: cfg.repoRoot,
                files,
                span: { file: tFile, start: slice.start, end: slice.end, text: slice.text },
                deprecatedSymbols: cfg.deprecatedSymbols,
                successorModule: cfg.successorModule,
                successorSymbols: cfg.successorSymbols,
              }).facts
            : null;
        const repairAny = cfg.spans ? anyProfile(tsf, session.checker, slice) : undefined;
        const keepCalls = cfg.spans ? projectCallees(session, tsf, slice, cfg.deprecatedDirs ?? []) : undefined;
        const loop = await repairLoop({
          maxAttempts: armCfg.oracle ? 2 : 1,
          propose: (feedback) =>
            ask(
              withStatic(buildSlicePrompt({
                slice,
                facts: repairFacts,
                successorApi: apiExcerpt(`${slice.text}\n${f.detail}\n${feedback ?? ""}`),
                deprecatedSpec: label,
                successorModule: cfg.successorLabel ?? (cfg.successorModules ?? [cfg.successorModule]).join(", "),
                rules: [
                  producer
                    ? `This statement was migrated earlier, and a later use of it now fails${tFile === f.file ? "" : ` in ${rel(cfg.repoRoot, f.file)}`} at line ${f.line}: ${f.detail}. Change this statement so the later use type-checks (e.g. keep literal types precise).`
                    : `This statement breaks after the migration: ${f.detail}`,
                  "Fix it without changing behavior.",
                  ...(cfg.rules ?? []),
                ],
                guide: staticContext ? undefined : boundGuide(cfg.guide, `${slice.text}\n${f.detail}`, cfg.guideBudget),
                feedback,
              }))
            ),
          evaluate: (candidate) => {
            const code = reindent(cleanProposal(candidate, "statement", false, slice.text), text, slice.start);
            if (!parsesAs(code, "statement")) return { ok: false, findings: [{ kind: "parse", message: "Output must parse as statements." }], warnings: [] };
            const spliced = text.slice(0, slice.start) + code + text.slice(slice.end);
            const withImports = addMissingImports(spliced, tFile, candidates);
            const delta = withImports.code.length - spliced.length;
            session.update({ [tFile]: withImports.code });
            const gate = gateSpan(session, tFile, { start: slice.start + delta, end: slice.start + delta + code.length }, oracle, {
              ...gateOpts,
              original: slice.text,
              originalAny: repairAny,
              keepCalls,
            });
            projectSyntaxCheck(cfg, gate, text, withImports.code, tFile);
            const after = session.diagnostics(checkFiles);
            if (gate.ok && moduleUse) {
              if (moduleUse.test(code)) {
                gate.ok = false;
                gate.findings.push({ kind: "leftover", symbol: f.symbol, message: `The replacement still uses ${f.symbol} from ${deprecatedModule}.` });
              } else if (after.length > fileDiagsBefore) {
                gate.ok = false;
                gate.findings.push(...after.slice(0, 3).map((d) => ({ kind: "type_error" as const, line: d.line, code: d.code, message: `Line ${d.line}: ${d.message}` })));
              }
            } else if (gate.ok && after.length >= fileDiagsBefore) {
              gate.ok = false;
              gate.findings.push(
                ...after.slice(0, 3).map((d) => ({ kind: "type_error" as const, line: d.line, code: d.code, message: `Line ${d.line}: ${d.message}` }))
              );
            }
            if (gate.ok) acceptedFix = code;
            else session.update({ [tFile]: text });
            return gate;
          },
          onAttempt: (rec) => emit("repair_attempt", { file: rel(cfg.repoRoot, f.file), line: f.line, reason: f.reason, ...rec }),
        });
        impactFixes.push({
          reason: f.reason,
          file: rel(cfg.repoRoot, tFile),
          line: f.line,
          before: slice.text,
          after: acceptedFix,
          attempts: loop.attempts.length,
          tries: loop.attempts,
        });
        if (acceptedFix) fixed++;
      }
      if (!fixed) break;
      const touched = files.filter((f) => session.text(f) !== originals[f]);
      for (const t of touched) if (!changedFiles.includes(t)) changedFiles.push(t);
      current = runImpact();
      emit("impact", { round, oneHopFiles: current.oneHopFiles.map((f) => rel(cfg.repoRoot, f)), findings: current.findings, fixes: impactFixes });
    }
  }

  if (armCfg) {
    const cleaned: Record<string, string> = {};
    for (const f of files) {
      if (session.text(f) === originals[f]) continue;
      const r = reconcileImports(session.text(f), f, { add: candidates, cleanupModules });
      if (r.code !== session.text(f)) cleaned[f] = r.code;
    }
    if (Object.keys(cleaned).length) session.update(cleaned);
  }

  // ── Final verification + metrics ───────────────────────────────────────
  const finalImpact = runImpact();
  const leftovers = finalImpact.findings.filter((f) => f.reason === "same_api_leftover").length;
  const moduleUses = finalImpact.findings.filter((f) => f.reason === "deprecated_module_use").length;
  const remaining = new Map(baseline);
  const newDiagnostics: MigrationRun["final"]["newDiagnostics"] = [];
  for (const d of session.diagnostics(files)) {
    const k = `${d.file}|${d.code}|${d.message}`;
    const n = remaining.get(k) ?? 0;
    if (n > 0) remaining.set(k, n - 1);
    else newDiagnostics.push({ file: rel(cfg.repoRoot, d.file), line: d.line, message: `TS${d.code}: ${d.message}` });
  }
  const phantomDiagnostics = newDiagnostics.filter((d) => /^TS(2339|2551|2304|2552|2305|2724):/.test(d.message)).length;

  let changedLines = 0;
  let outside = 0;
  let importLines = 0;
  const patches: MigrationRun["patches"] = {};
  // A changed line is "inside" when it belongs to a migrated span, an impact repair, or an import.
  const linesOf = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const allowedOld = new Set([
    ...spans.flatMap((s) => linesOf(s.text)),
    ...steps.flatMap((s) => (s.slice.text === "(whole file)" ? [] : linesOf(s.slice.text))),
    ...impactFixes.flatMap((x) => linesOf(x.before)),
    ...structural.old.flatMap(linesOf),
  ]);
  const allowedNew = new Set([
    ...steps.flatMap((s) => (armId === "arm0_llm_only" ? [] : linesOf(s.accepted))),
    ...impactFixes.flatMap((x) => linesOf(x.after)),
    ...structural.new.flatMap(linesOf),
  ]);
  const allows = (set: Set<string>, line: string) => {
    const t = line.trim();
    if (/^[(){}[\];,]*$/.test(t)) return true;
    return set.has(t) || [...set].some((x) => (x.length >= 5 && t.includes(x)) || (t.length >= 8 && x.includes(t)));
  };
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const importLineSet = (file: string, text: string) => {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const set = new Set<number>();
    for (const st of sf.statements.filter(ts.isImportDeclaration)) {
      for (let l = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line; l <= sf.getLineAndCharacterOfPosition(st.getEnd()).line; l++) set.add(l);
    }
    return set;
  };
  for (const f of files) {
    const after = session.text(f);
    if (after === originals[f]) continue;
    patches[rel(cfg.repoRoot, f)] = { before: originals[f], after };
    const a = originals[f].split("\n");
    const b = after.split("\n");
    const impA = importLineSet(f, originals[f]);
    const impB = importLineSet(f, after);
    for (const h of lineHunks(a, b)) {
      const oldIdx = range(h.a1, h.a2).filter((i) => a[i].trim());
      const newIdx = range(h.b1, h.b2).filter((i) => b[i].trim());
      const n = h.a2 - h.a1 + (h.b2 - h.b1);
      changedLines += n;
      if (oldIdx.every((i) => impA.has(i)) && newIdx.every((i) => impB.has(i))) {
        importLines += n;
        continue;
      }
      const oldOk = oldIdx.every((i) => impA.has(i) || allows(allowedOld, a[i]));
      const newOk = armId === "arm0_llm_only" ? oldIdx.length > 0 : newIdx.every((i) => impB.has(i) || allows(allowedNew, b[i]));
      if (!(oldOk && newOk)) outside += n;
    }
  }

  const allAttempts = steps.flatMap((s) => s.attempts);
  const run: MigrationRun = {
    arm: armId,
    model: cfg.model?.model ?? "custom",
    deprecatedSpec: cfg.deprecatedSpec ?? label,
    successorModule: cfg.successorModule,
    oracle: oracle ? { exports: oracle.exports.length, allowed: oracle.allowed.length } : null,
    steps,
    impact: impact && {
      ...impact,
      oneHopFiles: impact.oneHopFiles.map((f) => rel(cfg.repoRoot, f)),
      findings: impact.findings.map((f) => ({ ...f, file: rel(cfg.repoRoot, f.file) })),
      changedFunctions: impact.changedFunctions.map((c) => ({ ...c, file: rel(cfg.repoRoot, c.file) })),
    },
    impactFixes,
    final: {
      leftovers,
      deprecatedModuleUses: moduleUses,
      newDiagnostics,
      phantomDiagnostics,
      complete: leftovers === 0 && moduleUses === 0 && newDiagnostics.length === 0 && steps.every((s) => s.accepted != null),
    },
    metrics: {
      spansFound: spans.length,
      spansMigrated: armId === "arm0_llm_only" ? Math.max(0, spans.length - leftovers) : steps.filter((s) => s.accepted != null).length,
      attempts: allAttempts.length,
      phantomRejections: allAttempts.reduce((n, a) => n + a.findings.filter((f) => f.kind === "phantom").length, 0),
      escalations: steps.filter((s) => s.escalated).length,
      dynamicAccessWarnings: allAttempts.reduce((n, a) => n + a.warnings.filter((w) => w.kind === "dynamic_access").length, 0),
      changedLines,
      linesOutsideSpans: outside,
      importLinesChanged: importLines,
      churnRatio: changedLines ? outside / changedLines : 0,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      cacheWriteTokens: usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
    },
    patches,
    ms: Date.now() - t0,
  };
  emit("done", { final: run.final, metrics: run.metrics });
  return run;
}
