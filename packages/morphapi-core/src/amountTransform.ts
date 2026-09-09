import * as ts from "typescript";
import { findChargesCreateSpans, parseSourceFile } from "./astScan";

export interface AmountSiteFinding {
  startLine: number;
  amountExpr: string;
  scaled: boolean;
  reason: string;
}

export interface AmountTransformResult {
  ok: boolean;
  sites: AmountSiteFinding[];
  scaledCount: number;
  unscaledCount: number;
}

function looksScaled(exprText: string): boolean {
  const t = exprText.replace(/\s+/g, " ").trim();
  // Common correct forms: Math.round(x * 100), x * 100, Math.floor(x * 100)
  if (/\*\s*100\b/.test(t) || /\b100\s*\*/.test(t)) return true;
  if (/\*\s*1e2\b/i.test(t)) return true;
  return false;
}

function extractAmountExprs(
  fileName: string,
  code: string
): Array<{ startLine: number; amountExpr: string }> {
  const sourceFile = parseSourceFile(fileName, code);
  const found: Array<{ startLine: number; amountExpr: string }> = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "create" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "charges"
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isObjectLiteralExpression(arg0)) {
        for (const prop of arg0.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ((ts.isIdentifier(prop.name) && prop.name.text === "amount") ||
              (ts.isStringLiteral(prop.name) && prop.name.text === "amount"))
          ) {
            const start = prop.getStart(sourceFile);
            const lc = sourceFile.getLineAndCharacterOfPosition(start);
            found.push({
              startLine: lc.line + 1,
              amountExpr: prop.initializer.getText(sourceFile),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Fallback: if AST found none but charges.create spans exist, regex amount:
  if (found.length === 0) {
    const spans = findChargesCreateSpans(fileName, code);
    for (const span of spans) {
      const m = /amount\s*:\s*([^,\n}]+)/.exec(span.text);
      if (m) {
        found.push({
          startLine: span.startLine,
          amountExpr: m[1].trim(),
        });
      }
    }
  }

  return found;
}

/**
 * Behavioral gate for Scenario 3: every charges.create `amount` must scale
 * dollars → cents (typically `* 100` / `Math.round(... * 100)`).
 *
 * Typecheck cannot catch this — amount stays `number` on both API versions.
 */
export function assertAmountTransform(
  fileName: string,
  code: string
): AmountTransformResult {
  const exprs = extractAmountExprs(fileName, code);
  const sites: AmountSiteFinding[] = exprs.map(({ startLine, amountExpr }) => {
    const scaled = looksScaled(amountExpr);
    let reason: string;
    if (scaled) {
      reason = "amount expression includes ×100 scale to cents";
    } else if (/^\d+\.\d+$/.test(amountExpr.trim())) {
      reason =
        "float literal looks like dollars left unscaled (e.g. 10.5 → should be 1050)";
    } else if (/dollars|amountDollars/i.test(amountExpr)) {
      reason = "dollars-named expression passed through without ×100";
    } else {
      reason =
        "amount expression has no ×100 / Math.round(...*100) transform";
    }
    return { startLine, amountExpr, scaled, reason };
  });

  const scaledCount = sites.filter((s) => s.scaled).length;
  const unscaledCount = sites.length - scaledCount;

  return {
    ok: sites.length > 0 && unscaledCount === 0,
    sites,
    scaledCount,
    unscaledCount,
  };
}

/** Pull amount RHS from a charges.create span text for oracle fallback. */
export function extractAmountExprFromSpanText(spanText: string): string {
  const m = /amount\s*:\s*([^,\n}]+)/.exec(spanText);
  return m?.[1]?.trim() ?? "amountDollars";
}
