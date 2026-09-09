import * as ts from "typescript";
import { findEventSwitchSpans, parseSourceFile } from "./astScan";

export interface DiscriminatorMapping {
  fromProperty: string;
  toProperty: string;
  valueMap: Record<string, string>;
  requiredValues: string[];
}

export interface DiscriminatorSiteFinding {
  startLine: number;
  kind: "switch" | "literal" | "property";
  detail: string;
  ok: boolean;
  reason: string;
}

export interface DiscriminatorTransformResult {
  ok: boolean;
  sites: DiscriminatorSiteFinding[];
  passCount: number;
  failCount: number;
}

const DEFAULT_MAP: DiscriminatorMapping = {
  fromProperty: "type",
  toProperty: "event_type",
  valueMap: {
    MESSAGE_CREATE: "message.created",
    MESSAGE_UPDATE: "message.updated",
    REACTION_ADD: "reaction.added",
  },
  requiredValues: ["message.created", "message.updated", "reaction.added"],
};

export function loadDiscriminatorMapping(
  raw?: Partial<DiscriminatorMapping> | null
): DiscriminatorMapping {
  if (!raw) return DEFAULT_MAP;
  return {
    fromProperty: raw.fromProperty ?? DEFAULT_MAP.fromProperty,
    toProperty: raw.toProperty ?? DEFAULT_MAP.toProperty,
    valueMap: raw.valueMap ?? DEFAULT_MAP.valueMap,
    requiredValues: raw.requiredValues ?? DEFAULT_MAP.requiredValues,
  };
}

