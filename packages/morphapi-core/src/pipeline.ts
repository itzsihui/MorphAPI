/**
 * Generic MorphAPI migration pipeline over a real ts.Program:
 *   findDeprecatedReferences → slice + facts → LLM → gate (+ feedback) →
 *   import reconciliation → response-shape propagation → 1-hop impact.
 * Arms toggle mechanisms so ablations run the same code path.
 */
import * as path from "path";
import * as ts from "typescript";
import { feedbackFor, gateSpan, repairLoop, type AttemptRecord, type GateResult } from "./gate";
import { propagateResponseShape, type ShapeResult } from "./dataflow";
import { reconcileImports, addMissingImports, swapSharedImports, type ImportCandidate } from "./importReconcile";
import {
  diagnosticKeys,
  programImpact,
  snapshotSignatures,
  type ProgramImpactResult,
} from "./impactProgram";
import { generateCode, type LlmMessage, type ModelProfile } from "./llm";
import { extractOracle, importCandidates, type ExtractedOracle } from "./oracleExtract";
import { ProjectSession, findDeprecatedReferences, type DeprecatedCallSpan } from "./program";
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
  deprecatedSpec: string;
  deprecatedSymbols: string[];
  successorModule: string;
  successorSymbols: string[];
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
};

export type ImpactFix = {
  reason: string;
  file: string;
  line: number;
  before: string;
  after: string | null;
  attempts: number;
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
  };
  patches: Record<string, { before: string; after: string }>;
  ms: number;
};

const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join("/");

