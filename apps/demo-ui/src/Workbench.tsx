import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchOracle,
  fetchResults,
  fetchSpans,
  runDemoStream,
  type OraclePayload,
  type PipelineEvent,
  type Report,
  type ResultsPayload,
  type Scenario,
  type SpansPayload,
} from "./api";
import { AstSpanPanel } from "./AstSpanPanel";
import {
  CascadeTimeline,
  toRepairSummary,
} from "./CascadeTimeline";
import { CodePanel } from "./CodePanel";
import { DiffModal } from "./DiffModal";
import { OracleTree } from "./OracleTree";
import { TelemetryStream } from "./TelemetryStream";

function gateChips(report: Report | null | undefined, fields: string[]) {
  if (!report) return [];
  const chips: Array<{ label: string; ok: boolean | null }> = [];
  for (const f of fields) {
    const v = (report as Record<string, unknown>)[f];
    if (v === undefined) continue;
    if (typeof v === "boolean") {
      chips.push({
        label: `${f}=${v ? "PASS" : "FAIL"}`,
        ok: v,
      });
    } else {
      chips.push({ label: `${f}=${String(v)}`, ok: null });
    }
  }
  return chips;
}

function reportStatus(
  report: Report | null | undefined
): "pass" | "fail" | "neutral" {
  if (!report) return "neutral";
  if (report.typecheckPass === false) return "fail";
  if ((report.phantomCount ?? 0) > 0) return "fail";
  if (report.behavioralPass === false) return "fail";
  if (report.completenessPass === false) return "fail";
  if (report.securityPass === false) return "fail";
  if (report.typecheckPass === true) return "pass";
  return "neutral";
}

