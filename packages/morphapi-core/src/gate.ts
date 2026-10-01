/**
 * Mechanism 2 — oracle gating with targeted feedback. A proposal is spliced
 * into the in-memory program and the TypeChecker judges the patched span:
 * missing members / names are phantoms (rejected, with suggestions);
 * dynamic element access is only a warning.
 */
import * as ts from "typescript";
import { detectEvasionTactics } from "./inspector";
import type { ExtractedOracle } from "./oracleExtract";
import { suggestSymbols } from "./oracleExtract";
import { resolveSymbolSpec, sameSymbol, type ProjectSession } from "./program";

export type GateFindingKind = "phantom" | "type_error" | "dynamic_access" | "parse" | "evasion" | "leftover";

export type GateFinding = {
  kind: GateFindingKind;
  symbol?: string;
  line?: number;
  code?: number;
  message: string;
  suggestions?: string[];
  /** Successor types that own the missing member (receiver is a non-successor value) */
  receiverOwners?: string[];
};

export type GateResult = {
  ok: boolean;
  findings: GateFinding[];
  warnings: GateFinding[];
};

const PHANTOM_MEMBER = new Set([2339, 2551]);
const PHANTOM_NAME = new Set([2304, 2552]);
const PHANTOM_MODULE = new Set([2305, 2307, 2724]);

function nodeAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= pos && pos < n.getEnd()) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

/**
 * Judge the replacement occupying `range` in the session's current version
 * of `file`. Diagnostics outside the range are left to impact analysis.
 */
export function gateSpan(
  session: ProjectSession,
  file: string,
  range: { start: number; end: number },
  oracle: ExtractedOracle | null,
  opts: { deprecatedNames?: string[]; deprecatedSpec?: string } = {}
): GateResult {
  const sf = session.sourceFile(file);
  if (!sf) return { ok: false, findings: [{ kind: "parse", message: `File not in program: ${file}` }], warnings: [] };
  const checker = session.checker;
  const findings: GateFinding[] = [];
  const warnings: GateFinding[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const replaced = sf.text.slice(range.start, range.end);

  for (const ev of detectEvasionTactics(replaced)) {
    findings.push({ kind: "evasion", symbol: ev.symbol, message: ev.reason, line: lineOf(range.start) });
  }

  for (const d of session.diagnostics([file])) {
    if (d.start < range.start || d.start > range.end) continue;
    const node = nodeAt(sf, d.start);
    const ident = node && ts.isIdentifier(node) ? node : undefined;
    if (PHANTOM_MEMBER.has(d.code) && ident && ts.isPropertyAccessExpression(ident.parent)) {
      const recv = checker.getTypeAtLocation(ident.parent.expression);
      const valid = recv.getProperties().map((p) => p.name);
      const recvText = checker.typeToString(recv);
      const recvLabel = recvText.length > 80 ? `${recvText.slice(0, 77)}...` : recvText;
      const owners = Object.entries(oracle?.members ?? {})
        .filter(([, ms]) => ms.includes(ident.text))
        .map(([owner]) => owner);
      findings.push({
        kind: "phantom",
        symbol: `${recvLabel}.${ident.text}`,
        line: d.line,
        code: d.code,
        message: owners.length
          ? `${ident.text} exists on ${owners.join(", ")} from ${oracle!.module}, but \`${ident.parent.expression.getText(sf)}\` is not one of those (its type is ${recvLabel}). Obtain a ${owners[0]} value from the successor API first.`
          : `Symbol ${ident.text} does not exist on ${recvLabel}.`,
        suggestions: owners.length ? [] : suggestSymbols(ident.text, valid),
        receiverOwners: owners.length ? owners : undefined,
      });
    } else if (PHANTOM_NAME.has(d.code) && ident) {
      const inScope = checker
        .getSymbolsInScope(ident, ts.SymbolFlags.Value | ts.SymbolFlags.Type)
        .filter((s) => s.declarations?.some((decl) => !session.program.isSourceFileDefaultLibrary(decl.getSourceFile())));
      const owners = new Set(Object.keys(oracle?.members ?? {}));
      const typedLocals = inScope
        .filter((s) => s.flags & ts.SymbolFlags.Variable)
        .map((s) => ({ name: s.name, type: checker.typeToString(checker.getTypeOfSymbolAtLocation(s, ident)) }))
        .filter((l) => owners.has(l.type));
      const pool = [...(oracle?.exports.map((e) => e.name) ?? []), ...inScope.map((s) => s.name)];
      const preferred = [...typedLocals.map((l) => l.name), ...(oracle?.exports.map((e) => e.name) ?? [])];
      findings.push({
        kind: "phantom",
        symbol: ident.text,
        line: d.line,
        code: d.code,
        message:
          `Symbol ${ident.text} does not exist in ${oracle?.module ?? "the target SDK"} or in scope.` +
          (typedLocals.length ? ` In scope with successor types: ${typedLocals.map((l) => `${l.name}: ${l.type}`).join(", ")}.` : ""),
        suggestions: suggestSymbols(ident.text, pool, 3, preferred),
      });
    } else if (PHANTOM_MODULE.has(d.code)) {
      findings.push({ kind: "phantom", line: d.line, code: d.code, message: d.message });
    } else if (d.code === 7053 || d.code === 7015) {
      warnings.push({ kind: "dynamic_access", line: d.line, code: d.code, message: d.message });
    } else {
      findings.push({ kind: "type_error", line: d.line, code: d.code, message: d.message });
    }
  }

  const deprecated = new Set(opts.deprecatedNames ?? []);
  const target = opts.deprecatedSpec ? resolveSymbolSpec(session, opts.deprecatedSpec, file)?.symbol : undefined;
  if (target) deprecated.add(target.name);
  const isDeprecated = (n: ts.Identifier) =>
    deprecated.has(n.text) && (!target || sameSymbol(checker, checker.getSymbolAtLocation(n), target));
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) >= range.start && n.getEnd() <= range.end) {
      if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
        warnings.push({
          kind: "dynamic_access",
          symbol: n.argumentExpression.text,
          line: lineOf(n.getStart(sf)),
          message: `Dynamic access ["${n.argumentExpression.text}"] is not checked against the oracle.`,
        });
      }
      if (ts.isIdentifier(n) && isDeprecated(n)) {
        const p = n.parent;
        const callee = ts.isPropertyAccessExpression(p) && p.name === n ? p : n;
        if (ts.isCallExpression(callee.parent) && callee.parent.expression === callee) {
          findings.push({
            kind: "leftover",
            symbol: n.text,
            line: lineOf(n.getStart(sf)),
            message: `The replacement still calls the deprecated ${n.text}().`,
          });
        }
      }
    }
    if (n.getEnd() >= range.start && n.getStart(sf) <= range.end) ts.forEachChild(n, visit);
  };
  visit(sf);

  return { ok: findings.length === 0, findings, warnings };
}

