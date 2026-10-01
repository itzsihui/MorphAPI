import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { getMeta } from "./scenarioMeta.mjs";

function readMaybe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

let corePromise = null;

async function loadCore(root) {
  if (!corePromise) {
    const dist = path.join(root, "packages/morphapi-core/dist/index.js");
    corePromise = import(pathToFileURL(dist).href);
  }
  return corePromise;
}

const FINDER_MAP = {
  "charges.create": "findChargesCreateSpans",
  linkTokenCreate: "findLinkTokenCreateSpans",
  "ChatCompletion.create": "findChatCompletionCreateSpans",
  "jwt.verify": "findJwtVerifySpans",
  "listUsers.await": "findListUsersAwaitSpans",
  "getObject.promise": "findGetObjectPromiseSpans",
  "try.charges.create": "findChargesCreateTrySpans",
  sendEmail: "findSendEmailSpans",
  "event.switch": "findEventSwitchSpans",
  "token.eq": "findStaticTokenCompareSpans",
  authorizeLegacyCompat: "findAuthorizeLegacyCompatSpans",
};

const AST_SOURCE = "packages/morphapi-core/src/astScan.ts";

/** Explainability catalog — mirrors real visitors in astScan.ts */
const FINDER_EXPLAIN = {
  "charges.create": {
    key: "charges.create",
    fnName: "findChargesCreateSpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression *.charges.create(...)",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and expr is *.charges.create:
    pushSpan(node)   // byte start/end
  forEachChild(node, visit)`,
  },
  linkTokenCreate: {
    key: "linkTokenCreate",
    fnName: "findLinkTokenCreateSpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression *.linkTokenCreate(...)",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and callee.name == "linkTokenCreate":
    pushSpan(node)
  forEachChild(node, visit)`,
  },
  "ChatCompletion.create": {
    key: "ChatCompletion.create",
    fnName: "findChatCompletionCreateSpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression *.ChatCompletion.create(...)",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and expr is *.ChatCompletion.create:
    pushSpan(node)
  forEachChild(node, visit)`,
  },
  "jwt.verify": {
    key: "jwt.verify",
    fnName: "findJwtVerifySpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression jwt.verify(...)",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and callee is jwt.verify:
    pushSpan(node)
  forEachChild(node, visit)`,
  },
  "listUsers.await": {
    key: "listUsers.await",
    fnName: "findListUsersAwaitSpans",
    sourcePath: AST_SOURCE,
    rule: "Match AwaitExpression wrapping *.listUsers()",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if AwaitExpression and await *.listUsers():
    pushSpan(awaitNode)  // splice (await …).data
  forEachChild(node, visit)`,
  },
  "getObject.promise": {
    key: "getObject.promise",
    fnName: "findGetObjectPromiseSpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression *.getObject(...).promise()",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and chain is getObject(...).promise():
    pushSpan(fullChain)
  forEachChild(node, visit)`,
  },
  "try.charges.create": {
    key: "try.charges.create",
    fnName: "findChargesCreateTrySpans",
    sourcePath: AST_SOURCE,
    rule: "Match TryStatement whose try-block contains .charges.create(",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if TryStatement and tryBlock matches /.charges.create(/:
    pushSpan(tryStmt)  // call + catch together
  forEachChild(node, visit)`,
  },
  sendEmail: {
    key: "sendEmail",
    fnName: "findSendEmailSpans",
    sourcePath: AST_SOURCE,
    rule: "Match CallExpression whose callee identifier is sendEmail",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if CallExpression and callee.text == "sendEmail":
    pushSpan(node)
  forEachChild(node, visit)`,
  },
  "event.switch": {
    key: "event.switch",
    fnName: "findEventSwitchSpans",
    sourcePath: AST_SOURCE,
    rule: "Match SwitchStatement on event.type / event_type",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if SwitchStatement and expr matches /.type|event_type/:
    pushSpan(switchStmt)
  forEachChild(node, visit)`,
  },
  "token.eq": {
    key: "token.eq",
    fnName: "findStaticTokenCompareSpans",
    sourcePath: AST_SOURCE,
    rule: "Match === / == comparing query.token or WEBHOOK_TOKEN",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if BinaryExpression (== / ===) and mentions token:
    pushSpan(compare)
  forEachChild(node, visit)`,
  },
  authorizeLegacyCompat: {
    key: "authorizeLegacyCompat",
    fnName: "findAuthorizeLegacyCompatSpans",
    sourcePath: AST_SOURCE,
    rule: "Match FunctionDeclaration named authorizeLegacyCompat",
    pseudocode: `sf = ts.createSourceFile(code)
visit(node):
  if FunctionDeclaration and name == "authorizeLegacyCompat":
    pushSpan(fn)
  forEachChild(node, visit)`,
  },
};

function explainFinders(spanFinders) {
  return (spanFinders || [])
    .map((key) => FINDER_EXPLAIN[key])
    .filter(Boolean);
}

export function loadCoreModule(root) {
  return loadCore(root);
}

/**
 * @param {string} root
 * @param {string} scenarioInput
 */
export async function collectSpans(root, scenarioInput) {
  const meta = getMeta(scenarioInput);
  const core = await loadCore(root);
  /** @type {Array<{ path: string; name: string; source: string; spans: object[] }>} */
  const files = [];

  for (const rel of meta.fixtureFiles) {
    const abs = path.join(root, rel);
    const source = readMaybe(abs);
    if (source == null) continue;
    const name = path.basename(rel);
    /** @type {object[]} */
    const spans = [];
    for (const key of meta.spanFinders) {
      const fnName = FINDER_MAP[key];
      const fn = core[fnName];
      if (typeof fn !== "function") continue;
      const found = fn(name, source) || [];
      for (const s of found) {
        spans.push({
          fileName: s.fileName ?? name,
          start: s.start,
          end: s.end,
          startLine: s.startLine,
          startChar: s.startChar,
          endLine: s.endLine,
          endChar: s.endChar,
          text: s.text,
          kind: s.kind,
        });
      }
    }
    files.push({ path: rel, name, source, spans });
  }

  return {
    scenario: meta.id,
    engine: "typescript-compiler-api",
    spanFinders: meta.spanFinders,
    finders: explainFinders(meta.spanFinders),
    files,
    spanCount: files.reduce((n, f) => n + f.spans.length, 0),
  };
}
