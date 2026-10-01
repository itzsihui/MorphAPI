/** Cascade repair timeline + per-issue rubric strip for Live Demo / Evaluation */

export type RepairIssueLite = {
  id: string;
  kind: string;
  discoveredAt: string;
  causedByIssueId?: string | null;
  symptom: string;
};

export type RepairStepLite = {
  step: number;
  issueId: string;
  action: string;
  source?: string;
  newlyDiscoveredIssueIds?: string[];
  notes?: string;
};

export type RepairEvalLite = {
  issueId: string;
  pass: boolean;
  scores: Record<string, number | null>;
  rationale: string;
};

export type ImpactFindingLite = {
  id?: string;
  fromIssueId?: string;
  fileName?: string;
  startLine?: number;
  reason?: string;
  detail?: string;
  targetSymbol?: string;
};

export type RepairSummaryLite = {
  issueCount: number;
  issuesPassed: number;
  issuesFailed: number;
  cascadeEdges: number;
  allIssuesPass: boolean;
  aggregatorMean: number | null;
  narrative: string;
  fixesDiscoveredAfterPrimary?: number;
  fixesRemainingAfterPrimary?: number;
  fixesCompletedAfterPrimary?: number;
  impactFindings?: ImpactFindingLite[];
  issues?: RepairIssueLite[];
  issueEvals?: RepairEvalLite[];
  steps?: RepairStepLite[];
};

type Props = {
  title?: string;
  repair: RepairSummaryLite | null | undefined;
};

export function toRepairSummary(
  dto:
    | {
        summary?: RepairSummaryLite & Record<string, unknown>;
        issues?: RepairIssueLite[];
        issueEvals?: RepairEvalLite[];
        steps?: RepairStepLite[];
        impactFindings?: ImpactFindingLite[];
      }
    | null
    | undefined
): RepairSummaryLite | null {
  if (!dto?.summary && !dto?.steps?.length) return null;
  const s = dto.summary ?? ({} as RepairSummaryLite);
  return {
    issueCount: s.issueCount ?? dto.issues?.length ?? 0,
    issuesPassed: s.issuesPassed ?? 0,
    issuesFailed: s.issuesFailed ?? 0,
    cascadeEdges: s.cascadeEdges ?? 0,
    allIssuesPass: s.allIssuesPass ?? false,
    aggregatorMean: s.aggregatorMean ?? null,
    narrative: s.narrative ?? "",
    fixesDiscoveredAfterPrimary: s.fixesDiscoveredAfterPrimary,
    fixesRemainingAfterPrimary: s.fixesRemainingAfterPrimary,
    fixesCompletedAfterPrimary: s.fixesCompletedAfterPrimary,
    impactFindings: dto.impactFindings ?? s.impactFindings,
    issues: dto.issues,
    issueEvals: dto.issueEvals,
    steps: dto.steps,
  };
}

export function CascadeTimeline({ title = "Cascade repair", repair }: Props) {
  if (!repair || !repair.steps?.length) return null;

  const discovered = repair.fixesDiscoveredAfterPrimary ?? repair.cascadeEdges;
  const completed = repair.fixesCompletedAfterPrimary;
  const remaining = repair.fixesRemainingAfterPrimary;

  return (
    <div className="cascade-timeline">
      <h3>{title}</h3>
      <p className="cascade-narrative">{repair.narrative}</p>
      {(discovered != null || completed != null || remaining != null) && (
        <p className="cascade-impact-chip">
          After primary fix:{" "}
          <strong>+{discovered ?? 0} issue(s) discovered</strong>
          {completed != null ? (
            <>
              {" "}
              · Hybrid completed <strong>{completed}</strong>
            </>
          ) : null}
          {remaining != null ? (
            <>
              {" "}
              · remaining <strong>{remaining}</strong>
            </>
          ) : null}
        </p>
      )}
      <ol className="cascade-steps">
        {repair.steps.map((s) => (
          <li key={s.step}>
            <span className="cascade-step-num">Step {s.step}</span>
            <code className="cascade-issue">{s.issueId}</code>
            <span>{s.action}</span>
            {s.newlyDiscoveredIssueIds && s.newlyDiscoveredIssueIds.length > 0 ? (
              <span className="cascade-new">
                → discovered {s.newlyDiscoveredIssueIds.join(", ")}
              </span>
            ) : null}
            {s.notes ? <span className="cascade-notes">{s.notes}</span> : null}
          </li>
        ))}
      </ol>
      {repair.impactFindings && repair.impactFindings.length > 0 ? (
        <div className="impact-findings">
          <h4>1° impact findings</h4>
          <ul>
            {repair.impactFindings.map((f, i) => (
              <li key={f.id ?? i}>
                <code>
                  {f.fileName}
                  {f.startLine != null ? `:${f.startLine}` : ""}
                </code>{" "}
                · {f.reason} — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {repair.issueEvals && repair.issueEvals.length > 0 ? (
        <div className="diff-table-wrap">
          <table className="diff-table cascade-rubric">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Pass</th>
                <th>compile</th>
                <th>oracle</th>
                <th>semantic</th>
                <th>locality</th>
                <th>cascade</th>
              </tr>
            </thead>
            <tbody>
              {repair.issueEvals.map((e) => (
                <tr key={e.issueId}>
                  <td>
                    <code>{e.issueId}</code>
                  </td>
                  <td>
                    <span className={`eval-pill ${e.pass ? "pass" : "fail"}`}>
                      {e.pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td>{e.scores.compile ?? "—"}</td>
                  <td>{e.scores.oracle ?? "—"}</td>
                  <td>{e.scores.semantic ?? "—"}</td>
                  <td>{e.scores.locality ?? "—"}</td>
                  <td>{e.scores.cascade ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="cascade-agg">
        Aggregator mean (secondary):{" "}
        <strong>{repair.aggregatorMean ?? "—"}</strong> · cascade edges{" "}
        {repair.cascadeEdges} · {repair.issuesPassed}/{repair.issueCount} issues
        pass
      </p>
    </div>
  );
}
