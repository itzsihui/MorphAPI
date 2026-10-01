import { useCallback, useEffect, useState } from "react";
import { CascadeTimeline } from "./CascadeTimeline";

export type EvalMetric = {
  id: string;
  name: string;
  from: string;
  description: string;
};

export type PriorArtMetric = {
  id: string;
  name: string;
  pureAst: string;
  pureLlm: string;
  hybrid: string;
  description: string;
};

export type EvalSide = {
  measured: boolean;
  successGate: boolean | null;
  successReason?: string;
  successLabel?: string;
  why?: string;
  setupEffort: string;
  phantomCount?: number;
  phantoms?: string[];
  hallucination: string;
  diffLocality: string;
  semantic: { score: string; detail: string } | string;
  note?: string;
  model?: string | null;
  spansFound?: number | null;
  spans?: unknown;
  repair?: {
    issueCount: number;
    issuesPassed: number;
    issuesFailed: number;
    cascadeEdges: number;
    allIssuesPass: boolean;
    aggregatorMean: number | null;
    narrative: string;
    issues?: Array<{
      id: string;
      kind: string;
      discoveredAt: string;
      causedByIssueId?: string | null;
      symptom: string;
    }>;
    issueEvals?: Array<{
      issueId: string;
      pass: boolean;
      scores: Record<string, number | null>;
      rationale: string;
    }>;
    steps?: Array<{
      step: number;
      issueId: string;
      action: string;
      source?: string;
      newlyDiscoveredIssueIds?: string[];
      notes?: string;
    }>;
  } | null;
};

export type MetricCell = {
  score: string;
  detail: string;
};

export type MetricWalkthroughRow = {
  id: string;
  name: string;
  from: string;
  pureAst: MetricCell;
  pureLlm: MetricCell;
  hybrid: MetricCell;
};

export type EvalScenario = {
  id: string;
  number: string;
  title: string;
  liveId: string;
  gate: string;
  gateExplainer?: string;
  challenge?: string;
  caveat: string | null;
  pureAst: EvalSide & { successLabel: string };
  pureLlm: EvalSide;
  hybrid: EvalSide;
  metricWalkthrough?: MetricWalkthroughRow[];
  morphapiWins: boolean | "tie_or_soft";
  verdict?: string;
};

export type EvalMatrix = {
  generatedAt: string;
  priorArtNote: string;
  priorArtMetrics?: PriorArtMetric[];
  metrics: EvalMetric[];
  summary: {
    scenarioCount: number;
    measuredPairs: number;
    llmSuccessGatePass: number;
    hybridSuccessGatePass: number;
    morphapiStrictWins: number;
    llmPassRate: number | null;
    hybridPassRate: number | null;
  };
  scenarios: EvalScenario[];
};

function gateLabel(pass: boolean | null | undefined, estimated?: boolean) {
  if (pass === null || pass === undefined) return estimated ? "est." : "—";
  if (pass) return estimated ? "PASS*" : "PASS";
  return estimated ? "FAIL*" : "FAIL";
}

function winLabel(w: EvalScenario["morphapiWins"]) {
  if (w === true) return "Strict win";
  if (w === "tie_or_soft") return "Soft / tie";
  return "No win";
}

function pillClass(pass: boolean | null | undefined, estimated?: boolean) {
  if (pass === null || pass === undefined) return estimated ? "est" : "est";
  if (pass) return "pass";
  return "fail";
}

function ApproachCard({
  label,
  pass,
  estimated,
  why,
  meta,
}: {
  label: string;
  pass: boolean | null | undefined;
  estimated?: boolean;
  why: string;
  meta?: string;
}) {
  return (
    <div className={`eval-approach ${pillClass(pass, estimated)}`}>
      <header>
        <h3>{label}</h3>
        <span className={`eval-pill ${pillClass(pass, estimated)}`}>
          {gateLabel(pass, estimated)}
        </span>
      </header>
      {meta ? <p className="eval-approach-meta">{meta}</p> : null}
      <p className="eval-approach-why">{why}</p>
    </div>
  );
}

