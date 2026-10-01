import { useEffect, useMemo, useRef, useState } from "react";
import {
  ARM_LABELS,
  fetchLastRun,
  streamRun,
  type AttemptRecord,
  type MigrationRunDto,
  type PipelineArm,
  type PipelineEvent,
  type PipelineModel,
  type SpanStep,
} from "./pipelineApi";

type DiffLine = { kind: " " | "+" | "-"; text: string; a?: number; b?: number };

function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: " ", text: a[i], a: ++i, b: ++j });
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ kind: "+", text: b[j], b: ++j });
    else out.push({ kind: "-", text: a[i], a: ++i });
  }
  return out;
}

/** Changed lines plus `context` unchanged lines around them. */
function hunks(lines: DiffLine[], context = 2): Array<DiffLine | null> {
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.kind !== " ") for (let k = i - context; k <= i + context; k++) keep.add(k);
  });
  const out: Array<DiffLine | null> = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      out.push(l);
      gap = false;
    } else if (!gap) {
      out.push(null);
      gap = true;
    }
  });
  return out;
}

function FileDiff({ name, before, after }: { name: string; before: string; after: string }) {
  const rows = useMemo(() => hunks(lineDiff(before, after)), [before, after]);
  return (
    <div className="pl-diff">
      <div className="pl-diff-name">{name}</div>
      <pre>
        {rows.map((r, i) =>
          r ? (
            <div key={i} className={`pl-dl ${r.kind === "+" ? "add" : r.kind === "-" ? "del" : ""}`}>
              <span className="pl-ln">{r.kind === "+" ? "" : r.a}</span>
              <span className="pl-ln">{r.kind === "-" ? "" : r.b}</span>
              <span className="pl-sign">{r.kind}</span>
              {r.text}
            </div>
          ) : (
            <div key={i} className="pl-dl gap">
              ⋯
            </div>
          )
        )}
      </pre>
    </div>
  );
}

