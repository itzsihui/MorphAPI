const { ts, parse, all, apply, span, callsTo, prop } = require("./lib.cjs");
// Hand-coded facts: ChatCompletion.create -> chat.completions.create; engine -> model; constructor(string) -> ({ apiKey });
// package rename.
module.exports = (file, text) => {
  if (!text.includes("openai-chat-v0")) return text;
  const sf = parse(file, text); const edits = [];
  const imp = all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "openai-chat-v0");
  const local = imp.map((d) => d.importClause && d.importClause.name && d.importClause.name.text).filter(Boolean);
  for (const c of callsTo(sf, /\.ChatCompletion\.create$/)) {
    const recv = c.expression.expression.expression.getText(sf);
    edits.push(span(c.expression, sf, `${recv}.chat.completions.create`));
    const e = prop(c.arguments[0], "engine"); if (e) edits.push(span(e.name, sf, "model"));
  }
  for (const n of all(sf, (n) => ts.isNewExpression(n) && local.includes(n.expression.getText(sf)) && n.arguments && n.arguments.length === 1 && !ts.isObjectLiteralExpression(n.arguments[0])))
    edits.push(span(n.arguments[0], sf, `{ apiKey: ${n.arguments[0].getText(sf)} }`));
  for (const d of imp) edits.push(span(d.moduleSpecifier, sf, '"openai-chat-v1"'));
  return apply(text, edits);
};
