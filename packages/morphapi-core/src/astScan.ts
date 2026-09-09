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
  kind:
    | "charges.create"
    | "linkTokenCreate"
    | "ChatCompletion.create"
    | "jwt.verify"
    | "listUsers.await"
    | "try.charges.create"
    | "getObject.promise"
    | "sendEmail"
    | "event.switch"
    | "token.eq"
    | "authorizeLegacyCompat";
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

function pushSpan(
  spans: UsageSpan[],
  sourceFile: ts.SourceFile,
  code: string,
  fileName: string,
  node: ts.Node,
  kind: UsageSpan["kind"]
) {
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
    kind,
  });
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
    if (!ts.isPropertyAccessExpression(expr)) return false;
    if (expr.name.text !== "create") return false;
    if (!ts.isPropertyAccessExpression(expr.expression)) return false;
    if (expr.expression.name.text !== "charges") return false;
    return true;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isChargesCreate(node.expression)) {
      pushSpan(spans, sourceFile, code, fileName, node, "charges.create");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find client.linkTokenCreate(...) call expressions (Plaid Link migration).
 */
export function findLinkTokenCreateSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isLinkTokenCreate(expr: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(expr)) return false;
    return expr.name.text === "linkTokenCreate";
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isLinkTokenCreate(node.expression)) {
      pushSpan(spans, sourceFile, code, fileName, node, "linkTokenCreate");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find openai.ChatCompletion.create(...) call expressions (OpenAI v0→v1 migration).
 */
export function findChatCompletionCreateSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isChatCompletionCreate(expr: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(expr)) return false;
    if (expr.name.text !== "create") return false;
    if (!ts.isPropertyAccessExpression(expr.expression)) return false;
    return expr.expression.name.text === "ChatCompletion";
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isChatCompletionCreate(node.expression)) {
      pushSpan(
        spans,
        sourceFile,
        code,
        fileName,
        node,
        "ChatCompletion.create"
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find jwt.verify(...) call expressions (Auth JWT secret → JWKS migration).
 */
export function findJwtVerifySpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isJwtVerify(expr: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(expr)) return false;
    return expr.name.text === "verify" && ts.isIdentifier(expr.expression)
      ? expr.expression.text === "jwt"
      : false;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isJwtVerify(node.expression)) {
      pushSpan(spans, sourceFile, code, fileName, node, "jwt.verify");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

function nodeTextIncludesChargesCreate(node: ts.Node, sf: ts.SourceFile): boolean {
  const text = node.getText(sf);
  return /\.charges\s*\.\s*create\s*\(/.test(text);
}

/**
 * Find try/catch blocks that wrap stripe.charges.create (Scenario 8 error hierarchy).
 * Returns the whole TryStatement so call + catch migrate together.
 */
export function findChargesCreateTrySpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isTryStatement(node) &&
      nodeTextIncludesChargesCreate(node.tryBlock, sourceFile)
    ) {
      pushSpan(spans, sourceFile, code, fileName, node, "try.charges.create");
      return; // do not descend into nested tries inside this one
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

function isListUsersCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) return false;
  if (!ts.isPropertyAccessExpression(expr.expression)) return false;
  return expr.expression.name.text === "listUsers";
}

/**
 * Find `await api.listUsers()` expressions (Scenario 5 envelope migration).
 * Span covers the await so hybrid can splice `(await api.listUsers()).data`.
 */
export function findListUsersAwaitSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function visit(node: ts.Node) {
    if (ts.isAwaitExpression(node) && isListUsersCall(node.expression)) {
      pushSpan(spans, sourceFile, code, fileName, node, "listUsers.await");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find sendEmail(...) call expressions (Scenario 7 multi-site mail migration).
 */
export function findSendEmailSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isSendEmail(expr: ts.Expression): boolean {
    return ts.isIdentifier(expr) && expr.text === "sendEmail";
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isSendEmail(node.expression)) {
      pushSpan(spans, sourceFile, code, fileName, node, "sendEmail");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find s3.getObject(...).promise() call chains (AWS SDK v2 → v3 migration).
 * Span covers the full `.promise()` call so hybrid can replace with client.send(...).
 */
export function findGetObjectPromiseSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isGetObjectPromiseCall(node: ts.CallExpression): boolean {
    if (!ts.isPropertyAccessExpression(node.expression)) return false;
    if (node.expression.name.text !== "promise") return false;
    const left = node.expression.expression;
    if (!ts.isCallExpression(left)) return false;
    if (!ts.isPropertyAccessExpression(left.expression)) return false;
    return left.expression.name.text === "getObject";
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isGetObjectPromiseCall(node)) {
      pushSpan(spans, sourceFile, code, fileName, node, "getObject.promise");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find static token compares: query.token === WEBHOOK_TOKEN / process.env.WEBHOOK_TOKEN
 * (Scenario 10 security scheme migration).
 */
export function findStaticTokenCompareSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function mentionsToken(node: ts.Node): boolean {
    const t = node.getText(sourceFile);
    return /WEBHOOK_TOKEN|\.token\b|query\.token/.test(t);
  }

  function visit(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
      (mentionsToken(node.left) || mentionsToken(node.right))
    ) {
      pushSpan(spans, sourceFile, code, fileName, node, "token.eq");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find authorizeLegacyCompat function declarations (Scenario 10).
 */
export function findAuthorizeLegacyCompatSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "authorizeLegacyCompat"
    ) {
      pushSpan(
        spans,
        sourceFile,
        code,
        fileName,
        node,
        "authorizeLegacyCompat"
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}

/**
 * Find switch(event.type) / switch(event.event_type) statements (Scenario 9).
 */
export function findEventSwitchSpans(
  fileName: string,
  code: string
): UsageSpan[] {
  const sourceFile = parseSourceFile(fileName, code);
  const spans: UsageSpan[] = [];

  function isEventDiscriminatorSwitch(node: ts.SwitchStatement): boolean {
    const expr = node.expression.getText(sourceFile);
    return (
      /\.type\b/.test(expr) ||
      /\.event_type\b/.test(expr) ||
      expr === "type" ||
      expr === "event_type"
    );
  }

  function visit(node: ts.Node) {
    if (ts.isSwitchStatement(node) && isEventDiscriminatorSwitch(node)) {
      pushSpan(spans, sourceFile, code, fileName, node, "event.switch");
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return spans;
}
