/**
 * 1-degree impact analysis: after fixing a symbol/span, find direct callers
 * and same-API leftovers that may newly break.
 */
import * as ts from "typescript";
import { parseSourceFile } from "./astScan";
import type { ImpactFinding, RepairIssue } from "./repairReport";
import { nextIssueId } from "./repairReport";

export type SourceFileInput = {
  fileName: string;
  code: string;
};

export type ImpactProbe = {
  /** Function / method name that became async or changed shape */
  changedSymbols: string[];
  /** API call patterns still considered "leftover" (regex sources) */
  leftoverPatterns?: RegExp[];
  fromIssueId: string;
  /** Prefer checking these files (callers) */
  files: SourceFileInput[];
};

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Find call expressions to `changedSymbols` that lack await/.then,
 * and leftover API patterns in sibling files.
 */
export function findOneHopImpact(probe: ImpactProbe): ImpactFinding[] {
  const findings: ImpactFinding[] = [];
  const symbols = new Set(probe.changedSymbols);

  for (const file of probe.files) {
    const sf = parseSourceFile(file.fileName, file.code);

    function enclosingIsAsync(node: ts.Node): boolean {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (
          ts.isFunctionDeclaration(cur) ||
          ts.isFunctionExpression(cur) ||
          ts.isArrowFunction(cur) ||
          ts.isMethodDeclaration(cur)
        ) {
          return Boolean(
            cur.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          );
        }
        cur = cur.parent;
      }
      return false;
    }

    function isAwaitedOrThened(call: ts.CallExpression): boolean {
      const parent = call.parent;
      if (parent && parent.kind === ts.SyntaxKind.AwaitExpression) return true;
      if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === call &&
        parent.name.text === "then"
      ) {
        return true;
      }
      // const x = call() used as Promise — still missing await at use; flag call site
      return false;
    }

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        let name: string | undefined;
        if (ts.isIdentifier(node.expression)) {
          name = node.expression.text;
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.name)
        ) {
          name = node.expression.name.text;
        }
        if (name && symbols.has(name) && !isAwaitedOrThened(node)) {
          findings.push({
            id: nextIssueId("imp"),
            fromIssueId: probe.fromIssueId,
            fileName: file.fileName,
            startLine: lineOf(sf, node.getStart(sf)),
            targetSymbol: name,
            reason: "missing_await",
            detail: `Call to ${name}() has no await/.then after callee became async / Promise-returning`,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    for (const re of probe.leftoverPatterns ?? []) {
      let m: RegExpExecArray | null;
      const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      while ((m = copy.exec(file.code)) !== null) {
        const before = file.code.slice(0, m.index);
        const startLine = before.split("\n").length;
        findings.push({
          id: nextIssueId("imp"),
          fromIssueId: probe.fromIssueId,
          fileName: file.fileName,
          startLine,
          targetSymbol: m[0].slice(0, 40),
          reason: "same_api_leftover",
          detail: `Leftover API pattern ${re} still present after primary fix`,
        });
      }
    }
  }

  return findings;
}

/**
 * 1° callee→caller impact: after changing exports (e.g. notifyUser return type),
 * find direct CallExpressions in other files that invoke those symbols.
 */
export function findDirectCallers(probe: {
  calleeNames: string[];
  fromIssueId: string;
  files: SourceFileInput[];
  detail?: string;
}): ImpactFinding[] {
  const findings: ImpactFinding[] = [];
  const names = new Set(probe.calleeNames);

  for (const file of probe.files) {
    const sf = parseSourceFile(file.fileName, file.code);

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        let name: string | undefined;
        if (ts.isIdentifier(node.expression)) {
          name = node.expression.text;
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.name)
        ) {
          name = node.expression.name.text;
        }
        if (name && names.has(name)) {
          findings.push({
            id: nextIssueId("imp"),
            fromIssueId: probe.fromIssueId,
            fileName: file.fileName,
            startLine: lineOf(sf, node.getStart(sf)),
            targetSymbol: name,
            reason: "caller_contract",
            detail:
              probe.detail ??
              `Direct caller of ${name}() may break after callee return/arg contract change (1° impact)`,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  return findings;
}

/** Convert impact findings into RepairIssues linked to the causing fix. */
export function impactToIssues(
  findings: ImpactFinding[],
  opts?: { kind?: RepairIssue["kind"]; severity?: RepairIssue["severity"] }
): RepairIssue[] {
  return findings.map((f) => ({
    id: nextIssueId("iss"),
    kind:
      opts?.kind ??
      (f.reason === "missing_await" || f.reason === "caller_needs_async"
        ? "missing_await"
        : f.reason === "envelope_unwrap"
          ? "envelope_unwrap"
          : f.reason === "same_api_leftover"
            ? "multi_site_leftover"
            : f.reason === "caller_contract" || f.reason === "stale_binding"
              ? "caller_contract"
            : "async_contagion"),
    severity: opts?.severity ?? "major",
    location: {
      fileName: f.fileName,
      startLine: f.startLine,
      text: f.targetSymbol,
    },
    symptom: f.detail,
    rootCauseHint: `Cascaded from ${f.fromIssueId} (1° impact: ${f.reason})`,
    discoveredAt: "impact_1hop" as const,
    causedByIssueId: f.fromIssueId,
  }));
}

/**
 * Heuristic: functions that look newly async in `after` but not in `before`.
 */
export function detectNewlyAsyncExports(
  beforeCode: string,
  afterCode: string,
  fileName = "file.ts"
): string[] {
  const before = new Set<string>();
  const after: string[] = [];
  const collect = (code: string, into: Set<string> | string[]) => {
    const sf = parseSourceFile(fileName, code);
    function visit(node: ts.Node) {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        const isAsync = Boolean(
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        );
        const returnsPromise =
          node.type && /Promise\s*</.test(node.type.getText(sf));
        if (isAsync || returnsPromise) {
          if (Array.isArray(into)) into.push(node.name.text);
          else into.add(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  };
  collect(beforeCode, before);
  const afterList: string[] = [];
  collect(afterCode, afterList);
  return afterList.filter((n) => !before.has(n));
}
