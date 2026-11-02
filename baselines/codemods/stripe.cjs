const { ts, parse, apply, span, callsTo, prop, renameImport } = require("./lib.cjs");
// Hand-coded facts: amount unit dollars -> integer cents (literal: x100 rounded; expression: Math.round(x * 100));
// package rename.
module.exports = (file, text) => {
  if (!text.includes("stripe-charge-v1")) return text;
  const sf = parse(file, text); const edits = [];
  for (const c of callsTo(sf, /\.charges\.create$/)) {
    const a = prop(c.arguments[0], "amount"); if (!a) continue;
    const v = a.initializer;
    edits.push(span(v, sf, ts.isNumericLiteral(v) ? String(Math.round(Number(v.text) * 100)) : `Math.round(${v.getText(sf)} * 100)`));
  }
  edits.push(...renameImport(sf, "stripe-charge-v1", "stripe-charge-v2"));
  return apply(text, edits);
};
