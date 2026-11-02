const { ts, parse, all, apply, span, callsTo } = require("./lib.cjs");
// Hand-coded facts: symmetric secret -> JWKS key lookup (decodeHeader -> createJwksClient(jwksUri env) -> getSigningKey(kid)
// -> getPublicKey()); verify becomes async so the enclosing function becomes async; package rename.
module.exports = (file, text) => {
  if (!text.includes("auth-jwt-v1")) return text;
  const sf = parse(file, text); const edits = []; const fns = new Set();
  for (const c of callsTo(sf, /^jwt\.verify$/)) {
    const tok = c.arguments[0].getText(sf);
    edits.push(span(c.arguments[1], sf, `(await createJwksClient({ jwksUri: process.env.JWKS_URI! }).getSigningKey(decodeHeader(${tok}).kid)).getPublicKey()`));
    let f = c.parent; while (f && !ts.isFunctionLike(f)) f = f.parent;
    if (f && !(ts.getCombinedModifierFlags(f) & ts.ModifierFlags.Async)) fns.add(f);
  }
  for (const f of fns) {
    if (ts.isFunctionDeclaration(f)) { const kw = f.getChildren(sf).find((x) => x.kind === ts.SyntaxKind.FunctionKeyword); edits.push({ start: kw.getStart(sf), end: kw.getStart(sf), text: "async " }); }
    else edits.push({ start: f.getStart(sf), end: f.getStart(sf), text: "async " });
  }
  for (const d of all(sf, (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "auth-jwt-v1"))
    edits.push(span(d, sf, `import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";`));
  return apply(text, edits);
};
