// Shared comparison logic (used by run.mjs and the agent Stop-hook gate). Moved verbatim from run.mjs.
const leaves = (v, acc = []) => { if (typeof v === "string") acc.push(v); else if (v && typeof v === "object") Object.values(v).forEach((x) => leaves(x, acc)); return acc; };
const mask = (v, strs, objs) => {
  if (v && typeof v === "object" && objs.has(J(v))) return "<lib>";
  if (typeof v === "string") { if (strs.includes(v)) return "<lib>"; let s = v; for (const t of strs) if (t.length >= 6) s = s.split(t).join("<lib>"); return s; }
  if (Array.isArray(v)) return v.map((x) => mask(x, strs, objs));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x, strs, objs)]));
  return v;
};
// Canonical JSON (sorted keys): key order carries no meaning in a JSON request or result.
const J = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
// Every object/array inside a library response: a consumer result equal to one of these is the response passed through.
const subtrees = (v, acc = new Set()) => { if (v && typeof v === "object") { acc.add(J(v)); Object.values(v).forEach((x) => subtrees(x, acc)); } return acc; };
const bview = (c) => (typeof c.out === "boolean" ? c.out : !c.threw);

export function compare(t1, t2) {
  if (t1.fatal || t2.fatal) return [{ kind: "fatal", detail: t1.fatal || t2.fatal }];
  const f = []; const groups = {};
  t1.calls.forEach((c, i) => (groups[`${c.file}:${c.fn}`] ??= []).push(i));
  const related = new Set();
  for (const [g, idx] of Object.entries(groups)) for (const p of t1.preds) {
    if (!t2.preds.includes(p)) continue;
    const holds = idx.every((i) => bview(t1.calls[i]) === t1.calls[i].preds[p]) && new Set(idx.map((i) => t1.calls[i].preds[p])).size > 1;
    if (!holds) continue; related.add(g);
    for (const i of idx) { const c = t2.calls[i]; if (bview(c) !== c.preds[p])
      f.push({ kind: "relation", call: `${c.fn}(${c.label})`, detail: `v1: result == ${p}(input); v2: ${p}(input)=${c.preds[p]} but result=${bview(c)}` }); }
  }
  t1.calls.forEach((c1, i) => { const c2 = t2.calls[i]; const call = `${c1.fn}(${c1.label})`;
    const w1 = c1.wire.map((w) => ({ op: w.op, req: w.req })), w2 = c2.wire.map((w) => ({ op: w.op, req: w.req }));
    if (J(w1) !== J(w2)) f.push({ kind: "wire", call, v1: w1, v2: w2 });
    if (related.has(`${c1.file}:${c1.fn}`)) return;
    if (c1.threw !== c2.threw) { f.push({ kind: "throw", call, v1: c1.threw ? c1.err : c1.out, v2: c2.threw ? c2.err : c2.out }); return; }
    const m = (c) => mask(c.out, leaves(c.wire.map((w) => w.res)).sort((a, b) => b.length - a.length), subtrees(c.wire.map((w) => w.res)));
    const o1 = m(c1), o2 = m(c2);
    if (J(o1) !== J(o2)) f.push({ kind: "output", call, v1: o1, v2: o2 });
  });
  return f;
}

