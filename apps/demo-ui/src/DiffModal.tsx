import { lineDiffAnnotations } from "./diffLines";

type Props = {
  open: boolean;
  onClose: () => void;
  before: string | null;
  after: string | null;
  title?: string;
};

export function DiffModal({ open, onClose, before, after, title }: Props) {
  if (!open) return null;
  const left = before ?? "";
  const right = after ?? "";
  const ann = lineDiffAnnotations(right, left);
  const lines = right.split("\n");

  return (
    <div className="diff-modal-backdrop" role="dialog" aria-modal="true">
      <div className="diff-modal">
        <header>
          <h2>{title ?? "Inspect surgical diff"}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted">
          Yellow marks = tokens that differ from the fixture (hybrid output).
        </p>
        <pre className="code">
          <code>
            {lines.map((line, i) => {
              const n = i + 1;
              const segs = ann.get(n);
              return (
                <span
                  key={n}
                  className={segs ? "code-line diff" : "code-line"}
                >
                  {segs ? <span className="diff-mark" aria-hidden /> : null}
                  <span className="code-ln">{n}</span>
                  <span className="code-text">
                    {segs
                      ? segs.map((s, j) =>
                          s.changed ? (
                            <mark key={j} className="tok-diff">
                              {s.text}
                            </mark>
                          ) : (
                            <span key={j}>{s.text}</span>
                          )
                        )
                      : line || " "}
                  </span>
                  {"\n"}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
