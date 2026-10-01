import { useEffect, useMemo, useState } from "react";
import {
  AstTreeDiagram,
  CpgDiagram,
  DEFAULT_EDGE_GROUPS,
  DfgDiagram,
  EDGE_GROUPS,
  HighlightedCode,
  NodeProperties,
  type EdgeGroup,
} from "./GraphDiagrams";
import { fetchGraph, type GraphPayload } from "./graphApi";
import { PipelineRun } from "./PipelineRun";

const SCENARIO_LABELS: Record<string, string> = {
  mail: "Multi-site mail (7) — recommended",
  morphpay: "MorphPay Builder (1a)",
  plaid: "Plaid Link (1b)",
  openai: "OpenAI engine (2)",
  stripe: "Unit shift (3)",
  auth: "Evasion (4)",
  envelope: "Envelope / DFG (5)",
  async: "Async contagion (6)",
  "stripe-errors": "Error hierarchy (8)",
  discriminator: "Discriminator (9)",
  hmac: "HMAC auth (10)",
};

function Card({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="cg-card">
      <header>
        <span className="cg-card-n">{n}</span>
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function TokenBars({ tokens }: { tokens: GraphPayload["tokens"] }) {
  const max = Math.max(tokens.file, tokens.slice + tokens.facts, 1);
  const rows: Array<[string, number, string]> = [
    ["Whole file (LLM-only prompt)", tokens.file, "file"],
    ["Slice (the call itself)", tokens.slice, "slice"],
    ["Slice facts JSON", tokens.facts, "facts"],
  ];
  return (
    <div className="cg-tokens">
      {rows.map(([label, n, cls]) => (
        <div className="cg-token-row" key={cls}>
          <span>{label}</span>
          <div className="cg-token-bar">
            <i className={cls} style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <strong>{n}</strong>
        </div>
      ))}
      <p className="cg-note">
        Counts are identifier/number/punctuation tokens. The facts JSON carries keys and quotes, so on these small
        fixtures it can be longer than the file; its size depends on the call site (arguments, callers), not on how
        large the surrounding file is. What it adds is information the raw file does not state: resolved types,
        signatures, the v2 successor and who consumes the result.
      </p>
    </div>
  );
}

export function CodeGraph({ scenario, onScenario }: { scenario: string; onScenario: (id: string) => void }) {
  const [focusKey, setFocusKey] = useState<string>("");
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoverDfg, setHoverDfg] = useState<string | null>(null);
  const [groups, setGroups] = useState<Record<EdgeGroup, boolean>>(DEFAULT_EDGE_GROUPS);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setFocusKey("");
  }, [scenario]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const [file, start] = focusKey ? focusKey.split("@") : [];
    fetchGraph(scenario, file ? { file, start: Number(start) } : null)
      .then((g) => {
        if (!live) return;
        setData(g);
        setSelected(g.focus?.callSiteId ?? null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [scenario, focusKey]);

  const files = useMemo(() => data?.files.map((f) => f.name) ?? [], [data]);
  const selectedNode = data?.nodes.find((n) => n.id === selected) ?? null;
  const facts = data?.sliceFacts ?? null;
  const focus = data?.focus ?? null;
  const currentKey = focus ? `${focus.fileName}@${focus.callSiteId.split(":").pop()}` : "";
  const focusSpan = data?.spans.find((s) => `${s.fileName}@${s.start}` === (focusKey || currentKey)) ?? null;

  return (
    <div className="cg">
      <header className="wb-hero">
        <div>
          <p className="eyebrow">Code Property Graph · TypeScript program + TypeChecker</p>
          <h1>How MorphAPI sees the code before it asks the LLM</h1>
          <p className="lede wb-lede">
            The fixture is loaded as a real <code>ts.Program</code> from its <code>tsconfig.json</code>. The AST finder
            marks each call to migrate; the TypeChecker then decorates the tree with resolved types, data flow,
            function calls and the v1 → v2 API mapping. The migration prompt receives the <em>slice facts</em> from
            card 4, not the whole file, and card 6 shows the full run: gate attempts, impact repairs and the diff. No
            neural model is involved in building the graph.
          </p>
        </div>
        <div className="wb-actions">
          <label className="cg-select">
            <span className="eyebrow">Scenario</span>
            <select value={scenario} onChange={(e) => onScenario(e.target.value)} disabled={loading}>
              {Object.entries(SCENARIO_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="cg-select">
            <span className="eyebrow">Call site</span>
            <select
              value={focusKey || currentKey}
              onChange={(e) => setFocusKey(e.target.value)}
              disabled={loading || !data?.spans.length}
            >
              {(data?.spans ?? []).map((s) => (
                <option key={`${s.fileName}@${s.start}`} value={`${s.fileName}@${s.start}`}>
                  {s.fileName}:{s.startLine} · {s.kind}
                </option>
              ))}
            </select>
          </label>
          {data ? (
            <div className="locality-chip" title="Where the tsconfig came from">
              <span className="eyebrow">Program</span>
              <strong>{data.tsconfig}</strong>
              <span className="muted">
                {data.projectSource === "meta" ? "from scenario meta" : "found by directory walk"}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {error ? <p className="banner fail-banner">{error}</p> : null}
      {loading && !data ? <p className="banner info">Building the program and graph…</p> : null}

      {data ? (
        <div className={`cg-grid ${loading ? "loading" : ""}`}>
          <Card
            n={1}
            title="Source + syntax tree"
            sub={
              focus
                ? `${focus.fileName}:${focus.codeStartLine} — highlighted span is what the AST finder matched; tree is the enclosing function`
                : "No finder span in this scenario"
            }
          >
            {focus ? (
              <div className="cg-two">
                <HighlightedCode
                  code={focus.code}
                  startLine={focus.codeStartLine}
                  span={focus.span}
                  nodes={focus.dfg.nodes}
                  hoverDfg={hoverDfg}
                  onHover={setHoverDfg}
                />
                {focus.ast ? (
                  <AstTreeDiagram outline={focus.ast} hoverDfg={hoverDfg} onHover={setHoverDfg} />
                ) : null}
              </div>
            ) : (
              <p className="muted">Nothing to show.</p>
            )}
          </Card>

          <Card
            n={2}
            title="Typed data-flow graph"
            sub="Every variable occurrence in the function; edges say where each value comes from. Hover to link with the code and tree."
          >
            {focus ? (
              <DfgDiagram nodes={focus.dfg.nodes} edges={focus.dfg.edges} hoverDfg={hoverDfg} onHover={setHoverDfg} />
            ) : null}
          </Card>

          <Card
            n={3}
            title="Code Property Graph"
            sub="One lane per file. Functions, typed variables and finder call sites, linked to the API symbols the TypeChecker resolved them to."
          >
            <div className="cg-toggles" role="group" aria-label="Edge types">
              {EDGE_GROUPS.map((g) => (
                <label key={g.id} className={`cg-toggle ${g.id} ${groups[g.id] ? "on" : ""}`} title={g.hint}>
                  <input
                    type="checkbox"
                    checked={groups[g.id]}
                    onChange={(e) => setGroups((s) => ({ ...s, [g.id]: e.target.checked }))}
                  />
                  {g.label}
                  <small>{g.hint}</small>
                </label>
              ))}
            </div>
            <div className="cg-cpg-wrap">
              <CpgDiagram
                nodes={data.nodes}
                edges={data.edges}
                files={files}
                enabled={groups}
                focusId={focus?.callSiteId ?? null}
                selected={selected}
                onSelect={setSelected}
              />
              <aside className="cg-props-panel">
                <h3>Node properties</h3>
                {selectedNode ? (
                  <NodeProperties node={selectedNode} edges={data.edges} nodes={data.nodes} />
                ) : (
                  <p className="muted">Click a node in the graph.</p>
                )}
              </aside>
            </div>
          </Card>

          <Card
            n={4}
            title="Slice facts — what the LLM receives"
            sub="Read off the graph for the selected call site. This JSON replaces the whole file in the hybrid prompt."
          >
            {facts ? (
              <div className="cg-two facts">
                <pre className="cg-json">{JSON.stringify(facts, null, 2)}</pre>
                <TokenBars tokens={data.tokens} />
              </div>
            ) : (
              <p className="muted">No call site selected.</p>
            )}
          </Card>

          <Card
            n={5}
            title="1-hop impact + graph health"
            sub="Who else must change if this call changes shape, and whether the TypeChecker actually resolved everything."
          >
            <div className="cg-two">
              <div>
                <h3>Callers (1 hop)</h3>
                {facts?.callers_1hop.length ? (
                  <ul className="cg-list">
                    {facts.callers_1hop.map((c) => (
                      <li key={c}>
                        <code>{c}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No callers inside the fixture.</p>
                )}
                <h3>Result consumers</h3>
                {facts?.result.downstream_usages.length ? (
                  <ul className="cg-list">
                    {facts.result.downstream_usages.map((u) => (
                      <li key={u}>
                        <code>{u}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">The call's result is not used.</p>
                )}
                {facts?.result.type ? (
                  <p className="cg-note">
                    Result type today: <code>{facts.result.type}</code>
                    {facts.result.binding ? (
                      <>
                        {" "}
                        bound to <code>{facts.result.binding}</code>
                      </>
                    ) : null}
                    . If v2 changes this type, these sites break.
                  </p>
                ) : null}
              </div>
              <div>
                <h3>Graph health</h3>
                <div className="cg-health">
                  <div className={data.health.anyCollapseRate === 0 ? "good" : "warn"}>
                    <strong>{(data.health.anyCollapseRate * 100).toFixed(1)}%</strong>
                    <span>implicit any / unresolved ({data.health.collapsed.length} of {data.health.checked})</span>
                  </div>
                  <div className={data.health.missingFiles.length ? "warn" : "good"}>
                    <strong>{data.health.missingFiles.length}</strong>
                    <span>fixture files missing from program</span>
                  </div>
                  <div className={data.health.configErrors.length ? "warn" : "good"}>
                    <strong>{data.health.configErrors.length}</strong>
                    <span>tsconfig errors</span>
                  </div>
                </div>
                {data.health.explicitAny.length ? (
                  <p className="cg-note">
                    Explicit <code>any</code> written in the source (not a resolution failure):{" "}
                    {data.health.explicitAny.map((x) => (
                      <code key={x}>{x} </code>
                    ))}
                  </p>
                ) : null}
                {data.health.collapsed.length ? (
                  <p className="cg-note honest">Collapsed: {data.health.collapsed.join(", ")}</p>
                ) : null}
                <p className="cg-note">
                  {data.nodes.length} nodes · {data.edges.length} edges · finders: {data.spanFinders.join(", ")}
                </p>
              </div>
            </div>
          </Card>

          <Card
            n={6}
            title="Migration pipeline — slice → LLM → gate → imports → impact"
            sub="The same program drives the migration: each call site's slice and facts go to the model, the TypeChecker gates every proposal (phantoms are rejected with valid options), then 1-hop impact finds and repairs what broke elsewhere."
          >
            <PipelineRun scenario={scenario} focus={focusSpan ? { fileName: focusSpan.fileName, line: focusSpan.startLine } : null} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
