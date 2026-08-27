import * as ts from "typescript";

export interface UsageSpan {
  fileName: string;
  start: number;
  end: number;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
  kind: "charges.create";
}

export function parseSourceFile(fileName: string, code: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

/**
 * Find morphpay.charges.create(...) call expressions and return exact source spans.
 */
export function findChargesCreateSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isChargesCreate(expr: ts.Expression): boolean {
    // morphpay.charges.create
    if (!ts.isPropertyAccessExpression(expr)) return false;
    if (expr.name.text !== "create") return false;
    if (!ts.isPropertyAccessExpression(expr.expression)) return false;
    if (expr.expression.name.text !== "charges") return false;
    return true;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isChargesCreate(node.expression)) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const startLc = sourceFile.getLineAndCharacterOfPosition(start);
      const endLc = sourceFile.getLineAndCharacterOfPosition(end);
      spans.push({
        fileName,
        start,
        end,
        startLine: startLc.line + 1,
        startChar: startLc.character + 1,
        endLine: endLc.line + 1,
        endChar: endLc.character + 1,
        text: code.slice(start, end),
        kind: "charges.create",
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}