/** Targeted feedback text for the next attempt. */
export function feedbackFor(result: GateResult): string {
  return result.findings
    .map((f) => {
      const opts = f.suggestions?.length ? ` Valid options: [${f.suggestions.join(", ")}]` : "";
      return `- ${f.message}${opts}`;
    })
    .join("\n");
}

export type AttemptRecord = {
  attempt: number;
  candidate: string;
  ok: boolean;
  findings: GateFinding[];
  warnings: GateFinding[];
  feedbackSent?: string;
  sliceKind?: "expression" | "statement";
  escalated?: boolean;
};

/**
 * Propose → gate → feedback, up to `maxAttempts`. Returns the first accepted
 * candidate, or null. Never substitutes a template answer.
 */
export async function repairLoop(opts: {
  maxAttempts: number;
  propose: (feedback: string | undefined, attempt: number) => Promise<string>;
  evaluate: (candidate: string, attempt: number) => Promise<GateResult> | GateResult;
  onAttempt?: (rec: AttemptRecord) => void;
}): Promise<{ accepted: string | null; attempts: AttemptRecord[] }> {
  const attempts: AttemptRecord[] = [];
  let feedback: string | undefined;
  for (let i = 1; i <= opts.maxAttempts; i++) {
    const candidate = await opts.propose(feedback, i);
    const res = await opts.evaluate(candidate, i);
    const rec: AttemptRecord = { attempt: i, candidate, ok: res.ok, findings: res.findings, warnings: res.warnings, feedbackSent: feedback };
    attempts.push(rec);
    opts.onAttempt?.(rec);
    if (res.ok) return { accepted: candidate, attempts };
    feedback = feedbackFor(res);
  }
  return { accepted: null, attempts };
}
