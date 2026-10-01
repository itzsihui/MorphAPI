import { useMemo, useState } from "react";
import type { AstOutlineNode, CpgEdge, CpgEdgeKind, CpgNode, DfgEdge, DfgNode } from "./graphApi";

/* ── AST tree ─────────────────────────────────────────────────────────────── */

type Placed = { n: AstOutlineNode; depth: number; y: number; w: number; order: number };

const astLabel = (n: AstOutlineNode) => (n.type && n.kind === "Identifier" ? `${n.label}: ${n.type}` : n.label);

export function AstTreeDiagram({
  outline,
  hoverDfg,
  onHover,
}: {
  outline: AstOutlineNode;
  hoverDfg: string | null;
  onHover: (id: string | null) => void;
}) {
  const layout = useMemo(() => {
    const rowH = 27;
    const placed = new Map<string, Placed>();
    let leaf = 0;
    let order = 0;
    const widthOf = (n: AstOutlineNode) => Math.max(38, Math.min(260, astLabel(n).length * 6.7 + 18));
    const place = (n: AstOutlineNode, depth: number): number => {
      const my = order++;
      let y: number;
      if (!n.children.length) y = leaf++ * rowH;
      else {
        const ys = n.children.map((c) => place(c, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      placed.set(n.id, { n, depth, y, w: widthOf(n), order: my });
      return y;
    };
    place(outline, 0);
    const colW: number[] = [];
    for (const p of placed.values()) colW[p.depth] = Math.max(colW[p.depth] ?? 0, p.w);
    const colX: number[] = [];
    let x = 8;
    colW.forEach((w, d) => {
      colX[d] = x;
      x += w + 34;
    });
    return { placed: [...placed.values()], colX, width: x, height: leaf * rowH + 16 };
  }, [outline]);

  const byId = new Map(layout.placed.map((p) => [p.n.id, p]));
  const edges: Array<{ a: Placed; b: Placed }> = [];
  for (const p of layout.placed) for (const c of p.n.children) edges.push({ a: p, b: byId.get(c.id) as Placed });

  const cls = (n: AstOutlineNode) => {
    if (n.dfgId) return "dfg";
    if (n.kind === "Identifier") return "ident";
    if (/Literal|Template/.test(n.kind)) return "lit";
    if (n.label.startsWith(":")) return "type";
    return "struct";
  };

  return (
    <div className="cg-scroll">
      <svg width={layout.width} height={layout.height} className="cg-svg" role="img" aria-label="Syntax tree">
        {edges.map(({ a, b }) => {
          const x1 = layout.colX[a.depth] + a.w;
          const y1 = a.y + 14;
          const x2 = layout.colX[b.depth];
          const y2 = b.y + 14;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${a.n.id}-${b.n.id}`}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              className="cg-ast-edge"
              style={{ animationDelay: `${b.order * 20}ms` }}
            />
          );
        })}
        {layout.placed.map((p) => (
          <g
            key={p.n.id}
            className={`cg-ast-node ${cls(p.n)} ${p.n.inSpan ? "span" : ""} ${p.n.dfgId && p.n.dfgId === hoverDfg ? "hot" : ""}`}
            style={{ animationDelay: `${p.order * 20}ms` }}
            onMouseEnter={() => onHover(p.n.dfgId ?? null)}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${p.n.kind}${p.n.type ? ` · type ${p.n.type}` : ""}`}</title>
            <rect x={layout.colX[p.depth]} y={p.y + 4} width={p.w} height={20} rx={4} />
            <text x={layout.colX[p.depth] + 8} y={p.y + 18}>
              {astLabel(p.n).length > 36 ? `${astLabel(p.n).slice(0, 35)}…` : astLabel(p.n)}
            </text>
            {p.n.dfgId ? (
              <text className="cg-ast-tag" x={layout.colX[p.depth] + p.w - 2} y={p.y + 3} textAnchor="end">
                {p.n.dfgId}
              </text>
            ) : null}
            {p.n.collapsed ? (
              <text x={layout.colX[p.depth] + p.w + 4} y={p.y + 18} className="cg-ast-tag">
                …
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="cg-legend">
        <li><i className="sw span" /> inside the finder span (the call to migrate)</li>
        <li><i className="sw dfgv" /> identifier that is a data-flow node (vN)</li>
        <li>Identifiers show their checker-resolved type</li>
      </ul>
    </div>
  );
}

/* ── Code with span + DFG occurrences highlighted ────────────────────────── */

export function HighlightedCode({
  code,
  startLine,
  span,
  nodes,
  hoverDfg,
  onHover,
}: {
  code: string;
  startLine: number;
  span: { start: number; end: number } | null;
  nodes: Array<{ id: string; start: number; end: number; role?: string; type?: string }>;
  hoverDfg: string | null;
  onHover: (id: string | null) => void;
}) {
  const segments = useMemo(() => {
    const cuts = new Set<number>([0, code.length]);
    for (const n of nodes) {
      cuts.add(n.start);
      cuts.add(n.end);
    }
    if (span) {
      cuts.add(span.start);
      cuts.add(span.end);
    }
    const pts = [...cuts].filter((c) => c >= 0 && c <= code.length).sort((a, b) => a - b);
    const out: Array<{ text: string; occ?: (typeof nodes)[number]; inSpan: boolean }> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({
        text: code.slice(a, b),
        occ: nodes.find((n) => n.start <= a && n.end >= b),
        inSpan: !!span && a >= span.start && b <= span.end,
      });
    }
    return out;
  }, [code, nodes, span]);

  const lines = code.split("\n").length;
  return (
    <div className="cg-code-wrap">
      <pre className="cg-gutter" aria-hidden>
        {Array.from({ length: lines }, (_, i) => startLine + i).join("\n")}
      </pre>
      <pre className="cg-code">
        {segments.map((s, i) =>
          s.occ ? (
            <mark
              key={i}
              className={`cg-occ ${s.occ.role ?? ""} ${s.inSpan ? "in-span" : ""} ${s.occ.id === hoverDfg ? "hot" : ""}`}
              title={`${s.occ.id}${s.occ.type ? ` : ${s.occ.type}` : ""}`}
              onMouseEnter={() => onHover(s.occ?.id ?? null)}
              onMouseLeave={() => onHover(null)}
            >
              {s.text}
            </mark>
          ) : (
            <span key={i} className={s.inSpan ? "in-span" : undefined}>
              {s.text}
            </span>
          )
        )}
      </pre>
    </div>
  );
}

/* ── Typed data-flow graph ───────────────────────────────────────────────── */

export function DfgDiagram({
  nodes,
  edges,
  hoverDfg,
  onHover,
}: {
  nodes: DfgNode[];
  edges: DfgEdge[];
  hoverDfg: string | null;
  onHover: (id: string | null) => void;
}) {
  const seq = (id: string) => Number(id.slice(1));
  const ordered = useMemo(() => [...nodes].sort((a, b) => seq(a.id) - seq(b.id)), [nodes]);
  const lanes = useMemo(() => [...new Set(ordered.map((n) => n.name))], [ordered]);
  const typeOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of ordered) if (!m.has(n.name)) m.set(n.name, n.type);
    return m;
  }, [ordered]);
  const colGap = 72;
  const rowGap = 62;
  const left = 150;
  const pos = new Map(
    ordered.map((n, col) => [n.id, { x: left + col * colGap, y: 34 + lanes.indexOf(n.name) * rowGap }])
  );
  const width = left + ordered.length * colGap + 20;
  const height = 34 + lanes.length * rowGap;

  if (!nodes.length) return <p className="muted">No local variables in this function — the graph is empty.</p>;

  return (
    <div className="cg-scroll">
      <svg width={width} height={height} className="cg-svg" role="img" aria-label="Data-flow graph">
        <defs>
          <marker id="cg-arr-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#0f5c63" />
          </marker>
          <marker id="cg-arr-p" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#b8741a" />
          </marker>
        </defs>
        {lanes.map((name, i) => (
          <g key={name}>
            <line x1={left - 30} x2={width - 10} y1={34 + i * rowGap} y2={34 + i * rowGap} className="cg-lane" />
            <text x={8} y={32 + i * rowGap} className="cg-lane-label">
              {name}
            </text>
            <text x={8} y={46 + i * rowGap} className="cg-lane-type">
              {typeOf.get(name)}
            </text>
          </g>
        ))}
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const dx = Math.max(24, (b.x - a.x) / 2);
          const hot = hoverDfg === e.from || hoverDfg === e.to;
          return (
            <path
              key={i}
              d={`M${a.x + 17},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x - 18},${b.y}`}
              className={`cg-dfg-edge ${e.kind} ${hot ? "hot" : ""}`}
              markerEnd={e.kind === "comesFrom" ? "url(#cg-arr-c)" : "url(#cg-arr-p)"}
              style={{ animationDelay: `${i * 90}ms` }}
              pathLength={1}
            />
          );
        })}
        {ordered.map((n, i) => {
          const p = pos.get(n.id)!;
          return (
            <g
              key={n.id}
              className={`cg-dfg-node ${n.role} ${hoverDfg === n.id ? "hot" : ""}`}
              style={{ animationDelay: `${i * 90}ms` }}
              onMouseEnter={() => onHover(n.id)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{`${n.name}: ${n.type} (${n.role}, line ${n.line})`}</title>
              <circle cx={p.x} cy={p.y} r={17} />
              <text x={p.x} y={p.y + 4} textAnchor="middle">
                {n.id}
              </text>
              <text x={p.x} y={p.y + 32} textAnchor="middle" className="cg-dfg-role">
                {n.role} · L{n.line}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="cg-legend">
        <li><i className="sw comes" /> comesFrom — a use reads the value defined earlier</li>
        <li><i className="sw computed" /> computedFrom — a definition is built from these operands</li>
        <li>Lane label = variable name + its TypeChecker type</li>
      </ul>
    </div>
  );
}

/* ── Code Property Graph ─────────────────────────────────────────────────── */

export type EdgeGroup = "dataflow" | "calls" | "resolution" | "contains" | "argument_of";

export const EDGE_GROUPS: Array<{ id: EdgeGroup; label: string; kinds: CpgEdgeKind[]; hint: string }> = [
  { id: "dataflow", label: "Data flow", kinds: ["comesFrom", "computedFrom"], hint: "variable → variable" },
  { id: "calls", label: "Calls", kinds: ["calls"], hint: "function → function it calls" },
  { id: "resolution", label: "Resolution", kinds: ["resolves_to", "migrates_to"], hint: "call → v1 symbol → v2 successor" },
  { id: "contains", label: "Contains", kinds: ["contains"], hint: "function → call site inside it" },
  { id: "argument_of", label: "Arguments", kinds: ["argument_of"], hint: "variable → call it is passed to" },
];

export const DEFAULT_EDGE_GROUPS: Record<EdgeGroup, boolean> = {
  dataflow: true,
  calls: true,
  resolution: true,
  contains: false,
  argument_of: false,
};

const ROW = 44;
const BOX_H = 34;
const LANE_HEAD = 26;
const LANE_PAD = 14;
const COLS: Record<Exclude<CpgNode["kind"], "api_symbol">, { x: number; w: number }> = {
  function: { x: 110, w: 175 },
  variable: { x: 320, w: 150 },
  call_site: { x: 510, w: 175 },
};
const API_X = 760;
const API_W = 250;

function nodeSub(n: CpgNode): string {
  switch (n.kind) {
    case "function":
      return `${n.async ? "async · " : ""}${n.returnType ?? ""}`;
    case "variable":
      return `${n.type ?? "?"} · ${n.role ?? ""} · L${n.line ?? "?"}`;
    case "call_site":
      return `L${n.line ?? "?"} · ${n.deprecated ? `deprecated (${n.deprecatedReason})` : n.spanKind ?? ""}`;
    case "api_symbol":
      return n.symbolRole === "successor" ? "successor (v2)" : "deprecated (v1)";
  }
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function CpgDiagram({
  nodes,
  edges,
  files,
  enabled,
  focusId,
  selected,
  onSelect,
}: {
  nodes: CpgNode[];
  edges: CpgEdge[];
  files: string[];
  enabled: Record<EdgeGroup, boolean>;
  focusId: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; w: number }>();
    const laneFiles = files.filter((f) => nodes.some((n) => n.fileName === f && n.kind !== "api_symbol"));
    const lanes: Array<{ file: string; y: number; h: number }> = [];
    let y = 28;
    for (const file of laneFiles) {
      const inLane = nodes.filter((n) => n.fileName === file && n.kind !== "api_symbol");
      const byCol = (k: keyof typeof COLS) =>
        inLane.filter((n) => n.kind === k).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
      const cols = { function: byCol("function"), variable: byCol("variable"), call_site: byCol("call_site") };
      const rows = Math.max(1, cols.function.length, cols.variable.length, cols.call_site.length);
      const h = LANE_HEAD + rows * Math.max(40, ROW) + LANE_PAD;
      (Object.keys(cols) as Array<keyof typeof COLS>).forEach((k) => {
        cols[k].forEach((n, i) => pos.set(n.id, { x: COLS[k].x, y: y + LANE_HEAD + i * ROW, w: COLS[k].w }));
      });
      lanes.push({ file, y, h });
      y += h + 10;
    }
    const totalH = Math.max(y, 120);
    const apis = nodes
      .filter((n) => n.kind === "api_symbol")
      .sort((a, b) => (a.symbolRole === b.symbolRole ? 0 : a.symbolRole === "deprecated" ? -1 : 1));
    const apiBlock = apis.length * (ROW + 18);
    const apiTop = Math.max(32, (totalH - apiBlock) / 2);
    apis.forEach((n, i) => pos.set(n.id, { x: API_X, y: apiTop + i * (ROW + 18), w: API_W }));
    return { pos, lanes, width: API_X + API_W + 60, height: totalH };
  }, [nodes, files]);

  const kinds = new Set(EDGE_GROUPS.filter((g) => enabled[g.id]).flatMap((g) => g.kinds));
  const visible = edges.filter((e) => kinds.has(e.kind) && layout.pos.has(e.from) && layout.pos.has(e.to));
  const active = hover;
  const neighbours = new Set<string>();
  if (active)
    for (const e of visible)
      if (e.from === active || e.to === active) {
        neighbours.add(e.from);
        neighbours.add(e.to);
      }

  const edgePath = (e: CpgEdge) => {
    const a = layout.pos.get(e.from)!;
    const b = layout.pos.get(e.to)!;
    const ay = a.y + BOX_H / 2;
    const by = b.y + BOX_H / 2;
    if (a.x === b.x) {
      const bulge = 26 + Math.min(60, Math.abs(by - ay) / 6);
      if (a.x === COLS.function.x) {
        const x = a.x;
        const left = Math.min(bulge, x - 20);
        return `M${x},${ay} C${x - left},${ay} ${x - left},${by} ${x - 2},${by}`;
      }
      const x = a.x + a.w;
      return `M${x},${ay} C${x + bulge},${ay} ${x + bulge},${by} ${x + 2},${by}`;
    }
    if (a.x < b.x) {
      const x1 = a.x + a.w;
      const x2 = b.x;
      const mx = (x1 + x2) / 2;
      return `M${x1},${ay} C${mx},${ay} ${mx},${by} ${x2 - 2},${by}`;
    }
    const x1 = a.x;
    const x2 = b.x + b.w;
    const mx = (x1 + x2) / 2;
    return `M${x1},${ay} C${mx},${ay} ${mx},${by} ${x2 + 2},${by}`;
  };

  return (
    <div className="cg-scroll">
      <svg width={layout.width} height={layout.height} className="cg-svg cg-cpg" role="img" aria-label="Code property graph">
        <defs>
          {EDGE_GROUPS.flatMap((g) => g.kinds).map((k) => (
            <marker key={k} id={`cpg-arr-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className={`cpg-arrow ${k}`} />
            </marker>
          ))}
        </defs>
        {layout.lanes.map((l) => (
          <g key={l.file}>
            <rect x={4} y={l.y} width={API_X - 40} height={l.h} className="cpg-lane" />
            <text x={14} y={l.y + 18} className="cpg-lane-label">
              {l.file}
            </text>
          </g>
        ))}
        <text x={COLS.function.x} y={18} className="cpg-col-label">functions</text>
        <text x={COLS.variable.x} y={18} className="cpg-col-label">variables</text>
        <text x={COLS.call_site.x} y={18} className="cpg-col-label">call sites</text>
        <rect x={API_X - 14} y={4} width={API_W + 28} height={layout.height - 8} className="cpg-api-col" />
        <text x={API_X} y={20} className="cpg-lane-label">
          API symbols (resolved by TypeChecker)
        </text>
        {visible.map((e, i) => {
          const hot = active != null && (e.from === active || e.to === active);
          const dim = active != null && !hot;
          return (
            <g key={`${e.kind}-${e.from}-${e.to}-${i}`} className={`cpg-edge ${e.kind} ${hot ? "hot" : ""} ${dim ? "dim" : ""}`}>
              <path d={edgePath(e)} markerEnd={`url(#cpg-arr-${e.kind})`} />
              <title>{`${e.kind}${e.label ? ` · ${e.label}` : ""}`}</title>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const dim = active != null && active !== n.id && !neighbours.has(n.id);
          const cls = [
            "cpg-node",
            n.kind,
            n.kind === "api_symbol" ? n.symbolRole : "",
            n.kind === "call_site" && n.deprecated ? "deprecated" : "",
            n.id === focusId ? "focus" : "",
            n.id === selected ? "selected" : "",
            dim ? "dim" : "",
          ].join(" ");
          const label =
            n.kind === "variable" ? n.label : n.kind === "api_symbol" ? n.label.replace(/^.*#/, "") : n.label;
          return (
            <g
              key={n.id}
              className={cls}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(selected === n.id ? null : n.id)}
            >
              <rect x={p.x} y={p.y} width={p.w} height={BOX_H} rx={n.kind === "variable" ? 17 : 4} />
              <text x={p.x + 9} y={p.y + 14} className="cpg-node-label">
                {clip(label, Math.floor(p.w / 7.2))}
              </text>
              <text x={p.x + 9} y={p.y + 27} className="cpg-node-sub">
                {clip(n.kind === "api_symbol" ? `${n.module ?? "?"} · ${nodeSub(n)}` : nodeSub(n), Math.floor(p.w / 5.6))}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="cg-legend">
        <li><i className="sw k-function" /> function</li>
        <li><i className="sw k-variable" /> variable (typed)</li>
        <li><i className="sw k-call" /> call site (finder span)</li>
        <li><i className="sw k-dep" /> deprecated API</li>
        <li><i className="sw k-succ" /> successor API</li>
        <li className="muted">Hover to trace edges · click a node for its properties</li>
      </ul>
    </div>
  );
}

export function NodeProperties({ node, edges, nodes }: { node: CpgNode; edges: CpgEdge[]; nodes: CpgNode[] }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const props: Array<[string, string]> = [];
  const add = (k: string, v: unknown) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    props.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
  };
  add("id", node.id);
  add("kind", node.kind);
  add("file", node.fileName ? `${node.fileName}${node.line ? `:${node.line}` : ""}` : null);
  add("async", node.async);
  add("returnType", node.returnType);
  add("params", node.params);
  add("type", node.type);
  add("role", node.role);
  add("text", node.text);
  add("signature", node.signature);
  add("deprecatedReason", node.deprecatedReason);
  add("module", node.module);
  add("declFile", node.declFile);
  const incident = edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <div className="cpg-props">
      <dl>
        {props.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <code>{v}</code>
            </dd>
          </div>
        ))}
      </dl>
      {node.args?.length ? (
        <table className="cpg-args">
          <thead>
            <tr>
              <th>#</th>
              <th>argument</th>
              <th>type</th>
              <th>→ param</th>
            </tr>
          </thead>
          <tbody>
            {node.args.map((a) => (
              <tr key={a.index}>
                <td>{a.index}</td>
                <td><code>{a.text}</code></td>
                <td><code>{a.type}</code></td>
                <td><code>{a.param ? `${a.param}: ${a.paramType}` : "—"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {incident.length ? (
        <ul className="cpg-incident">
          {incident.map((e, i) => {
            const other = byId.get(e.from === node.id ? e.to : e.from);
            return (
              <li key={i}>
                <span className={`cpg-edge-chip ${e.kind}`}>{e.kind}</span>{" "}
                {e.from === node.id ? "→" : "←"} <code>{other?.label ?? e.to}</code>
                {e.label ? <span className="muted"> · {e.label}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
