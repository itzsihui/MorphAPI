const { ts, parse, all, apply, span, callsTo, prop } = require("./lib.cjs");
// Hand-coded facts: default export object -> class instance (env var name); charges.create -> paymentIntents.create;
// source -> payment_method; confirm: true; error.CardError/APIError -> StripeCardError/StripeAPIError; package rename.
const ERR = { CardError: "StripeCardError", APIError: "StripeAPIError" };
module.exports = (file, text) => {
  if (!text.includes("stripe-errors-v1")) return text;
  const sf = parse(file, text); const edits = []; const used = new Set();
  const imp = all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "stripe-errors-v1")[0];
  const local = imp.importClause.name.text;
  for (const c of callsTo(sf, new RegExp(`^${local}\\.charges\\.create$`))) {
    edits.push(span(c.expression, sf, `${local}.paymentIntents.create`));
    const obj = c.arguments[0]; const src = prop(obj, "source");
    edits.push(span(src, sf, ts.isShorthandPropertyAssignment(src) ? "payment_method: source" : `payment_method: ${src.initializer.getText(sf)}`));
    const last = obj.properties[obj.properties.length - 1];
    edits.push({ start: last.getEnd(), end: last.getEnd(), text: ",\n" + /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", last.getStart(sf)) + 1))[0] + "confirm: true" });
  }
  for (const pa of all(sf, (n) => ts.isPropertyAccessExpression(n) && n.expression.getText(sf) === `${local}.error` && ERR[n.name.text])) {
    edits.push(span(pa, sf, ERR[pa.name.text])); used.add(ERR[pa.name.text]);
  }
  edits.push(span(imp, sf, `import Stripe${used.size ? `, { ${[...used].sort().join(", ")} }` : ""} from "stripe-errors-v2";\n\nconst ${local} = new Stripe(process.env.STRIPE_KEY!);`));
  return apply(text, edits);
};
