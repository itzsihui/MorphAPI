const { ts, parse, all, apply, span, callsTo, renameImport } = require("./lib.cjs");
// Hand-coded facts: listUsers() now returns { data, pagination }: unwrap .data at the call; package rename.
module.exports = (file, text) => {
  if (!text.includes("users-list-v1")) return text;
  const sf = parse(file, text); const edits = [];
  for (const c of callsTo(sf, /\.listUsers$/)) {
    const aw = ts.isAwaitExpression(c.parent) ? c.parent : null;
    edits.push(aw ? span(aw, sf, `(await ${c.getText(sf)}).data`) : span(c, sf, `${c.getText(sf)}.then((page) => page.data)`));
  }
  edits.push(...renameImport(sf, "users-list-v1", "users-list-v2"));
  return apply(text, edits);
};
