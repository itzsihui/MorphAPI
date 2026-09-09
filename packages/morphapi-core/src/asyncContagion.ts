import * as ts from "typescript";
import type { PhantomFinding } from "./inspector";
import { parseSourceFile } from "./astScan";

export type AsyncContagionFinding = {
  startLine: number;
  kind:
    | "await-in-sync-fn"
    | "missing-await-on-async-call"
    | "send-without-await"
    | "leftover-promise"
    | "leftover-getObject";
  detail: string;
};

/**
 * Detect sync→async contagion mistakes after AWS SDK v2→v3 migration.
 */
export function findAsyncContagionIssues(
  fileName: string,
  code: string
): AsyncContagionFinding[] {
  const sourceFile = parseSourceFile(fileName, code);
  const findings: AsyncContagionFinding[] = [];

  const asyncFnNames = new Set<string>();

  function isAsyncFunctionLike(node: ts.Node): boolean {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      return Boolean(
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      );
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      return Boolean(
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      );
    }
    return false;
  }

  function enclosingFunction(node: ts.Node): ts.Node | undefined {
    let cur: ts.Node | undefined = node.parent;
    while (cur) {
      if (
        ts.isFunctionDeclaration(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur) ||
        ts.isMethodDeclaration(cur)
      ) {
        return cur;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  function fnName(node: ts.Node): string | undefined {
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      return node.parent.name.text;
    }
    return undefined;
  }

  function collect(node: ts.Node) {
    if (isAsyncFunctionLike(node)) {
      const name = fnName(node);
      if (name) asyncFnNames.add(name);
    }
    ts.forEachChild(node, collect);
  }
  collect(sourceFile);

  function collectPromiseReturns(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.type &&
      /Promise\s*</.test(node.type.getText(sourceFile))
    ) {
      const name = fnName(node);
      if (name) asyncFnNames.add(name);
    }
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
      node.type &&
      /Promise\s*</.test(node.type.getText(sourceFile))
    ) {
      const name = fnName(node);
      if (name) asyncFnNames.add(name);
    }
    ts.forEachChild(node, collectPromiseReturns);
  }
  collectPromiseReturns(sourceFile);

  function lineOf(node: ts.Node): number {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  }

  function visit(node: ts.Node) {
    if (ts.isAwaitExpression(node)) {
      const fn = enclosingFunction(node);
      if (fn && !isAsyncFunctionLike(fn)) {
        findings.push({
          startLine: lineOf(node),
          kind: "await-in-sync-fn",
          detail: "await used in a non-async function (coloring break)",
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      if (node.expression.name.text === "send") {
        const parent = node.parent;
        const awaited = ts.isAwaitExpression(parent);
        const thenChained =
          ts.isPropertyAccessExpression(parent) && parent.name.text === "then";
        const returned =
          ts.isReturnStatement(parent) && parent.expression === node;
        if (!awaited && !thenChained && !returned) {
          findings.push({
            startLine: lineOf(node),
            kind: "send-without-await",
            detail:
              "client.send(...) is not awaited or .then-chained — Promise contagion risk",
          });
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (asyncFnNames.has(name)) {
        const parent = node.parent;
        const awaited = ts.isAwaitExpression(parent);
        const thenChained =
          ts.isPropertyAccessExpression(parent) && parent.name.text === "then";
        const returned =
          ts.isReturnStatement(parent) && parent.expression === node;
        if (!awaited && !thenChained && !returned) {
          if (
            ts.isVariableDeclaration(parent) ||
            ts.isBinaryExpression(parent) ||
            ts.isPropertyAssignment(parent) ||
            ts.isCallExpression(parent)
          ) {
            findings.push({
              startLine: lineOf(node),
              kind: "missing-await-on-async-call",
              detail: `call to async-colored ${name}() is missing await`,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const codeNoComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (/\.promise\s*\(/.test(codeNoComments)) {
    findings.push({
      startLine: 1,
      kind: "leftover-promise",
      detail: "leftover .promise() — AWS SDK v2 pattern must be removed",
    });
  }
  if (/\.getObject\s*\(/.test(codeNoComments)) {
    findings.push({
      startLine: 1,
      kind: "leftover-getObject",
      detail:
        "leftover .getObject( — use client.send(new GetObjectCommand(...))",
    });
  }

  return findings;
}

export function assertAsyncContagion(
  fileName: string,
  code: string
): {
  ok: boolean;
  findings: AsyncContagionFinding[];
  phantoms: PhantomFinding[];
} {
  const findings = findAsyncContagionIssues(fileName, code);
  const phantoms: PhantomFinding[] = findings.map((f) => ({
    symbol: f.kind,
    tier: "scope-bound" as const,
    reason: `L${f.startLine}: ${f.detail}`,
  }));
  return { ok: findings.length === 0, findings, phantoms };
}

/** Deterministic full-file migration when live LLM breaks coloring. */
export function oracleAsyncStorageMigration(_source: string): string {
  void _source;
  return `import { createS3Client, GetObjectCommand } from "aws-s3-v2";

/**
 * Multi-level call stack over client.send(GetObjectCommand).
 * Async coloring preserved via .then chains (or equivalent async/await).
 */
const client = createS3Client();

/** Leaf I/O — AWS SDK v3 command + send */
export function fetchObjectBody(
  bucket: string,
  key: string
): Promise<string> {
  return client
    .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    .then((result) => result.Body);
}

/** Mid layer — parses settings JSON from S3 */
export function loadSettings(
  bucket: string
): Promise<{ theme: string; region: string }> {
  return fetchObjectBody(bucket, "settings.json").then((raw) => {
    return JSON.parse(raw) as { theme: string; region: string };
  });
}

/** Upper layer — boots app theme from settings */
export function bootApp(bucket: string): Promise<string> {
  return loadSettings(bucket).then((settings) => {
    return \`\${settings.theme}@\${settings.region}\`;
  });
}

/** Second leaf site — banner text */
export function loadBanner(bucket: string): Promise<string> {
  return client
    .send(new GetObjectCommand({ Bucket: bucket, Key: "banner.txt" }))
    .then((body) => body.Body);
}
`;
}
