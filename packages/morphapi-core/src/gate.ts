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
import { resolveAlias, resolveSymbolSpec, sameSymbol, type ProjectSession } from "./program";

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

/** Literal members of the type a literal at `node` is compared or assigned against. */
function literalOptions(checker: ts.TypeChecker, node: ts.Node): string[] {
  if (!ts.isStringLiteral(node) && !ts.isNumericLiteral(node)) return [];
  const clause = ts.isCaseClause(node.parent) ? node.parent : undefined;
  const target = clause
    ? checker.getTypeAtLocation(clause.parent.parent.expression)
    : checker.getContextualType(node);
  if (!target) return [];
  const members = target.isUnion() ? target.types : [target];
  return members.filter((t) => t.isStringLiteral() || t.isNumberLiteral()).map((t) => checker.typeToString(t));
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
  opts: {
    deprecatedNames?: string[];
    deprecatedSpec?: string;
    /** Folders of the previous SDK version: any reference that resolves into them is a leftover. */
    deprecatedDirs?: string[];
    /** Text the replacement stands in for; evasion patterns already in it are not the model's doing. */
    original?: string;
    /** Untyped values in the original slice (see anyProfile); new ones are rejected. */
    originalAny?: AnyProfile;
    /** The project's own functions the original slice calls; the replacement must still call them. */
    keepCalls?: string[];
  } = {}
): GateResult {
  const sf = session.sourceFile(file);
  if (!sf) return { ok: false, findings: [{ kind: "parse", message: `File not in program: ${file}` }], warnings: [] };
  const checker = session.checker;
  const findings: GateFinding[] = [];
  const warnings: GateFinding[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const replaced = sf.text.slice(range.start, range.end);

  const preexisting = new Set(opts.original ? detectEvasionTactics(opts.original).map((e) => e.symbol) : []);
  for (const ev of detectEvasionTactics(replaced)) {
    if (preexisting.has(ev.symbol)) continue;
    findings.push({ kind: "evasion", symbol: ev.symbol, message: ev.reason, line: lineOf(range.start) });
  }

  // An `any` the original did not have silences every error downstream of it
  // (e.g. `const openai = client.httpAgent` where httpAgent is typed any).
  if (opts.originalAny) {
    const now = anyProfile(sf, checker, range);
    if (now.value && !opts.originalAny.value) {
      findings.push({ kind: "evasion", line: lineOf(range.start), message: "The replacement has type any, which hides type errors wherever its value is used. Produce a value with a real type from the new API." });
    }
    for (const v of now.vars.filter((x) => !opts.originalAny!.vars.includes(x))) {
      findings.push({ kind: "evasion", symbol: v, line: lineOf(range.start), message: `\`${v}\` gets type any, which hides type errors wherever it is used. Give it a value with a real type from the new API.` });
    }
  }

  // Behaviour guard: migrating SDK usage never means bypassing the project's own helpers.
  for (const name of opts.keepCalls ?? []) {
    if (!new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\s*(<[^()]*>)?\\s*\\(`).test(replaced)) {
      findings.push({
        kind: "type_error",
        symbol: name,
        line: lineOf(range.start),
        message: `The original calls the project's own ${name}(); keep calling it and adapt only what is passed to it or done with its result. Fix ${name} itself separately if needed.`,
      });
    }
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
          ? `${ident.text} exists on ${owners.join(", ")} from ${oracle!.module}, but \`${ident.parent.expression.getText(sf)}\` is a deprecated value (type ${recvLabel}), not a ${owners[0]}. ` +
            `Do not use \`${ident.parent.expression.getText(sf)}\` as the receiver. Create a ${owners[0]} in your output${
              oracle!.obtain[owners[0]] ? ` with ${oracle!.obtain[owners[0]].replace(/\):.*$/, ")")}` : ""
            } under a new name and call ${ident.text} on it.`
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
      const options = node ? literalOptions(checker, node) : [];
      findings.push({
        kind: "type_error",
        line: d.line,
        code: d.code,
        message: options.length ? `${d.message} Allowed values: ${options.join(", ")}.` : d.message,
        suggestions: options.length && node && ts.isStringLiteral(node) ? suggestSymbols(node.text, options.map((o) => String(JSON.parse(o)))) : undefined,
      });
    }
  }

  const deprecated = new Set(opts.deprecatedNames ?? []);
  const target = opts.deprecatedSpec ? resolveSymbolSpec(session, opts.deprecatedSpec, file)?.symbol : undefined;
  if (target) deprecated.add(target.name);
  const isDeprecated = (n: ts.Identifier) =>
    deprecated.has(n.text) && (!target || sameSymbol(checker, checker.getSymbolAtLocation(n), target));
  const dirs = (opts.deprecatedDirs ?? []).map((d) => d.replace(/\/+$/, "") + "/");
  const fromOldVersion = (n: ts.Identifier): boolean => {
    // Only direct references (OpenAIApi, firebase, AWS). Member names such as `user.uid` stay
    // legal: their receiver may be declared outside the slice and migrated separately.
    const p = n.parent;
    if ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n)) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isBindingElement(p)) && p.name === n) return false;
    const sym = resolveAlias(checker, checker.getSymbolAtLocation(n));
    const decls = sym?.declarations ?? [];
    return decls.length > 0 && decls.every((d) => dirs.some((dir) => d.getSourceFile().fileName.startsWith(dir)));
  };
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) >= range.start && n.getEnd() <= range.end) {
      // `X.prototype.p` type-checks for an instance PROPERTY p, but p only exists on
      // constructed objects, so this is undefined at runtime (TypeScript unsoundness).
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "prototype"
      ) {
        const member = checker.getSymbolAtLocation(n.name);
        const decls = member?.declarations ?? [];
        if (decls.length && decls.every((d) => ts.isPropertyDeclaration(d) || ts.isParameter(d))) {
          const cls = n.expression.expression.getText(sf);
          const t = checker.typeToString(checker.getTypeAtLocation(n));
          findings.push({
            kind: "type_error",
            symbol: `${cls}.prototype.${n.name.text}`,
            line: lineOf(n.getStart(sf)),
            message:
              `\`${cls}.prototype.${n.name.text}\` is undefined at runtime: ${n.name.text} is an instance property assigned in the constructor, not a prototype member. ` +
              `To reach methods of ${t} for every instance, use the prototype of the class that declares them (look for it among the static members), not ${cls}.prototype.`,
          });
        }
      }
      if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
        warnings.push({
          kind: "dynamic_access",
          symbol: n.argumentExpression.text,
          line: lineOf(n.getStart(sf)),
          message: `Dynamic access ["${n.argumentExpression.text}"] is not checked against the oracle.`,
        });
      }
      if (ts.isIdentifier(n) && dirs.length && !isDeprecated(n) && fromOldVersion(n)) {
        findings.push({
          kind: "leftover",
          symbol: n.text,
          line: lineOf(n.getStart(sf)),
          message: `The replacement still uses ${n.text} from the previous version of the SDK. Use the new version's API instead.`,
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

export type AnyProfile = { value: boolean; vars: string[] };

/** Whether the node spanning `range` has type any, and which variables declared in it do. */
export function anyProfile(sf: ts.SourceFile, checker: ts.TypeChecker, range: { start: number; end: number }): AnyProfile {
  let whole: ts.Node | undefined;
  const vars: string[] = [];
  const visit = (n: ts.Node) => {
    if (n.getEnd() < range.start || n.getStart(sf) > range.end) return;
    const inside = n.getStart(sf) >= range.start && n.getEnd() <= range.end;
    if (inside && !whole && ts.isExpression(n)) whole = n;
    if (inside && ts.isVariableDeclaration(n) && !n.type && ts.isIdentifier(n.name)) {
      if (checker.getTypeAtLocation(n.name).flags & ts.TypeFlags.Any) vars.push(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const exact = whole && whole.getStart(sf) === range.start && whole.getEnd() === range.end;
  return { value: Boolean(exact && checker.getTypeAtLocation(whole!).flags & ts.TypeFlags.Any), vars };
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
  sliceKind?: "expression" | "statement" | "type";
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
    // Show the rejected output too: without it a stateless model tends to repeat it verbatim.
    const shown = candidate.length > 1500 ? `${candidate.slice(0, 1500)}\n…` : candidate;
    feedback = `Your previous output was:\n\`\`\`ts\n${shown.trim()}\n\`\`\`\nIt was rejected because:\n${feedbackFor(res)}`;
  }
  return { accepted: null, attempts };
}
