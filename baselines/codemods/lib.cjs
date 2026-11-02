// Shared helpers for the hand-written codemods (syntax only, like jscodeshift): parse, find, splice.
// Not counted in per-scenario effort (written once).
const ts = require("typescript");
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
function all(sf, pred) { const out = []; const v = (n) => { if (pred(n)) out.push(n); ts.forEachChild(n, v); }; v(sf); return out; }
function apply(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
const span = (n, sf, text) => ({ start: n.getStart(sf), end: n.getEnd(), text });
/** Replace the module specifier `from` with `to` in import declarations. */
function renameImport(sf, from, to) {
  return all(sf, (n) => ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === from)
    .map((d) => span(d.moduleSpecifier, sf, JSON.stringify(to)));
}
/** Call `obj.a.b(...)` whose callee text matches. */
const callsTo = (sf, re) => all(sf, (n) => ts.isCallExpression(n) && re.test(n.expression.getText(sf)));
const prop = (obj, name) => obj.properties.find((p) => p.name && p.name.getText() === name);
const indentOf = (text, pos) => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", pos - 1) + 1))[0];
module.exports = { ts, parse, all, apply, span, renameImport, callsTo, prop, indentOf };
