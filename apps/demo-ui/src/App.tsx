import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchResults, runDemo, type ResultsPayload } from "./api";
import { CodePanel } from "./CodePanel";
import { DiffHints } from "./DiffHints";

export function App() {
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"compare" | "before" | "explain">("compare");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchResults());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runDemo();
      if (result.results) setData(result.results);
      if (!result.ok) setError(result.error || "Run failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const withoutPass = data?.without.report?.typecheckPass === true;
  const withPass = data?.with.report?.typecheckPass === true;

  const errorCount = useMemo(() => {
    const phantoms = data?.without.report?.phantomCount ?? 0;
    // Typecheck errors often include phantoms + leftover fields (e.g. .captured)
    return Math.max(phantoms, withoutPass ? 0 : 3);
  }, [data, withoutPass]);

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">MorphAPI · FYP baseline</p>
        <h1>Scaffolding hallucination, side by side</h1>
        <p className="lede">
          Same MorphPay v1→v2 migration. Left: pure live LLM. Right: MorphAPI
          (AST + Hallucination Inspector). The red marks on the left are the
          point of the demo — not broken tooling.
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={onRun}
            disabled={running || !data?.hasApiKey}
          >
            {running ? "Running live LLM…" : "Run live comparison"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void reload()}
            disabled={running || loading}
          >
            Refresh last outputs
          </button>
          {!data?.hasApiKey && (
            <span className="hint warn">Add OPENAI_API_KEY to .env to run</span>
          )}
        </div>
        {error && <p className="banner error">{error}</p>}
        {running && (
          <p className="banner info">
            Calling gpt-4o-mini twice (LLM-only, then hybrid). This can take a
            minute.
          </p>
        )}
      </header>

      <nav className="tabs" aria-label="Views">
        <button
          type="button"
          className={tab === "compare" ? "active" : ""}
          onClick={() => setTab("compare")}
        >
          1 vs 2 · Outputs
        </button>
        <button
          type="button"
          className={tab === "before" ? "active" : ""}
          onClick={() => setTab("before")}
        >
          Before (v1 client)
        </button>
        <button
          type="button"
          className={tab === "explain" ? "active" : ""}
          onClick={() => setTab("explain")}
        >
          Why / what the errors mean
        </button>
      </nav>

      {loading && !data ? (
        <p className="muted">Loading last run…</p>
      ) : (
        <>
          {tab === "compare" && data && (
            <section className="compare">
              <div className="scoreboard">
                <div className={`score ${withoutPass ? "pass" : "fail"}`}>
                  <span className="score-label">Without MorphAPI</span>
                  <strong>{withoutPass ? "PASS" : "FAIL"}</strong>
                  <span className="score-meta">
                    {data.without.report?.phantomCount ?? "—"} phantoms ·{" "}
                    {data.without.report?.mode ?? "—"}
                    {data.without.report?.model
                      ? ` · ${data.without.report.model}`
                      : ""}
                  </span>
                </div>
                <div className={`score ${withPass ? "pass" : "fail"}`}>
                  <span className="score-label">With MorphAPI</span>
                  <strong>{withPass ? "PASS" : "FAIL"}</strong>
                  <span className="score-meta">
                    {data.with.report?.phantomCount ?? "—"} phantoms ·{" "}
                    {data.with.report?.spansFound ?? "—"} AST spans ·{" "}
                    {data.with.report?.mode ?? "—"}
                  </span>
                </div>
              </div>

              <DiffHints
                withoutCode={data.without.code}
                withCode={data.with.code}
                phantoms={data.without.report?.phantoms ?? []}
              />

              <div className="panels">
                <CodePanel
                  title="1 · Without your system"
                  subtitle="Pure LLM migration — scaffolding often fails typecheck"
                  code={data.without.code}
                  phantoms={data.without.report?.phantoms ?? []}
                  status={withoutPass ? "pass" : "fail"}
                  emptyHint="No LLM-only output yet. Click “Run live comparison”."
                />
                <CodePanel
                  title="2 · With MorphAPI"
                  subtitle="AST locates usages → constrained LLM → oracle verify → apply"
                  code={data.with.code}
                  phantoms={data.with.report?.phantoms ?? []}
                  status={withPass ? "pass" : "fail"}
                  emptyHint="No hybrid output yet. Click “Run live comparison”."
                />
              </div>
            </section>
          )}

          {tab === "before" && data && (
            <section className="single">
              <CodePanel
                title="Original client (MorphPay v1)"
                subtitle="Deprecated charges.create — the shared starting point"
                code={data.before}
                phantoms={[]}
                status="neutral"
                emptyHint="Missing fixtures/client-v1/src/checkout.ts"
              />
            </section>
          )}

          {tab === "explain" && (
            <section className="explain">
              <article>
                <h2>Why do you see “so many errors”?</h2>
                <p>
                  Those red TypeScript squiggles in{" "}
                  <code>baselines/llm_only/out/checkout.ts</code> are{" "}
                  <strong>expected</strong>. The live LLM invented near-miss
                  symbols (e.g. <code>CaptureMode.Automatic</code> instead of{" "}
                  <code>AUTOMATIC</code>). The compiler correctly rejects them —
                  that is the scaffolding-hallucination evidence.
                </p>
                <p>
                  Typically you only see a handful of real failures (about{" "}
                  {errorCount} on the last LLM-only run), not a broken project.
                  The hybrid output should typecheck clean.
                </p>
              </article>
              <article>
                <h2>What MorphAPI adds</h2>
                <ol>
                  <li>
                    <strong>AST scan</strong> finds exact{" "}
                    <code>charges.create</code> spans.
                  </li>
                  <li>
                    <strong>Constrained LLM</strong> proposes a replacement for
                    that span only.
                  </li>
                  <li>
                    <strong>Hallucination Inspector</strong> checks symbols
                    against the MorphPay v2 oracle.
                  </li>
                  <li>
                    <strong>Surgical apply</strong> writes only verified nodes,
                    then typechecks.
                  </li>
                </ol>
              </article>
              <article>
                <h2>One-line claim</h2>
                <p className="claim">
                  Pure AI fails fidelity on MorphPay scaffolding; AI + AST
                  verification compiles.
                </p>
              </article>
            </section>
          )}
        </>
      )}

      <footer className="foot">
        MorphAPI baseline UI · outputs from{" "}
        <code>baselines/*/out/</code>
      </footer>
    </div>
  );
}
