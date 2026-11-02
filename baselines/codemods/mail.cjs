const { ts, parse, all, apply, span } = require("./lib.cjs");
// Hand-coded facts: positional sendEmail(to, from, subject, body) -> send({ to, from, subject, content }) (4 field names);
// SendResult.id -> messageId; default import -> named import; package rename.
const FIELDS = ["to", "from", "subject", "content"];
module.exports = (file, text) => {
  if (!text.includes("mail-send-v1")) return text;
  const sf = parse(file, text); const edits = []; const results = new Set();
  const imp = all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "mail-send-v1")[0];
  const local = imp.importClause.name.text;
  for (const c of all(sf, (n) => ts.isCallExpression(n) && n.expression.getText(sf) === local)) {
    const ind = /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", c.getStart(sf)) + 1))[0];
    const fields = c.arguments.map((a, i) => `${ind}  ${FIELDS[i]}: ${a.getText(sf)},`);
    edits.push(span(c, sf, `send({\n${fields.join("\n")}\n${ind}})`));
    if (ts.isAwaitExpression(c.parent) && ts.isVariableDeclaration(c.parent.parent)) results.add(c.parent.parent.name.getText(sf));
  }
  for (const pa of all(sf, (n) => ts.isPropertyAccessExpression(n) && n.name.text === "id" && results.has(n.expression.getText(sf))))
    edits.push(span(pa.name, sf, "messageId"));
  edits.push(span(imp, sf, `import { send } from "mail-send-v2";`));
  return apply(text, edits);
};