export function Workbench({ scenario }: { scenario: Scenario }) {
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [oracle, setOracle] = useState<OraclePayload | null>(null);
  const [spans, setSpans] = useState<SpansPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [oracleError, setOracleError] = useState<string | null>(null);
  const [spansError, setSpansError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [spanIdx, setSpanIdx] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);

  const refreshStatic = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setOracleError(null);
    setSpansError(null);
    try {
      const [results, ora, sp] = await Promise.all([
        fetchResults(scenario),
        fetchOracle(scenario).catch((e) => {
          setOracleError(e instanceof Error ? e.message : String(e));
          return null;
        }),
        fetchSpans(scenario).catch((e) => {
          setSpansError(e instanceof Error ? e.message : String(e));
          return null;
        }),
      ]);
      setData(results);
      setOracle(ora);
      setSpans(sp);
      if (sp?.files?.[0]) setActiveFile(sp.files[0].name);
      setSpanIdx(0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scenario]);

  useEffect(() => {
    void refreshStatic();
    setEvents([]);
    setRunError(null);
  }, [refreshStatic]);

  const onRun = async () => {
    setRunning(true);
    setRunError(null);
    setEvents([]);
    try {
      const result = await runDemoStream(scenario, (evt) => {
        setEvents((prev) => [...prev, evt]);
      });
      if (!result.ok) {
        setRunError(result.error || "Run failed");
      }
      if (result.results) setData(result.results);
      const sp = await fetchSpans(scenario).catch(() => null);
      if (sp) setSpans(sp);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const without = data?.without;
  const astSide = data?.ast;
  const withSide = data?.with;
  const gateFields = oracle?.gateFields ?? [
    "typecheckPass",
    "phantomCount",
    "spansFound",
  ];

  const liveAst = Boolean(astSide?.code || astSide?.report);
  const hybridRepair = toRepairSummary(withSide?.report?.repairReport ?? null);
  const astRepair = toRepairSummary(astSide?.report?.repairReport ?? null);
  const llmRepair = toRepairSummary(without?.report?.repairReport ?? null);

  const locality = useMemo(() => {
    const n = withSide?.report?.spansFound ?? spans?.spanCount ?? 0;
    const files = spans?.files.length ?? 1;
    return {
      spans: n,
      files,
      label:
        n <= 2
          ? "Low (surgical)"
          : n <= 5
            ? "Moderate"
            : "Higher multi-site",
    };
  }, [withSide, spans]);

  const impactChip = useMemo(() => {
    const hy = withSide?.report?.repairReport?.summary;
    const ast = astSide?.report?.repairReport?.summary;
    if (!hy && !ast) return null;
    const discovered =
      hy?.fixesDiscoveredAfterPrimary ??
      ast?.fixesDiscoveredAfterPrimary ??
      0;
    return {
      discovered,
      completed: hy?.fixesCompletedAfterPrimary ?? 0,
      remainingAst: ast?.fixesRemainingAfterPrimary ?? 0,
    };
  }, [withSide, astSide]);

  const estimatedBody = oracle?.astAloneReason
    ? `// AST-alone (estimated — no executable Pure AST baseline for this scenario)\n//\n// ${oracle.astAloneReason}\n//\n// Pure AST cannot invent oracle-bound symbols or paradigm shifts.\n// MorphAPI couples AST spans + constrained LLM + inspector instead.\n`
    : null;

  return (
    <div className="workbench">
      <header className="wb-hero">
        <div>
          <p className="eyebrow">MorphAPI Workbench · live proof</p>
          <h1>AST finds · Oracle verifies · LLM proposes</h1>
          <p className="lede wb-lede">
            Visible pipeline for <code>{scenario}</code> — deterministic oracle
            artifact, TypeScript AST spans, AI-alone phantoms, hybrid surgical
            apply. Not a black-box terminal claim.
          </p>
        </div>
        <div className="wb-actions">
          <button
            type="button"
            className="btn primary"
            disabled={running || !data?.hasApiKey}
            onClick={() => void onRun()}
          >
            {running ? "Running pipeline…" : "Run live comparison"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!withSide?.code}
            onClick={() => setDiffOpen(true)}
          >
            Inspect git diff
          </button>
          <a className="btn" href={`#graph/${scenario}`}>
            Code graph →
          </a>
          <div className="locality-chip" title="Surgical locality from span count">
            <span className="eyebrow">Locality</span>
            <strong>
              {locality.spans} span(s) · {locality.files} file(s)
            </strong>
            <span className="muted">{locality.label}</span>
          </div>
          {impactChip ? (
            <div
              className="locality-chip impact-chip"
              title="1° impact after primary fix"
            >
              <span className="eyebrow">Impact after primary</span>
              <strong>+{impactChip.discovered} issue(s)</strong>
              <span className="muted">
                Hybrid done {impactChip.completed} · AST remaining{" "}
                {impactChip.remainingAst}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {!data?.hasApiKey && (
        <p className="banner warn">
          Set <code>OPENAI_API_KEY</code> in <code>.env</code> to run live
          baselines.
        </p>
      )}
      {runError && <p className="banner fail-banner">{runError}</p>}
      {loadError && <p className="banner fail-banner">{loadError}</p>}
      {loading && <p className="muted">Loading workbench artifacts…</p>}

      <div className="wb-grid">
        <section className="wb-pane oracle-pane">
          <header className="wb-pane-head">
            <h2>1 · Contract & Oracle</h2>
            <p>Deterministic symbol set from target SDK stubs</p>
          </header>
          <OracleTree
            data={oracle}
            loading={loading && !oracle}
            error={oracleError}
          />
        </section>

        <section className="wb-pane ast-pane">
          <header className="wb-pane-head">
            <h2>2 · AST span visualizer</h2>
            <p>
              Finder rule + matcher ·{" "}
              {spans ? `${spans.spanCount} site(s)` : "—"} · surgical only
            </p>
          </header>
          <AstSpanPanel
            files={spans?.files ?? []}
            finders={spans?.finders ?? []}
            activeFile={activeFile}
            onSelectFile={setActiveFile}
            selectedSpanIdx={spanIdx}
            onSelectSpan={setSpanIdx}
            engine={spans?.engine}
            loading={loading && !spans}
            error={spansError}
          />
        </section>

        <section className="wb-pane arena-pane">
          <header className="wb-pane-head">
            <h2>3 · Comparative arena</h2>
            <p>
              AI-alone ·{" "}
              {liveAst ? "Pure AST (live)" : "AST-alone (estimated)"} · MorphAPI
              hybrid
            </p>
          </header>
          <div className="arena-grid">
            <CodePanel
              title="AI-alone"
              subtitle={without?.label ?? "Unconstrained LLM"}
              code={without?.code ?? null}
              phantoms={without?.report?.phantoms ?? []}
              status={reportStatus(without?.report)}
              emptyHint="Run the pipeline to capture LLM-only output."
              compareTo={data?.before}
              footer={
                without?.report?.completenessPass === false ? (
                  <p className="ast-alone-note">
                    Completeness FAIL — leftover sites after primary file
                    (cascade).
                  </p>
                ) : null
              }
            />
            {liveAst ? (
              <CodePanel
                title="AST-alone"
                subtitle={astSide?.label ?? "Pure AST recipe"}
                code={astSide?.code ?? null}
                phantoms={astSide?.report?.phantoms ?? []}
                status={reportStatus(astSide?.report)}
                emptyHint="Run demo:mail-ast to capture Pure AST output."
                compareTo={data?.before}
                badgeLabel={
                  astSide?.report?.completenessPass === false
                    ? "completeness FAIL"
                    : undefined
                }
                footer={
                  <ul className="gate-chips">
                    {gateChips(astSide?.report, [
                      "typecheckPass",
                      "completenessPass",
                      "leftoverCount",
                      "spansFound",
                    ]).map((c) => (
                      <li
                        key={c.label}
                        className={
                          c.ok === true
                            ? "ok"
                            : c.ok === false
                              ? "bad"
                              : "neutral"
                        }
                      >
                        {c.label}
                      </li>
                    ))}
                  </ul>
                }
              />
            ) : (
              <CodePanel
                title="AST-alone"
                subtitle="Estimated — no executable Pure AST baseline for this scenario"
                code={estimatedBody}
                phantoms={[]}
                status="estimated"
                emptyHint="—"
                badgeLabel="estimated FAIL"
                footer={
                  <p className="ast-alone-note">
                    Pure AST is estimated here. Scenario 7 (mail) runs a live
                    notify-only recipe that surfaces cascade leftovers.
                  </p>
                }
              />
            )}
            <CodePanel
              title="MorphAPI"
              subtitle={withSide?.label ?? "Hybrid AST + oracle"}
              code={withSide?.code ?? null}
              phantoms={withSide?.report?.phantoms ?? []}
              status={reportStatus(withSide?.report)}
              emptyHint="Run the pipeline to capture hybrid output."
              compareTo={data?.before}
              footer={
                <ul className="gate-chips">
                  {gateChips(withSide?.report, gateFields).map((c) => (
                    <li
                      key={c.label}
                      className={
                        c.ok === true
                          ? "ok"
                          : c.ok === false
                            ? "bad"
                            : "neutral"
                      }
                    >
                      {c.label}
                    </li>
                  ))}
                </ul>
              }
            />
          </div>
        </section>

        <section className="wb-pane cascade-pane">
          <header className="wb-pane-head">
            <h2>4 · Cascade & impact analysis</h2>
            <p>
              Fix primary → 1° impact discovers follow-ups → how many more
              fixes
            </p>
          </header>
          <div className="wb-pane-body cascade-compare">
            {!hybridRepair && !astRepair && !llmRepair ? (
              <p className="muted">
                Run Scenario 7 (mail) to populate cascade repair reports, or
                open Evaluation for pilot timelines.
              </p>
            ) : (
              <>
                <CascadeTimeline
                  title="Hybrid cascade"
                  repair={hybridRepair}
                />
                <CascadeTimeline
                  title="Pure AST cascade (ceiling)"
                  repair={astRepair}
                />
                <CascadeTimeline
                  title="Pure LLM cascade"
                  repair={llmRepair}
                />
              </>
            )}
          </div>
        </section>

        <section className="wb-pane tel-pane">
          <header className="wb-pane-head">
            <h2>5 · Live telemetry</h2>
            <p>Closed-loop steps · inspector rejects · typecheck gate</p>
          </header>
          <TelemetryStream events={events} running={running} />
          {(withSide?.report?.attempts?.length ?? 0) > 0 &&
            events.length === 0 && (
              <div className="wb-pane-body">
                <p className="muted">
                  Last hybrid attempt log (from report.json) — run again for
                  live SSE:
                </p>
                <ol className="telemetry-log">
                  {withSide!.report!.attempts!.map((a, i) => (
                    <li
                      key={i}
                      className={
                        (a.phantomCount ?? 0) > 0 ? "reject" : "accept"
                      }
                    >
                      <span className="tel-type">
                        {(a.phantomCount ?? 0) > 0
                          ? "inspect_reject"
                          : "inspect_accept"}
                      </span>
                      <span className="tel-msg">
                        span {a.span} · attempt {a.attempt} · {a.source} ·
                        phantoms={a.phantomCount ?? 0}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
        </section>
      </div>

      <DiffModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        before={data?.before ?? null}
        after={withSide?.code ?? null}
        title={`Surgical diff · ${scenario}`}
      />
    </div>
  );
}
