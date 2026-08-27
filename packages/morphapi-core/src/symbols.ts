import * as ts from "typescript";

/**
 * Extract MorphPay-relevant symbols and member chains from source via TS AST.
 */
export function extractSymbolsFromCode(code: string): string[] {
  const sourceFile = ts.createSourceFile(
    "snippet.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const symbols = new Set<string>();

  function addId(name: string) {
    if (name && !isKeywordish(name)) symbols.add(name);
  }

  function memberChain(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const left = memberChain(node.expression);
      if (left) return `${left}.${node.name.text}`;
      return node.name.text;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const left = memberChain(node.expression);
      if (left) return `${left}.${node.argumentExpression.text}`;
    }
    return undefined;
  }

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      addId(node.text);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const chain = memberChain(node);
      if (chain) symbols.add(chain);
      addId(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const chain = memberChain(node.expression);
      if (chain) symbols.add(chain);
    }
    if (ts.isNewExpression(node)) {
      const chain = memberChain(node.expression);
      if (chain) symbols.add(chain);
    }
    if (ts.isImportDeclaration(node) && node.importClause) {
      const named = node.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          addId(el.name.text);
        }
      }
      if (node.importClause.name) addId(node.importClause.name.text);
    }
    if (ts.isEnumMember(node) && node.name && ts.isIdentifier(node.name)) {
      addId(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...symbols];
}

function isKeywordish(name: string): boolean {
  return [
    "from",
    "import",
    "export",
    "const",
    "let",
    "var",
    "function",
    "class",
    "interface",
    "type",
    "enum",
    "extends",
    "implements",
    "new",
    "typeof",
    "keyof",
    "in",
    "of",
    "if",
    "else",
    "for",
    "while",
    "switch",
    "case",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "void",
    "null",
    "undefined",
    "this",
    "super",
    "as",
    "is",
    "satisfies",
  ].includes(name);
}
