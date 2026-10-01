import type { OraclePayload } from "./api";

type Props = {
  data: OraclePayload | null;
  loading: boolean;
  error: string | null;
};

export function OracleTree({ data, loading, error }: Props) {
  if (loading) {
    return (
      <div className="wb-pane-body muted">Loading oracle artifact…</div>
    );
  }
  if (error) {
    return <div className="wb-pane-body fail-text">{error}</div>;
  }
  if (!data) {
    return <div className="wb-pane-body muted">No oracle loaded.</div>;
  }

  const o = data.oracle;
  const enums = o.enums ?? Object.keys(o.enumMembers ?? {});
  const methods = o.methods ?? {};
  const phantoms = o.knownPhantoms ?? [];

  return (
    <div className="wb-pane-body oracle-tree">
      <p className="schema-delta">{data.schemaDelta}</p>
      <p className="oracle-path">
        Artifact · <code>{data.path}</code>
        {o.api ? (
          <>
            {" "}
            · <code>{o.api}</code>
            {o.version ? `@${o.version}` : ""}
          </>
        ) : null}
      </p>

      <details open>
        <summary>
          Allowed symbols{" "}
          <span className="count">{(o.allowedSymbols ?? []).length}</span>
        </summary>
        <ul className="sym-list">
          {(o.allowedSymbols ?? []).slice(0, 40).map((s) => (
            <li key={s}>
              <code>{s}</code>
            </li>
          ))}
          {(o.allowedSymbols ?? []).length > 40 ? (
            <li className="muted">
              … +{(o.allowedSymbols ?? []).length - 40} more
            </li>
          ) : null}
        </ul>
      </details>

      {enums.length > 0 && (
        <details open>
          <summary>
            Enums <span className="count">{enums.length}</span>
          </summary>
          <ul className="sym-list">
            {enums.map((e) => (
              <li key={e}>
                <strong>{e}</strong>
                {o.enumMembers?.[e] ? (
                  <span className="muted">
                    {" "}
                    → {o.enumMembers[e].join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {Object.keys(methods).length > 0 && (
        <details>
          <summary>
            Methods <span className="count">{Object.keys(methods).length}</span>
          </summary>
          <ul className="sym-list">
            {Object.entries(methods).map(([cls, ms]) => (
              <li key={cls}>
                <strong>{cls}</strong>
                <span className="muted"> → {(ms as string[]).join(", ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details open>
        <summary className="phantom-sum">
          Known phantoms <span className="count bad">{phantoms.length}</span>
        </summary>
        <ul className="sym-list phantoms-oracle">
          {phantoms.length === 0 ? (
            <li className="muted">None listed</li>
          ) : (
            phantoms.map((p) => (
              <li key={p}>
                <code className="phantom-sym">{p}</code>
              </li>
            ))
          )}
        </ul>
      </details>
    </div>
  );
}
