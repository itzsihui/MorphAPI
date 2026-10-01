import type { ReactNode } from "react";
import type { Phantom } from "./api";
import { lineDiffAnnotations, type DiffSeg } from "./diffLines";

export type HighlightRange = {
  startLine: number;
  endLine: number;
  kind?: string;
};

type Props = {
  title: string;
  subtitle: string;
  code: string | null;
  phantoms: Phantom[];
  status: "pass" | "fail" | "neutral" | "estimated";
  emptyHint: string;
  /** Other side's code — differing tokens highlighted yellow */
  compareTo?: string | null;
  highlightRanges?: HighlightRange[];
  badgeLabel?: string;
  footer?: ReactNode;
};

function renderSegs(segs: DiffSeg[] | undefined, fallback: string) {
  if (!segs) return fallback || " ";
  return segs.map((s, i) =>
    s.changed ? (
      <mark key={i} className="tok-diff">
        {s.text}
      </mark>
    ) : (
      <span key={i}>{s.text}</span>
    )
  );
}

function highlightPhantomLine(line: string, phantoms: Phantom[]) {
  if (!phantoms.length) return line || " ";
  // Simple: wrap first matching phantom symbol occurrence
  for (const p of phantoms) {
    const sym = p.symbol;
    if (!sym || !line.includes(sym)) continue;
    const idx = line.indexOf(sym);
    return (
      <>
        {line.slice(0, idx)}
        <mark className="tok-phantom">{sym}</mark>
        {line.slice(idx + sym.length)}
      </>
    );
  }
  return line || " ";
}

export function CodePanel({
  title,
  subtitle,
  code,
  phantoms,
  status,
  emptyHint,
  compareTo,
  highlightRanges,
  badgeLabel,
  footer,
}: Props) {
  const annotations =
    code && compareTo ? lineDiffAnnotations(code, compareTo) : new Map();

  const pillText =
    badgeLabel ??
    (status === "pass"
      ? "typecheck PASS"
      : status === "fail"
        ? "typecheck FAIL"
        : status === "estimated"
          ? "estimated FAIL"
          : "source");

  return (
    <article className={`panel status-${status}`}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className={`pill ${status}`}>{pillText}</span>
      </header>

      {phantoms.length > 0 && (
        <ul className="phantoms">
          {phantoms.map((p) => (
            <li key={p.symbol + p.reason}>
              <span className="tier">[{p.tier}]</span>{" "}
              <code>{p.symbol}</code> — {p.reason}
            </li>
          ))}
        </ul>
      )}

      <pre className="code">
        <code>
          {code == null ? (
            emptyHint
          ) : (
            code.split("\n").map((line, i) => {
              const n = i + 1;
              const segs = annotations.get(n);
              const isDiff = Boolean(segs);
              const inRange = (highlightRanges ?? []).some(
                (r) => n >= r.startLine && n <= r.endLine
              );
              return (
                <span
                  key={n}
                  className={[
                    "code-line",
                    isDiff ? "diff" : "",
                    inRange ? "span-hot" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isDiff && <span className="diff-mark" aria-hidden="true" />}
                  <span className="code-ln">{n}</span>
                  <span className="code-text">
                    {segs
                      ? renderSegs(segs, line || " ")
                      : phantoms.length
                        ? highlightPhantomLine(line, phantoms)
                        : line || " "}
                  </span>
                  {"\n"}
                </span>
              );
            })
          )}
        </code>
      </pre>
      {footer}
    </article>
  );
}
