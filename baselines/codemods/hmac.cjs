const { ts, parse, all, apply, span, renameImport } = require("./lib.cjs");
// Hand-coded facts: v2 verifies an HMAC signature; inline static-token comparisons (req.query.token === env) must be
// replaced by the library check; package rename.
module.exports = (file, text) => {
  if (!text.includes("webhook-auth-v1")) return text;
  const sf = parse(file, text); const edits = [];
  const imp = all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "webhook-auth-v1")[0];
  const verify = imp.importClause.name.text;
  for (const f of all(sf, ts.isFunctionDeclaration)) {
    const body = f.body; if (!body) continue;
    const tokenVar = body.statements.find((s) => ts.isVariableStatement(s) && /\.query\.token$/.test(s.declarationList.declarations[0].initializer?.getText(sf) ?? ""));
    const ret = body.statements.find((s) => ts.isReturnStatement(s) && s.expression && ts.isBinaryExpression(s.expression) && /===|==/.test(s.expression.operatorToken.getText(sf)));
    if (!tokenVar || !ret) continue;
    const req = f.parameters[0].name.getText(sf);
    edits.push({ start: tokenVar.getFullStart(), end: tokenVar.getEnd(), text: "" });
    edits.push(span(ret, sf, `return ${verify}(${req});`));
  }
  edits.push(...renameImport(sf, "webhook-auth-v1", "webhook-auth-v2"));
  return apply(text, edits);
};
