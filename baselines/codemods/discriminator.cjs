const { ts, parse, all, apply, span, renameImport } = require("./lib.cjs");
// Hand-coded facts: event names (3) old -> new; discriminant field type -> event_type; package rename.
const EVENTS = { MESSAGE_CREATE: "message.created", MESSAGE_UPDATE: "message.updated", REACTION_ADD: "reaction.added" };
module.exports = (file, text) => {
  if (!text.includes("events-gateway-v1")) return text;
  const sf = parse(file, text); const edits = [];
  for (const s of all(sf, (n) => ts.isStringLiteral(n) && EVENTS[n.text] && (ts.isArrayLiteralExpression(n.parent) || ts.isCaseClause(n.parent))))
    edits.push(span(s, sf, JSON.stringify(EVENTS[s.text])));
  for (const sw of all(sf, ts.isSwitchStatement)) {
    const e = sw.expression;
    if (ts.isPropertyAccessExpression(e) && e.name.text === "type" && sw.caseBlock.clauses.some((c) => ts.isCaseClause(c) && ts.isStringLiteral(c.expression) && EVENTS[c.expression.text]))
      edits.push(span(e.name, sf, "event_type"));
  }
  edits.push(...renameImport(sf, "events-gateway-v1", "events-gateway-v2"));
  return apply(text, edits);
};
