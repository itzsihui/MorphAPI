const { ts, parse, all, apply, span, callsTo, prop, indentOf } = require("./lib.cjs");
// Hand-coded facts: charges.create -> intents.confirm(builder); field->setter map (4); capture boolean -> CaptureMode (2);
// Charge.captured -> captureMode === CaptureMode.AUTOMATIC; import specifier.
const SETTER = { amount: "setAmount", currency: "setCurrency", source: "setPaymentMethod" };
module.exports = (file, text) => {
  if (!text.includes("morphpay-v1")) return text;
  const sf = parse(file, text); const edits = [];
  const charged = new Set();
  for (const c of callsTo(sf, /\.charges\.create$/)) {
    const arg = c.arguments[0]; const recv = c.expression.expression.expression.getText(sf);
    const ind = indentOf(text, c.getStart(sf));
    const chain = Object.entries(SETTER).filter(([k]) => prop(arg, k)).map(([k, m]) => `${ind}    .${m}(${prop(arg, k).initializer.getText(sf)})`);
    const cap = prop(arg, "capture"); const mode = cap && cap.initializer.kind === ts.SyntaxKind.FalseKeyword ? "MANUAL" : "AUTOMATIC";
    chain.push(`${ind}    .setCaptureMode(CaptureMode.${mode})`);
    edits.push(span(c, sf, `${recv}.intents.confirm(\n${ind}  new PaymentIntentBuilder()\n${chain.join("\n")}\n${ind}    .build()\n${ind})`));
    const decl = c.parent && ts.isAwaitExpression(c.parent) && ts.isVariableDeclaration(c.parent.parent) ? c.parent.parent.name.getText(sf) : null;
    if (decl) charged.add(decl);
  }
  for (const pa of all(sf, (n) => ts.isPropertyAccessExpression(n) && n.name.text === "captured" && charged.has(n.expression.getText(sf))))
    edits.push(span(pa, sf, `${pa.expression.getText(sf)}.captureMode === CaptureMode.AUTOMATIC`));
  for (const d of all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "morphpay-v1"))
    edits.push(span(d, sf, d.getText(sf).replace(/from\s+["']morphpay-v1["']/, 'from "morphpay-v2"').replace(/^import (\w+)\s+from/, 'import $1, { CaptureMode, PaymentIntentBuilder } from')));
  return apply(text, edits);
};
