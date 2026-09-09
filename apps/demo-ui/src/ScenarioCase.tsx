import type { LiveScenarioId, ScenarioCase } from "./scenarios/catalog";

export function ScenarioCaseView({
  scenario,
  onOpenLive,
}: {
  scenario: ScenarioCase;
  onOpenLive?: (liveId: LiveScenarioId) => void;
}) {
  const isLive = scenario.demoStatus === "live";

  return (
    <section className="scenario-case docs-briefing">
      <header className="scenario-case-header">
        <div>
          <p className="eyebrow">
            Scenario {scenario.number} · {scenario.categoryLabel}
          </p>
          <h2>{scenario.title}</h2>
          <p className="lede">{scenario.summary}</p>
        </div>
        <span className={`badge ${isLive ? "live" : "taxonomy"}`}>
          {isLive ? "Live baseline" : "Taxonomy (not run yet)"}
        </span>
      </header>

      <article>
        <h3>Provider</h3>
        <p>{scenario.provider}</p>
      </article>

      <article>
        <h3>Upstream contract delta</h3>
        <p>{scenario.contractDelta}</p>
      </article>

      <div className="fail-grid">
        <article>
          <h3>Why AI alone fails</h3>
          <p>{scenario.aiAloneFails}</p>
        </article>
        <article>
          <h3>Why AST alone fails</h3>
          <p>{scenario.astAloneFails}</p>
        </article>
        <article>
          <h3>How hybrid wins</h3>
          <p>{scenario.hybridWins}</p>
        </article>
      </div>

      <article>
        <h3>Old vs new (read side-by-side)</h3>
        {!isLive && (
          <p className="doc-note">
            Illustrative snippets for teaching — not a live MorphAPI run in this
            repo.
          </p>
        )}
        <div className="docs-grid">
          <div>
            <h4>Before (legacy)</h4>
            <pre className="doc-md">
              <code>{scenario.beforeSnippet}</code>
            </pre>
          </div>
          <div>
            <h4>After (correct target)</h4>
            <pre className="doc-md">
              <code>{scenario.afterSnippet}</code>
            </pre>
          </div>
        </div>
        {scenario.phantomExample && (
          <p>
            <strong>Phantom / trap:</strong>{" "}
            <code>{scenario.phantomExample}</code>
          </p>
        )}
      </article>

      {scenario.liveEvidence && (
        <article className="live-evidence">
          <h3>Live evidence from this repo</h3>
          <p>
            Model <code>{scenario.liveEvidence.model}</code> · LLM-only
            typecheck{" "}
            <strong className="fail-text">
              {scenario.liveEvidence.typecheck}
            </strong>
          </p>
          <ul className="live-phantoms">
            {scenario.liveEvidence.phantoms.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
          <p className="muted">
            Report: <code>{scenario.liveEvidence.reportPath}</code>
          </p>
          {isLive && scenario.liveId && onOpenLive && (
            <button
              type="button"
              className="btn primary"
              onClick={() => onOpenLive(scenario.liveId!)}
            >
              Open live demo · {scenario.liveId}
            </button>
          )}
        </article>
      )}

      <article>
        <h3>What MorphAPI would need</h3>
        <ul>
          {scenario.morphapiNeeds.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </article>

      <article>
        <h3>References</h3>
        <ul className="ref-list">
          {scenario.references.map((r) => (
            <li key={r.href + r.label}>
              {r.href.startsWith("http") ? (
                <a href={r.href} target="_blank" rel="noreferrer">
                  {r.label}
                </a>
              ) : (
                <code>{r.href.replace(/^\//, "")}</code>
              )}
              {r.note ? <span className="muted"> — {r.note}</span> : null}
              {!r.href.startsWith("http") ? (
                <span className="muted"> ({r.label})</span>
              ) : null}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