function Attempt({ a }: { a: AttemptRecord }) {
  return (
    <li className={`pl-attempt ${a.ok ? "ok" : "rejected"}`}>
      <div className="pl-attempt-head">
        <strong>Attempt {a.attempt}</strong>
        <span className={`pl-badge ${a.ok ? "ok" : "bad"}`}>{a.ok ? "accepted by gate" : "rejected"}</span>
        {a.sliceKind ? <span className="pl-badge">{a.sliceKind} slice</span> : null}
        {a.escalated ? <span className="pl-badge warn">escalated</span> : null}
      </div>
      <pre className="pl-code">{a.candidate}</pre>
      {a.findings.length ? (
        <ul className="pl-findings">
          {a.findings.map((f, i) => (
            <li key={i}>
              <span className={`pl-kind ${f.kind}`}>{f.kind}</span> {f.message}
              {f.suggestions?.length ? (
                <span className="pl-suggest">
                  Valid options:{" "}
                  {f.suggestions.map((s) => (
                    <code key={s}>{s}</code>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {a.warnings.length ? (
        <ul className="pl-findings warn">
          {a.warnings.map((w, i) => (
            <li key={i}>
              <span className={`pl-kind ${w.kind}`}>{w.kind}</span> {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Step({ step, open }: { step: SpanStep; open: boolean }) {
  return (
    <details className={`pl-step ${step.accepted ? "ok" : "failed"}`} open={open}>
      <summary>
        <code>
          {step.file}:{step.line}
        </code>
        <span className={`pl-badge ${step.accepted ? "ok" : "bad"}`}>{step.accepted ? "migrated" : "not migrated"}</span>
        <span className="pl-badge">{step.attempts.length} attempt{step.attempts.length === 1 ? "" : "s"}</span>
        {step.escalated ? <span className="pl-badge warn">escalated to statement</span> : null}
        {step.dataflow && step.dataflow.mode !== "none" && step.dataflow.mode !== "unresolved" ? (
          <span className="pl-badge">data flow: {step.dataflow.mode}</span>
        ) : null}
      </summary>
      <div className="pl-step-body">
        <div>
          <h4>Slice ({step.slice.kind}, line {step.slice.startLine})</h4>
          <pre className="pl-code">{step.slice.text}</pre>
          <details className="pl-prompt">
            <summary>Prompt sent to the model</summary>
            <pre>{step.prompt}</pre>
          </details>
          {step.imports.length ? (
            <p className="cg-note">
              Imports added: {step.imports.map((i) => <code key={i}>{i} </code>)}
            </p>
          ) : null}
        </div>
        <div>
          <h4>Gate</h4>
          <ol className="pl-attempts">
            {step.attempts.map((a) => (
              <Attempt key={a.attempt} a={a} />
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}

function eventLine(e: PipelineEvent): string {
  const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : "";
  switch (e.type) {
    case "start":
      return `start · ${(e.spans as unknown[]).length} call site(s) · baseline ${e.baselineDiagnostics} diagnostics`;
    case "attempt":
      return `${where}attempt ${e.attempt} ${e.ok ? "accepted" : `rejected (${(e.findings as Array<{ kind: string }>).map((f) => f.kind).join(", ")})`}`;
    case "imports":
      return `${where}imports ${JSON.stringify({ added: e.added, removed: e.removed, swapped: e.swapped })}`;
    case "impact":
      return `impact round ${e.round} · ${(e.findings as unknown[]).length} finding(s)`;
    case "done":
      return `done · ${(e.final as { complete: boolean }).complete ? "complete" : "incomplete"}`;
    default:
      return `${where}${e.type}`;
  }
}

export function PipelineRun({ scenario, focus }: { scenario: string; focus: { fileName: string; line: number } | null }) {
  const [arm, setArm] = useState<PipelineArm>("arm1_morphapi");
  const [model, setModel] = useState<PipelineModel>("mini");
  const [run, setRun] = useState<MigrationRunDto | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setEvents([]);
    fetchLastRun(scenario, arm, model)
      .then((r) => live && setRun(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [scenario, arm, model]);

  useEffect(() => () => cancel.current?.(), []);

  const start = () => {
    setBusy(true);
    setError(null);
    setEvents([]);
    cancel.current = streamRun(scenario, arm, model, {
      onStep: (e) => setEvents((xs) => [...xs, e]),
      onRun: (r) => {
        setRun(r);
        setBusy(false);
      },
      onError: (msg) => {
        setError(msg);
        setBusy(false);
      },
    });
  };

  const m = run?.metrics;
  const isFocus = (s: SpanStep) => Boolean(focus && s.file.endsWith(focus.fileName) && s.line === focus.line);

  return (
    <div className="pl">
      <div className="pl-controls">
        <label className="cg-select">
          <span className="eyebrow">Arm</span>
          <select value={arm} onChange={(e) => setArm(e.target.value as PipelineArm)} disabled={busy}>
            {Object.entries(ARM_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="cg-select">
          <span className="eyebrow">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value as PipelineModel)} disabled={busy}>
            <option value="mini">gpt-4o-mini</option>
            <option value="frontier">Claude (frontier)</option>
          </select>
        </label>
        <button type="button" className="btn primary" onClick={start} disabled={busy}>
          {busy ? "Running…" : run ? "Run again (live)" : "Run live"}
        </button>
        {run ? (
          <span className="muted">
            Showing saved run · {run.model} · {(run.ms / 1000).toFixed(1)}s
          </span>
        ) : !busy ? (
          <span className="muted">No saved run for this arm and model yet.</span>
        ) : null}
      </div>

      {error ? <p className="banner fail-banner">{error}</p> : null}

      {busy || (events.length && !run) ? (
        <ol className="pl-log">
          {events.map((e, i) => (
            <li key={i}>{eventLine(e)}</li>
          ))}
        </ol>
      ) : null}

      {run && m ? (
        <>
          <div className="pl-summary">
            <div className={run.final.complete ? "good" : "warn"}>
              <strong>{run.final.complete ? "Complete" : "Incomplete"}</strong>
              <span>no leftovers, no v1 uses, no new type errors</span>
            </div>
            <div>
              <strong>
                {m.spansMigrated}/{m.spansFound}
              </strong>
              <span>call sites migrated</span>
            </div>
            <div>
              <strong>{m.attempts}</strong>
              <span>LLM attempts</span>
            </div>
            <div className={m.phantomRejections ? "warn" : ""}>
              <strong>{m.phantomRejections}</strong>
              <span>phantoms rejected by the gate</span>
            </div>
            <div>
              <strong>{m.escalations}</strong>
              <span>escalations to statement slice</span>
            </div>
            <div className={m.churnRatio > 0.1 ? "warn" : "good"}>
              <strong>{(m.churnRatio * 100).toFixed(0)}%</strong>
              <span>
                churn ({m.linesOutsideSpans} of {m.changedLines} changed lines unrelated)
              </span>
            </div>
            <div>
              <strong>{(m.promptTokens + m.completionTokens).toLocaleString()}</strong>
              <span>
                tokens ({m.promptTokens.toLocaleString()} in / {m.completionTokens.toLocaleString()} out)
              </span>
            </div>
          </div>

          <h3>Call sites</h3>
          {run.steps.map((s, i) => (
            <Step key={`${s.file}:${s.line}:${i}`} step={s} open={isFocus(s)} />
          ))}

          <div className="cg-two">
            <div>
              <h3>Impact (1 hop, after the call-site edits)</h3>
              {run.impact ? (
                <>
                  <p className="cg-note">
                    Files checked: {run.impact.oneHopFiles.map((f) => <code key={f}>{f} </code>)}
                  </p>
                  {run.impact.changedFunctions.length ? (
                    <ul className="cg-list">
                      {run.impact.changedFunctions.map((c) => (
                        <li key={c.name}>
                          <code>{c.name}</code> now returns <code>{c.after}</code> (was <code>{c.before}</code>)
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {run.impact.findings.length ? (
                    <ul className="pl-findings">
                      {run.impact.findings.map((f, i) => (
                        <li key={i}>
                          <span className={`pl-kind ${f.reason}`}>{f.reason}</span> line {f.line}: {f.detail}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No findings after the span edits.</p>
                  )}
                </>
              ) : (
                <p className="muted">Impact analysis is off for this arm.</p>
              )}
            </div>
            <div>
              <h3>Impact repairs</h3>
              {run.impactFixes.length ? (
                run.impactFixes.map((x, i) => (
                  <div key={i} className="pl-fix">
                    <p>
                      <span className={`pl-kind ${x.reason}`}>{x.reason}</span>{" "}
                      <code>
                        {x.file}:{x.line}
                      </code>{" "}
                      <span className={`pl-badge ${x.after != null ? "ok" : "bad"}`}>{x.after != null ? "fixed" : "not fixed"}</span>
                    </p>
                    {x.before ? <pre className="pl-code del">{x.before}</pre> : null}
                    {x.after != null ? <pre className="pl-code add">{x.after}</pre> : null}
                  </div>
                ))
              ) : (
                <p className="muted">Nothing to repair.</p>
              )}
              {run.final.newDiagnostics.length ? (
                <>
                  <h3>Remaining new diagnostics</h3>
                  <ul className="pl-findings">
                    {run.final.newDiagnostics.map((d, i) => (
                      <li key={i}>
                        <code>
                          {d.file}:{d.line}
                        </code>{" "}
                        {d.message}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>

          <h3>Diff</h3>
          {Object.entries(run.patches).map(([f, p]) => (
            <FileDiff key={f} name={f} before={p.before} after={p.after} />
          ))}
        </>
      ) : null}
    </div>
  );
}
