const { ts, parse, all, apply, span, callsTo } = require("./lib.cjs");
// Hand-coded facts: s3.getObject(p).promise() -> s3.send(new GetObjectCommand(p)); import GetObjectCommand; package rename.
module.exports = (file, text) => {
  if (!text.includes("aws-s3-v1")) return text;
  const sf = parse(file, text); const edits = [];
  for (const c of callsTo(sf, /\.promise$/)) {
    const inner = c.expression.expression;
    if (!ts.isCallExpression(inner) || !ts.isPropertyAccessExpression(inner.expression) || inner.expression.name.text !== "getObject") continue;
    edits.push(span(c, sf, `${inner.expression.expression.getText(sf)}.send(new GetObjectCommand(${inner.arguments.map((a) => a.getText(sf)).join(", ")}))`));
  }
  for (const d of all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "aws-s3-v1"))
    edits.push(span(d, sf, d.getText(sf).replace(/\{([^}]*)\}/, (m, g) => `{${g.replace(/\s*$/, "")}, GetObjectCommand }`).replace(/["']aws-s3-v1["']/, '"aws-s3-v2"')));
  return apply(text, edits);
};
