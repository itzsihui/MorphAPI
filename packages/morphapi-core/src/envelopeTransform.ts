import * as ts from "typescript";
import { findListUsersAwaitSpans, parseSourceFile } from "./astScan";

export interface EnvelopeSiteFinding {
  startLine: number;
  binding: string | null;
  expr: string;
  unwrapped: boolean;
  reason: string;
}

export interface EnvelopeTransformResult {
  ok: boolean;
  sites: EnvelopeSiteFinding[];
  unwrappedCount: number;
  wrappedBlindCount: number;
}

function isListUsersCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) return false;
  if (!ts.isPropertyAccessExpression(expr.expression)) return false;
  return expr.expression.name.text === "listUsers";
}

function stripParens(expr: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  return expr;
}

/** True when expression evaluates to (await *.listUsers()).data or *.listUsers().then… */
function isEdgeUnwrapped(expr: ts.Expression): boolean {
  const root = stripParens(expr);

  if (ts.isPropertyAccessExpression(root) && root.name.text === "data") {
    const target = stripParens(root.expression);
    if (ts.isAwaitExpression(target) && isListUsersCall(target.expression)) {
      return true;
    }
    if (isListUsersCall(target)) {
      return true; // api.listUsers().data (thenable misuse) — still counts as unwrap intent
    }
  }

  return false;
}

function isBareListUsers(expr: ts.Expression): boolean {
  const root = stripParens(expr);
  if (ts.isAwaitExpression(root) && isListUsersCall(root.expression)) return true;
  if (isListUsersCall(root)) return true;
  if (ts.isAsExpression(root) || ts.isTypeAssertionExpression(root)) {
    return isBareListUsers(root.expression);
  }
  return false;
}

/**
 * DFG / behavioral gate for Scenario 5: listUsers results must unwrap `.data`
 * before being returned or bound for User[] consumers.
 */
export function assertEnvelopeUnwrap(
  fileName: string,
  code: string
): EnvelopeTransformResult {
  const sourceFile = parseSourceFile(fileName, code);
  const sites: EnvelopeSiteFinding[] = [];

  function pushSite(
    node: ts.Node,
    binding: string | null,
    expr: string,
    unwrapped: boolean,
    reason: string
  ) {
    const start = node.getStart(sourceFile);
    const lc = sourceFile.getLineAndCharacterOfPosition(start);
    sites.push({
      startLine: lc.line + 1,
      binding,
      expr,
      unwrapped,
      reason,
    });
  }

  function visit(node: ts.Node) {
    // return <listUsers expr>
    if (ts.isReturnStatement(node) && node.expression) {
      const expr = node.expression;
      if (isEdgeUnwrapped(expr)) {
        pushSite(
          node,
          null,
          expr.getText(sourceFile),
          true,
          "edge adapter: return unwraps .data"
        );
      } else if (isBareListUsers(expr)) {
        pushSite(
          node,
          null,
          expr.getText(sourceFile),
          false,
          "DFG blindness: return listUsers envelope without .data unwrap"
        );
      }
    }

    // const x = <listUsers expr>
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.name)
    ) {
      const init = node.initializer;
      const binding = node.name.text;
      if (isEdgeUnwrapped(init)) {
        pushSite(
          node,
          binding,
          init.getText(sourceFile),
          true,
          "edge adapter: listUsers result unwrapped via .data"
        );
      } else if (isBareListUsers(init)) {
        pushSite(
          node,
          binding,
          init.getText(sourceFile),
          false,
          "DFG blindness: binding from listUsers used without .data"
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (sites.length === 0) {
    const spans = findListUsersAwaitSpans(fileName, code);
    for (const span of spans) {
      const after = code.slice(span.end, Math.min(code.length, span.end + 12));
      const unwrapped =
        /^\s*\)?\.data\b/.test(after) || /\.data\b/.test(span.text);
      sites.push({
        startLine: span.startLine,
        binding: null,
        expr: span.text,
        unwrapped,
        reason: unwrapped
          ? "span text includes .data unwrap"
          : "listUsers await has no adjacent .data unwrap",
      });
    }
  }

  // Also catch non-await: return api.listUsers()
  if (sites.length === 0 && /\.listUsers\s*\(/.test(code)) {
    const unwrapped = /\.listUsers\s*\([^)]*\)\s*\)?\.data/.test(code);
    sites.push({
      startLine: 1,
      binding: null,
      expr: "listUsers(...)",
      unwrapped,
      reason: unwrapped
        ? "listUsers().data present"
        : "listUsers call found without .data unwrap",
    });
  }

  const unwrappedCount = sites.filter((s) => s.unwrapped).length;
  const wrappedBlindCount = sites.length - unwrappedCount;

  return {
    ok: sites.length > 0 && wrappedBlindCount === 0,
    sites,
    unwrappedCount,
    wrappedBlindCount,
  };
}

/** Build oracle edge-adapter replacement for an `await api.listUsers()` span. */
export function oracleEnvelopeReplacementForSpan(spanText: string): string {
  const trimmed = spanText.trim().replace(/;?\s*$/, "");
  if (/\.data\s*$/.test(trimmed)) return trimmed;
  if (/^await\s+/.test(trimmed)) {
    return `(${trimmed}).data`;
  }
  return `(await ${trimmed}).data`;
}
