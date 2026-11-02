const { ts, parse, all, apply, span, callsTo, prop } = require("./lib.cjs");
// Hand-coded facts: string -> enum member maps for country codes (5) and products (5); enum import; package rename.
const COUNTRY = { US: "Us", GB: "Gb", CA: "Ca", FR: "Fr", DE: "De" };
const PRODUCT = { auth: "Auth", identity: "Identity", transactions: "Transactions", investments: "Investments", liabilities: "Liabilities" };
module.exports = (file, text) => {
  if (!text.includes("plaid-link-v1")) return text;
  const sf = parse(file, text); const edits = [];
  for (const c of callsTo(sf, /\.linkTokenCreate$/)) {
    const arg = c.arguments[0];
    for (const [key, en, map] of [["country_codes", "CountryCode", COUNTRY], ["products", "Products", PRODUCT]]) {
      const p = prop(arg, key); if (!p || !ts.isArrayLiteralExpression(p.initializer)) continue;
      for (const el of p.initializer.elements) if (ts.isStringLiteral(el)) {
        if (!map[el.text]) throw new Error(`no rule for ${key} ${el.text}`);
        edits.push(span(el, sf, `${en}.${map[el.text]}`));
      }
    }
  }
  for (const d of all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "plaid-link-v1"))
    edits.push(span(d, sf, d.getText(sf).replace(/from\s+["']plaid-link-v1["']/, 'from "plaid-link-v2"').replace(/^import (\w+)\s+from/, 'import $1, { CountryCode, Products } from')));
  return apply(text, edits);
};