export function Evaluation() {
  const [data, setData] = useState<EvalMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/eval");
      const text = await res.text();
      const looksHtml = /^\s*</.test(text);
      if (looksHtml) {
        throw new Error(
          "Evaluation API returned HTML instead of JSON. Restart the demo UI (`npm run demo:ui`) so /api/eval is registered."
        );
      }
      let payload: EvalMatrix & { error?: string };
      try {
        payload = JSON.parse(text) as EvalMatrix & { error?: string };
      } catch {
        throw new Error("Evaluation API returned invalid JSON.");
      }
      if (!res.ok || payload.error) {
        throw new Error(
          payload.error || `Failed to load eval matrix (${res.status})`
        );
      }
      setData(payload);
      if (!openId && payload.scenarios[0]) {
        setOpenId(payload.scenarios[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [openId]);

  useEffect(() => {
    void reload();
    // intentionally once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <section className="evaluation">
        <p className="lede">Loading evaluation matrix…</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="evaluation">
        <p className="lede error-text">{error}</p>
        <button type="button" className="btn ghost" onClick={() => void reload()}>
          Retry
        </button>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="evaluation">
      <header className="evaluation-hero">
        <p className="eyebrow">Evaluation · with vs without MorphAPI</p>
        <h1>Why each scenario passes or fails</h1>
        <p className="lede">
          Below: literature metrics (prior art), how MorphAPI scores them on this
          FYP, then a written verdict for every scenario — Pure AST (estimated),
          Pure LLM (measured), and Hybrid (measured). Snapshot{" "}
          <time dateTime={data.generatedAt}>
            {new Date(data.generatedAt).toLocaleString()}
          </time>
          . Single live run per scenario (n≈1) — not a multi-seed automation %.
        </p>
        <div className="evaluation-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void reload()}
            disabled={loading}
          >
            Refresh matrix
          </button>
        </div>
      </header>

      <div className="evaluation-stats" role="group" aria-label="Summary">
        <div>
          <p className="eyebrow">Pure LLM gate</p>
          <p className="evaluation-stat">
            {data.summary.llmSuccessGatePass}/{data.summary.measuredPairs}
            <span> ({data.summary.llmPassRate}%)</span>
          </p>
        </div>
        <div>
          <p className="eyebrow">Hybrid gate</p>
          <p className="evaluation-stat">
            {data.summary.hybridSuccessGatePass}/{data.summary.measuredPairs}
            <span> ({data.summary.hybridPassRate}%)</span>
          </p>
        </div>
        <div>
          <p className="eyebrow">MorphAPI wins</p>
          <p className="evaluation-stat">
            {data.summary.morphapiStrictWins}
            <span> LLM fail → Hybrid pass</span>
          </p>
        </div>
      </div>

      <article className="evaluation-block">
        <h2>Prior-art metric frame</h2>
        <p className="lede tight">{data.priorArtNote}</p>
        {data.priorArtMetrics && data.priorArtMetrics.length > 0 ? (
          <div className="diff-table-wrap evaluation-matrix-wrap">
            <table className="diff-table evaluation-matrix eval-prior-art">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Pure AST / LST</th>
                  <th>Pure LLM</th>
                  <th>Hybrid</th>
                  <th>What it measures</th>
                </tr>
              </thead>
              <tbody>
                {data.priorArtMetrics.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td>{m.pureAst}</td>
                    <td>{m.pureLlm}</td>
                    <td>{m.hybrid}</td>
                    <td>{m.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="lede tight eval-note">
          Formatting note: in Python, whitespace is semantic. In TypeScript we
          still care about <em>diff aesthetics / locality</em> so other
          developers can review changes — Hybrid span apply scores better than
          whole-file LLM rewrites even when whitespace is not load-bearing.
        </p>
      </article>

      <article className="evaluation-block">
        <h2>How this FYP scores the same ideas</h2>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Adapted metric</th>
                <th>From</th>
                <th>How we score on MorphAPI</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.from}</td>
                  <td>{m.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="evaluation-block">
        <h2>At-a-glance matrix</h2>
        <div className="diff-table-wrap evaluation-matrix-wrap">
          <table className="diff-table evaluation-matrix">
            <thead>
              <tr>
                <th>#</th>
                <th>Scenario</th>
                <th>Pure AST*</th>
                <th>Pure LLM</th>
                <th>Hybrid</th>
                <th>Win</th>
              </tr>
            </thead>
            <tbody>
              {data.scenarios.map((s) => (
                <tr key={s.id}>
                  <td>{s.number}</td>
                  <td>
                    <button
                      type="button"
                      className="eval-jump"
                      onClick={() => setOpenId(s.id)}
                    >
                      {s.title}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`eval-pill ${pillClass(s.pureAst.successGate, true)}`}
                    >
                      {gateLabel(s.pureAst.successGate, true)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`eval-pill ${pillClass(s.pureLlm.successGate)}`}
                    >
                      {gateLabel(s.pureLlm.successGate)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`eval-pill ${pillClass(s.hybrid.successGate)}`}
                    >
                      {gateLabel(s.hybrid.successGate)}
                    </span>
                  </td>
                  <td>{winLabel(s.morphapiWins)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lede tight">
          * Pure AST is estimated only — this repo does not execute jscodeshift /
          OpenRewrite baselines.
        </p>
      </article>

      <article className="evaluation-block">
        <h2>Per-scenario explanations</h2>
        <p className="lede tight">
          Open any scenario for the full why behind PASS / FAIL. Reasons are
          generated from the latest <code>report.json</code> gates plus the
          scenario’s intended failure mode.
        </p>

        <div className="eval-scenario-list">
          {data.scenarios.map((s) => {
            const open = openId === s.id;
            return (
              <details
                key={s.id}
                className="eval-scenario"
                open={open}
                onToggle={(e) => {
                  if ((e.target as HTMLDetailsElement).open) setOpenId(s.id);
                }}
              >
                <summary>
                  <span className="eval-scenario-num">{s.number}</span>
                  <span className="eval-scenario-title">{s.title}</span>
                  <span className="eval-scenario-pills">
                    <span
                      className={`eval-pill ${pillClass(s.pureLlm.successGate)}`}
                    >
                      LLM {gateLabel(s.pureLlm.successGate)}
                    </span>
                    <span
                      className={`eval-pill ${pillClass(s.hybrid.successGate)}`}
                    >
                      Hybrid {gateLabel(s.hybrid.successGate)}
                    </span>
                    <span className="eval-win-chip">{winLabel(s.morphapiWins)}</span>
                  </span>
                </summary>

                <div className="eval-scenario-body">
                  <p className="eval-challenge">
                    <strong>What this tests.</strong> {s.challenge}
                  </p>
                  <p className="eval-gate">
                    <strong>Success gate</strong> (<code>{s.gate}</code>):{" "}
                    {s.gateExplainer}
                  </p>
                  {s.caveat ? (
                    <p className="eval-caveat">
                      <strong>Caveat.</strong> {s.caveat}
                    </p>
                  ) : null}

                  <div className="eval-approach-grid">
                    <ApproachCard
                      label="Pure AST / LST"
                      pass={s.pureAst.successGate}
                      estimated={!s.pureAst.measured}
                      meta={`Setup ${s.pureAst.setupEffort} · Hallucination ${s.pureAst.hallucination} · Diff ${s.pureAst.diffLocality} · Semantic ${typeof s.pureAst.semantic === "string" ? s.pureAst.semantic : s.pureAst.semantic.score}${s.pureAst.measured ? " · measured pilot" : ""}`}
                      why={s.pureAst.why ?? s.pureAst.successLabel}
                    />
                    <ApproachCard
                      label="Pure LLM"
                      pass={s.pureLlm.successGate}
                      meta={`Setup ${s.pureLlm.setupEffort} · Hallucination ${s.pureLlm.hallucination} · Diff ${s.pureLlm.diffLocality} · Phantoms ${s.pureLlm.phantomCount ?? 0}${s.pureLlm.model ? ` · ${s.pureLlm.model}` : ""}`}
                      why={s.pureLlm.why ?? s.pureLlm.successReason ?? ""}
                    />
                    <ApproachCard
                      label="Hybrid (MorphAPI)"
                      pass={s.hybrid.successGate}
                      meta={`Setup ${s.hybrid.setupEffort} · Hallucination ${s.hybrid.hallucination} · Diff ${s.hybrid.diffLocality} · Phantoms ${s.hybrid.phantomCount ?? 0}${s.hybrid.spansFound != null ? ` · ${s.hybrid.spansFound} spans` : ""}`}
                      why={s.hybrid.why ?? s.hybrid.successReason ?? ""}
                    />
                  </div>

                  {(s.pureLlm.repair || s.hybrid.repair || s.pureAst.repair) && (
                    <div className="eval-repair-block">
                      <h4>Per-issue cascade reports</h4>
                      <p className="lede tight">
                        Primary evidence is per-issue rubrics. Aggregator mean is
                        secondary. Cascade edges = issues discovered after a fix.
                      </p>
                      <div className="cascade-pair">
                        <CascadeTimeline
                          title="Pure AST"
                          repair={s.pureAst.repair}
                        />
                        <CascadeTimeline
                          title="Pure LLM"
                          repair={s.pureLlm.repair}
                        />
                        <CascadeTimeline
                          title="Hybrid"
                          repair={s.hybrid.repair}
                        />
                      </div>
                    </div>
                  )}

                  {s.metricWalkthrough && s.metricWalkthrough.length > 0 ? (
                    <div className="eval-metric-walk">
                      <h4>Metric-by-metric walkthrough</h4>
                      <p className="lede tight">
                        Each row is one adapted FYP metric (mapped from the
                        prior-art frame). Cells explain Pure AST (estimated),
                        Pure LLM (measured), and Hybrid (measured) for this
                        scenario.
                      </p>
                      <div className="diff-table-wrap evaluation-matrix-wrap">
                        <table className="diff-table evaluation-matrix eval-walk-table">
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th>Pure AST / LST*</th>
                              <th>Pure LLM</th>
                              <th>Hybrid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.metricWalkthrough.map((m) => (
                              <tr key={m.id}>
                                <td>
                                  <strong>{m.name}</strong>
                                  <span className="eval-metric-from">
                                    from {m.from}
                                  </span>
                                </td>
                                <td>
                                  <span className="eval-walk-score">
                                    {m.pureAst.score}
                                  </span>
                                  <span className="eval-walk-detail">
                                    {m.pureAst.detail}
                                  </span>
                                </td>
                                <td>
                                  <span className="eval-walk-score">
                                    {m.pureLlm.score}
                                  </span>
                                  <span className="eval-walk-detail">
                                    {m.pureLlm.detail}
                                  </span>
                                </td>
                                <td>
                                  <span className="eval-walk-score">
                                    {m.hybrid.score}
                                  </span>
                                  <span className="eval-walk-detail">
                                    {m.hybrid.detail}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {s.pureLlm.phantoms && s.pureLlm.phantoms.length > 0 ? (
                    <p className="eval-phantoms-line">
                      <strong>LLM phantoms:</strong>{" "}
                      <code>{s.pureLlm.phantoms.join(", ")}</code>
                    </p>
                  ) : null}

                  <p className="eval-verdict">
                    <strong>Verdict.</strong> {s.verdict}
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      </article>
    </section>
  );
}