function caseLabelText(clause: ts.CaseClause, sf: ts.SourceFile): string | null {
  const expr = clause.expression;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  return expr.getText(sf).replace(/^["'`]|["'`]$/g, "");
}

/**
 * Gate for Scenario 9: switches must use the new discriminator property and
 * new case values; leftover legacy SCREAMING_SNAKE literals / `.type` accesses fail.
 */
export function assertDiscriminatorMigration(
  fileName: string,
  code: string,
  mapping: DiscriminatorMapping = DEFAULT_MAP,
  opts?: { requireSwitch?: boolean }
): DiscriminatorTransformResult {
  const requireSwitch = opts?.requireSwitch ?? false;
  const sourceFile = parseSourceFile(fileName, code);
  const sites: DiscriminatorSiteFinding[] = [];
  const oldValues = new Set(Object.keys(mapping.valueMap));
  const newValues = new Set(mapping.requiredValues);

  function visit(node: ts.Node) {
    if (ts.isSwitchStatement(node)) {
      const disc = node.expression;
      const discText = disc.getText(sourceFile);
      const start = node.getStart(sourceFile);
      const lc = sourceFile.getLineAndCharacterOfPosition(start);

      const usesNewProp =
        ts.isPropertyAccessExpression(disc) &&
        disc.name.text === mapping.toProperty;
      const usesOldProp =
        ts.isPropertyAccessExpression(disc) &&
        disc.name.text === mapping.fromProperty;

      const caseValues: string[] = [];
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          const v = caseLabelText(clause, sourceFile);
          if (v) caseValues.push(v);
        }
      }

      const hasOldCases = caseValues.some((v) => oldValues.has(v));
      const allNewCases =
        caseValues.length > 0 && caseValues.every((v) => newValues.has(v));
      const missingRequired = mapping.requiredValues.filter(
        (v) => !caseValues.includes(v)
      );

      if (usesNewProp && allNewCases && missingRequired.length === 0) {
        sites.push({
          startLine: lc.line + 1,
          kind: "switch",
          detail: discText,
          ok: true,
          reason: `switch on ${mapping.toProperty} with complete new case set`,
        });
      } else {
        const reasons: string[] = [];
        if (usesOldProp) {
          reasons.push(
            `still switches on .${mapping.fromProperty} (need .${mapping.toProperty})`
          );
        } else if (!usesNewProp) {
          reasons.push(`discriminant is not .${mapping.toProperty}`);
        }
        if (hasOldCases) {
          reasons.push("case arms still use legacy SCREAMING_SNAKE values");
        }
        if (usesNewProp && missingRequired.length > 0) {
          reasons.push(`missing cases: ${missingRequired.join(", ")}`);
        }
        sites.push({
          startLine: lc.line + 1,
          kind: "switch",
          detail: discText,
          ok: false,
          reason: reasons.join("; ") || "switch not migrated",
        });
      }
    }

    // Property access event.type (legacy discriminator)
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === mapping.fromProperty &&
      ts.isIdentifier(node.expression)
    ) {
      const parent = node.parent;
      // Allow type annotations / imports mentioning unrelated `.type` — only flag
      // when used as switch discriminant or compared
      if (
        (parent && ts.isSwitchStatement(parent) && parent.expression === node) ||
        (parent &&
          (ts.isBinaryExpression(parent) ||
            ts.isElementAccessExpression(parent) ||
            ts.isCallExpression(parent)))
      ) {
        const start = node.getStart(sourceFile);
        const lc = sourceFile.getLineAndCharacterOfPosition(start);
        // Avoid double-counting the switch discriminant site
        if (!(parent && ts.isSwitchStatement(parent))) {
          sites.push({
            startLine: lc.line + 1,
            kind: "property",
            detail: node.getText(sourceFile),
            ok: false,
            reason: `legacy discriminator property .${mapping.fromProperty}`,
          });
        }
      }
    }

    // Legacy string literals still present
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (oldValues.has(node.text)) {
        const start = node.getStart(sourceFile);
        const lc = sourceFile.getLineAndCharacterOfPosition(start);
        sites.push({
          startLine: lc.line + 1,
          kind: "literal",
          detail: JSON.stringify(node.text),
          ok: false,
          reason: `legacy discriminator value ${node.text}`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (sites.length === 0) {
    const spans = findEventSwitchSpans(fileName, code);
    for (const span of spans) {
      sites.push({
        startLine: span.startLine,
        kind: "switch",
        detail: span.text.slice(0, 80),
        ok: false,
        reason: "event switch found but migration incomplete",
      });
    }
  }

  const passCount = sites.filter((s) => s.ok).length;
  const failCount = sites.length - passCount;
  const switchPass = sites.some((s) => s.kind === "switch" && s.ok);

  return {
    ok: failCount === 0 && (!requireSwitch || switchPass),
    sites,
    passCount,
    failCount,
  };
}

/** Oracle-backed rewrite of a switch(event.type) block to v2 discriminator. */
export function oracleDiscriminatorSwitchReplacement(
  spanText: string,
  mapping: DiscriminatorMapping = DEFAULT_MAP
): string {
  let out = spanText;

  // Discriminant property
  const propRe = new RegExp(
    `\\.(${mapping.fromProperty})\\b`,
    "g"
  );
  out = out.replace(propRe, `.${mapping.toProperty}`);

  // Case / compare values
  for (const [from, to] of Object.entries(mapping.valueMap)) {
    const litRe = new RegExp(`(["'\`])${from}\\1`, "g");
    out = out.replace(litRe, `"${to}"`);
  }

  return out;
}

/** Rewrite subscribe intent string arrays using the value map. */
export function rewriteDiscriminatorLiterals(
  code: string,
  mapping: DiscriminatorMapping = DEFAULT_MAP
): string {
  let out = code;
  for (const [from, to] of Object.entries(mapping.valueMap)) {
    const litRe = new RegExp(`(["'\`])${from}\\1`, "g");
    out = out.replace(litRe, `"${to}"`);
  }
  const propRe = new RegExp(`\\.${mapping.fromProperty}\\b`, "g");
  // Only rewrite event-like `.type` when clearly discriminator — keep conservative:
  // replace `.type` in switch contexts already handled; here replace `event.type`
  out = out.replace(/\bevent\.type\b/g, `event.${mapping.toProperty}`);
  out = out.replace(/\be\.type\b/g, `e.${mapping.toProperty}`);
  void propRe;
  return out;
}
