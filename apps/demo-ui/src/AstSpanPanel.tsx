import type { FinderExplain, UsageSpanDto } from "./api";

type Props = {
  files: Array<{
    path: string;
    name: string;
    source: string;
    spans: UsageSpanDto[];
  }>;
  finders?: FinderExplain[];
  activeFile: string;
  onSelectFile: (name: string) => void;
  selectedSpanIdx: number;
  onSelectSpan: (idx: number) => void;
  engine?: string;
  loading?: boolean;
  error?: string | null;
};

function lineInSpan(line: number, span: UsageSpanDto) {
  return line >= span.startLine && line <= span.endLine;
}

export function AstSpanPanel({
  files,
  finders = [],
  activeFile,
  onSelectFile,
  selectedSpanIdx,
  onSelectSpan,
  engine,
  loading,
  error,
}: Props) {
  const file = files.find((f) => f.name === activeFile) ?? files[0];
  const spans = file?.spans ?? [];
  const selected = spans[selectedSpanIdx] ?? spans[0];
  const lines = (file?.source ?? "").split("\n");
  const activeFinder =
    finders.find((f) => f.key === selected?.kind) ?? finders[0] ?? null;

  if (loading) {
    return <div className="wb-pane-body muted">Scanning AST spans…</div>;
  }
  if (error) {
    return <div className="wb-pane-body fail-text">{error}</div>;
  }
  if (!file) {
    return <div className="wb-pane-body muted">No fixture source.</div>;
  }

  return (
    <div className="wb-pane-body ast-span-panel">
      <div className="ast-explain">
        <div className="ast-explain-head">
          <h3>How AST finds edit sites</h3>
          <span className="ast-engine-chip">
            Engine · <code>{engine ?? "typescript-compiler-api"}</code>
          </span>
        </div>
        <p className="ast-explain-caption">
          Deterministic TypeScript compiler walk — not LLM. Spans below are
          surgical splice targets.
        </p>
        {finders.length > 0 ? (
          <ul className="ast-finder-list">
            {finders.map((f) => {
              const isActive = activeFinder?.key === f.key;
              return (
                <li
                  key={f.key}
                  className={isActive ? "ast-finder active" : "ast-finder"}
                >
                  <div className="ast-finder-meta">
                    <code className="ast-fn">{f.fnName}</code>
                    <span className="ast-key">{f.key}</span>
                  </div>
                  <p className="ast-rule">{f.rule}</p>
                  <pre className="ast-pseudo">
                    <code>{f.pseudocode}</code>
                  </pre>
                  <p className="ast-source muted">
                    Source · <code>{f.sourcePath}</code>
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No span finders configured for this scenario.</p>
        )}
      </div>

      <div className="ast-toolbar">
        <div className="file-tabs" role="tablist" aria-label="Fixture files">
          {files.map((f) => (
            <button
              key={f.name}
              type="button"
              role="tab"
              className={f.name === file.name ? "active" : ""}
              onClick={() => {
                onSelectFile(f.name);
                onSelectSpan(0);
              }}
            >
              {f.name}
              <span className="count">{f.spans.length}</span>
            </button>
          ))}
        </div>
      </div>

      {spans.length > 0 ? (
        <div className="span-pills">
          {spans.map((s, i) => (
            <button
              key={`${s.kind}-${s.start}`}
              type="button"
              className={i === (selectedSpanIdx || 0) ? "active" : ""}
              onClick={() => onSelectSpan(i)}
            >
              <code>{s.kind}</code>
              <span>
                L{s.startLine}:{s.startChar}–L{s.endLine}:{s.endChar}
              </span>
              <span className="bytes">
                bytes {s.start}–{s.end}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">No spans found in this file.</p>
      )}

      {selected ? (
        <p className="ast-breadcrumb">
          Program › CallSite › <code>{selected.kind}</code>
          {activeFinder ? (
            <>
              {" "}
              via <code>{activeFinder.fnName}</code>
            </>
          ) : null}{" "}
          · surgical splice target
        </p>
      ) : null}

      <pre className="code ast-code">
        <code>
          {lines.map((line, i) => {
            const n = i + 1;
            const inSpan = selected ? lineInSpan(n, selected) : false;
            const anySpan = spans.some((s) => lineInSpan(n, s));
            return (
              <span
                key={n}
                className={[
                  "code-line",
                  inSpan ? "span-hot" : "",
                  anySpan && !inSpan ? "span-dim-hot" : "",
                  !anySpan && spans.length ? "span-dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="code-ln">{n}</span>
                <span className="code-text">{line || " "}</span>
                {"\n"}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