function cleanProposal(raw: string, kind: SliceKind, awaitBefore: boolean): string {
  let s = raw
    .split("\n")
    .filter((l) => !/^\s*import\s.+from\s/.test(l))
    .join("\n")
    .trim();
  if (kind === "expression") {
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
function lineHunks(a: string[], b: string[]): Array<{ a1: number; a2: number; b1: number; b2: number }> {
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

export async function runMigration(cfg: MigrationConfig): Promise<MigrationRun> {
  const t0 = Date.now();
  const armId: ArmId = cfg.arm ?? "arm1_morphapi";
  const emit = (type: string, payload: Record<string, unknown> = {}) => cfg.onEvent?.({ type, ...payload });
  const usage = { prompt: 0, completion: 0 };
  const ask = async (messages: LlmMessage[]) => {
    if (cfg.propose) return cfg.propose(messages);
    const r = await generateCode({ messages, model: cfg.model });
    usage.prompt += r.usage.prompt;
    usage.completion += r.usage.completion;
    return r.code;
  };

  const session = ProjectSession.open(cfg.tsconfigPath, { requireDeps: true });
  const files = cfg.files.map((f) => path.resolve(f));
  const originals = Object.fromEntries(files.map((f) => [f, session.text(f)]));
  const baselineDiags = session.diagnostics(files);
  const baseline = diagnosticKeys(baselineDiags);
  const signaturesBefore = snapshotSignatures(session, files);
  const deprecatedModule = cfg.deprecatedSpec.split("#")[0];
  const oracle: ExtractedOracle | null = extractOracle(session, cfg.successorModule, files[0]);
  const candidates: ImportCandidate[] = oracle ? importCandidates(oracle) : [];
  const successorApi: Array<{ symbol: string; signature: string | null }> = oracle
    ? oracle.exports.map((e) => ({ symbol: e.name, signature: e.signature }))
    : cfg.successorSymbols.map((s) => ({ symbol: s, signature: null }));
  for (const [owner, ms] of Object.entries(oracle?.members ?? {})) {
    successorApi.push({ symbol: `${owner} members`, signature: ms.join(", ") });
  }

  const spans = findDeprecatedReferences(session, cfg.deprecatedSpec, { files });
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
            `Migrate every use of ${cfg.deprecatedSpec} to ${cfg.successorModule}.`,
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
    const byFile = new Map<string, DeprecatedCallSpan[]>();
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
    for (const f of files) {
      const swap = swapSharedImports(session.text(f), f, { from: deprecatedModule, to: cfg.successorModule, shared });
      if (!swap.moved.length) continue;
      swapShift.set(f, swap.code.length - session.text(f).length);
      swapped[f] = swap.code;
      emit("imports", { file: rel(cfg.repoRoot, f), swapped: swap.moved });
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
      for (const span0 of descending) {
        const span = { ...span0, start: span0.start + shiftOf(span0.start), end: span0.end + shiftOf(span0.start) };
        const bodySf = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
        let kind: SliceKind = needsStatementSlice(cfg.successorKind) ? "statement" : "expression";
        let slice: Slice = sliceFor(bodySf, span, kind);
        let escalated = false;

        session.update({ [file]: body });
        const facts = factsBySpan.get(`${file}:${span.origStart}`) ?? null;

        const promptFor = (feedback?: string): LlmMessage[] => {
          const msgs = buildSlicePrompt({
            slice,
            facts,
            successorApi,
            deprecatedSpec: cfg.deprecatedSpec,
            successorModule: cfg.successorModule,
            rules: cfg.rules,
            guide: cfg.guide,
            feedback,
          });
          if (arm.context === "file") {
            msgs[1].content = msgs[1].content.replace(
              /## Facts \(TypeScript checker\)[\s\S]*?```json[\s\S]*?```/,
              `## File ${path.basename(file)}\n\`\`\`ts\n${body}\n\`\`\``
            );
          }
          return msgs;
        };
        const firstPrompt = promptFor()[1].content;
        emit("span", { file: rel(cfg.repoRoot, file), line: span.startLine, slice: slice.text, kind, prompt: firstPrompt, facts });

        let accepted: string | null = null;
        let acceptedImports: string[] = [];
        let acceptedRange: { start: number; end: number } | null = null;
        let acceptedAsync: TextEdit[] = [];
        const evaluate = (candidate: string): GateResult => {
          const awaitBefore = /await\s*$/.test(body.slice(Math.max(0, slice.start - 8), slice.start));
          const code = reindent(cleanProposal(candidate, slice.kind, awaitBefore), body, slice.start);
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
          const gate = gateSpan(session, file, range, oracle, { deprecatedNames: cfg.deprecatedSymbols, deprecatedSpec: cfg.deprecatedSpec });
          const result = arm.oracle ? gate : { ok: true, findings: [], warnings: [...gate.findings, ...gate.warnings] };
          if (result.ok) {
            accepted = code;
            acceptedImports = withImports.added;
            acceptedRange = range;
            acceptedAsync = asyncEdits;
          } else {
            session.update({ [file]: addMissingImports(body, file, []).code });
          }
          return result;
        };

        let attempts: AttemptRecord[] = [];
        const loop = await repairLoop({
          maxAttempts,
          propose: (feedback, attempt) => {
            emit("propose", { file: rel(cfg.repoRoot, file), line: span.startLine, attempt, feedback: feedback ?? null });
            return ask(promptFor(feedback));
          },
          evaluate,
          onAttempt: (rec) => emit("attempt", { file: rel(cfg.repoRoot, file), line: span.startLine, ...rec, sliceKind: slice.kind }),
        });
        attempts = loop.attempts.map((a) => ({ ...a, sliceKind: slice.kind }));

        const needsStatements = (fs: GateResult["findings"]) => fs.some((f) => f.kind === "parse" || f.receiverOwners?.length);
        if (!accepted && slice.kind === "expression" && attempts.some((a) => needsStatements(a.findings))) {
          kind = "statement";
          slice = sliceFor(bodySf, span, "statement");
          escalated = true;
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
        });
      }

      const fin = reconcileImports(body, file, { add: candidates, cleanupModules: [deprecatedModule] });
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
      deprecatedModule,
    });

  if (armCfg?.impact) {
    impact = runImpact();
    let current = impact;
    emit("impact", { round: 1, oneHopFiles: impact.oneHopFiles.map((f) => rel(cfg.repoRoot, f)), findings: impact.findings, changedFunctions: impact.changedFunctions });
    for (let round = 2; round <= 3 && !current.complete; round++) {
      let fixed = 0;
      const repairedStatements = new Set<string>();
      const ordered = [...current.findings].sort((a, b) => a.file.localeCompare(b.file) || (b.start ?? 0) - (a.start ?? 0));
      for (const f of ordered.slice(0, 8)) {
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
        const slice = sliceFor(sf, { start: f.start, end: f.start + 1 }, "statement");
        const stmtKey = `${f.file}:${slice.start}`;
        if (repairedStatements.has(stmtKey)) continue;
        repairedStatements.add(stmtKey);
        const moduleUse = f.reason === "deprecated_module_use" ? new RegExp(`\\b${f.symbol}\\b`) : null;
        const text = session.text(f.file);
        const fileDiagsBefore = session.diagnostics([f.file]).length;
        let acceptedFix: string | null = null;
        const loop = await repairLoop({
          maxAttempts: armCfg.oracle ? 2 : 1,
          propose: (feedback) =>
            ask(
              buildSlicePrompt({
                slice,
                facts: null,
                successorApi,
                deprecatedSpec: cfg.deprecatedSpec,
                successorModule: cfg.successorModule,
                rules: [`This statement breaks after the migration: ${f.detail}`, "Fix it without changing behavior.", ...(cfg.rules ?? [])],
                guide: cfg.guide,
                feedback,
              })
            ),
          evaluate: (candidate) => {
            const code = reindent(cleanProposal(candidate, "statement", false), text, slice.start);
            if (!parsesAs(code, "statement")) return { ok: false, findings: [{ kind: "parse", message: "Output must parse as statements." }], warnings: [] };
            const spliced = text.slice(0, slice.start) + code + text.slice(slice.end);
            const withImports = addMissingImports(spliced, f.file, candidates);
            const delta = withImports.code.length - spliced.length;
            session.update({ [f.file]: withImports.code });
            const gate = gateSpan(session, f.file, { start: slice.start + delta, end: slice.start + delta + code.length }, oracle, {
              deprecatedNames: cfg.deprecatedSymbols,
              deprecatedSpec: cfg.deprecatedSpec,
            });
            const after = session.diagnostics([f.file]);
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
            else session.update({ [f.file]: text });
            return gate;
          },
        });
        impactFixes.push({ reason: f.reason, file: rel(cfg.repoRoot, f.file), line: f.line, before: slice.text, after: acceptedFix, attempts: loop.attempts.length });
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
      const r = reconcileImports(session.text(f), f, { add: candidates, cleanupModules: [deprecatedModule] });
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
    return set.has(t) || [...set].some((x) => x.length >= 8 && t.length >= 8 && (t.includes(x) || x.includes(t)));
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
    deprecatedSpec: cfg.deprecatedSpec,
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
    },
    patches,
    ms: Date.now() - t0,
  };
  emit("done", { final: run.final, metrics: run.metrics });
  return run;
}
