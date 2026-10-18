/**
 * Learn-once rewrite rules. A migration often repeats one change at many sites
 * (Firebase v9: `auth.signInWithX(a, b)` → `signInWithX(auth, a, b)` everywhere).
 * Asking the LLM at every site is slow and costly, so every fix the gate
 * accepts is generalised into a rule and tried first at matching sites:
 *
 *  - exact rule:  the same old code (whitespace-normalised, same slice kind)
 *                 gets the same replacement;
 *  - shape rule:  a call/new to the same old-API declaration with the same
 *                 number of arguments gets the accepted replacement with this
 *                 site's receiver and arguments substituted for the original
 *                 site's (anti-unification over receiver and arguments).
 *
 * A rule only proposes. Every proposal still passes the full gate (type checker,
 * evasion, leftovers, project syntax); a rejected proposal falls back to the
 * LLM. In effect the LLM writes a codemod from one example and the type checker
 * verifies every application.
 */
import * as path from "path";
import * as ts from "typescript";
import { resolveAlias } from "./program";
import type { SliceKind } from "./sliceMetadata";

type CallShape = {
  key: string;
  receiver: string | null;
  args: string[];
};

export type LearnedRule = {
  kind: "exact" | "shape";
  key: string;
  template: string;
  from: { file: string; line: number };
  uses: number;
  fails: number;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function nodeExactly(sf: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      if (n.getStart(sf) === start && n.getEnd() === end) found = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return found;
}

/** The call/new at the slice, with receiver and argument texts, keyed by the callee's old declaration. */
function callShape(sf: ts.SourceFile, checker: ts.TypeChecker, start: number, end: number): CallShape | null {
  let n = nodeExactly(sf, start, end);
  while (n && (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n))) n = n.expression;
  if (!n || !(ts.isCallExpression(n) || ts.isNewExpression(n))) return null;
  const callee = n.expression;
  const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
  if (!nameNode || !ts.isIdentifier(nameNode)) return null;
  const decl = resolveAlias(checker, checker.getSymbolAtLocation(nameNode))?.declarations?.[0];
  if (!decl) return null;
  const declKey = `${path.basename(decl.getSourceFile().fileName)}:${decl.getStart(decl.getSourceFile())}`;
  const args = (n.arguments ?? []).map((a) => a.getText(sf));
  const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression.getText(sf) : null;
  // Text around the call (e.g. `await `) must match too.
  const prefix = sf.text.slice(start, n.getStart(sf));
  return { key: `${ts.isNewExpression(n) ? "new" : "call"}|${declKey}|${nameNode.text}|${args.length}|${receiver != null}|${norm(prefix)}`, receiver, args };
}

const MARK = (i: number) => `\u0000H${i}\u0000`;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace each hole text in `text` by its marker, longest first, at token boundaries. */
function abstractHoles(text: string, holes: string[]): string | null {
  const order = holes.map((h, i) => ({ h, i })).filter((x) => x.h.trim().length > 0).sort((a, b) => b.h.length - a.h.length);
  let out = text;
  for (const { h, i } of order) {
    const left = /^[\w$]/.test(h) ? "(?<![\\w$])" : "";
    const right = /[\w$]$/.test(h) ? "(?![\\w$])" : "";
    out = out.replace(new RegExp(left + escapeRe(h) + right, "g"), MARK(i));
  }
  // Two holes with identical text cannot be told apart in the replacement; refuse such rules.
  const texts = holes.filter((h) => h.trim().length);
  if (new Set(texts).size !== texts.length) return null;
  return out;
}

export class RuleBook {
  private exact = new Map<string, LearnedRule>();
  private shape = new Map<string, LearnedRule>();

  get size(): number {
    return this.exact.size + this.shape.size;
  }

  list(): LearnedRule[] {
    return [...this.exact.values(), ...this.shape.values()];
  }

  /** Learn from a gate-accepted replacement of the slice [start, end) in `sf` (the pre-edit text). */
  learn(sf: ts.SourceFile, checker: ts.TypeChecker, slice: { start: number; end: number; kind: SliceKind }, replacement: string): void {
    const old = sf.text.slice(slice.start, slice.end);
    if (norm(old) === norm(replacement)) return;
    const line = sf.getLineAndCharacterOfPosition(slice.start).line + 1;
    const from = { file: sf.fileName, line };
    const ek = `${slice.kind}|${norm(old)}`;
    if (!this.exact.has(ek)) this.exact.set(ek, { kind: "exact", key: ek, template: replacement, from, uses: 0, fails: 0 });
    if (slice.kind !== "expression") return;
    const shape = callShape(sf, checker, slice.start, slice.end);
    if (!shape || this.shape.has(shape.key)) return;
    const holes = [shape.receiver ?? "", ...shape.args];
    const template = abstractHoles(replacement, holes);
    if (template == null) return;
    this.shape.set(shape.key, { kind: "shape", key: shape.key, template, from, uses: 0, fails: 0 });
  }

  /** A proposal for the slice from a learned rule, or null. */
  suggest(sf: ts.SourceFile, checker: ts.TypeChecker, slice: { start: number; end: number; kind: SliceKind }): { text: string; rule: LearnedRule } | null {
    const old = sf.text.slice(slice.start, slice.end);
    const ex = this.exact.get(`${slice.kind}|${norm(old)}`);
    if (ex && ex.fails < 3) return { text: ex.template, rule: ex };
    if (slice.kind !== "expression") return null;
    const shape = callShape(sf, checker, slice.start, slice.end);
    const rule = shape ? this.shape.get(shape.key) : undefined;
    if (!shape || !rule || rule.fails >= 3) return null;
    const holes = [shape.receiver ?? "", ...shape.args];
    let text = rule.template;
    holes.forEach((h, i) => {
      text = text.split(MARK(i)).join(h);
    });
    if (text.includes("\u0000")) return null;
    return { text, rule };
  }
}
