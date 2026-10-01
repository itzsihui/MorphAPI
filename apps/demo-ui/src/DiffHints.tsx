import type { Phantom } from "./api";
import { collectContrasts, type DiffSeg } from "./diffLines";

type Props = {
  withoutCode: string | null;
  withCode: string | null;
  phantoms: Phantom[];
  apiLabel?: string;
};

function SegCode({ segs }: { segs: DiffSeg[] }) {
  return (
    <pre className="contrast-code">
      <code>
        {segs.map((s, i) =>
          s.changed ? (
            <mark key={i} className="tok-diff">
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          )
        )}
      </code>
    </pre>
  );
}

/** Highlight where LLM-only and MorphAPI outputs diverge. */
export function DiffHints({
  withoutCode,
  withCode,
  phantoms,
  apiLabel = "target API",
}: Props) {
  if (!withoutCode || !withCode) return null;

  const contrasts = collectContrasts(withoutCode, withCode, 5);
  const phantomHint =
    phantoms.length > 0
      ? phantoms
          .slice(0, 4)
          .map((p) => p.symbol)
          .join(", ")
      : null;

  if (contrasts.length === 0 && !phantomHint) {
    return (
      <div className="diff-hints">
        <h3>Where they diverge</h3>
        <p>
          No API-shape differences after ignoring formatting and renames. Right
          keeps symbols allowed by the {apiLabel} oracle.
        </p>
      </div>
    );
  }

  return (
    <div className="diff-hints">
      <h3>Where they diverge</h3>
      <p>
        Yellow = the changed fragment only (renames and wrapping ignored). Right
        keeps the {apiLabel} oracle
        {phantomHint ? ` · left phantoms: ${phantomHint}` : ""}.
      </p>
      {contrasts.length > 0 && (
        <div className="contrast-list">
          {contrasts.map((c) => (
            <article
              key={`${c.leftLine}-${c.rightLine}`}
              className="contrast-card"
            >
              <div className="contrast-side without">
                <header>
                  <span className="side without">LLM</span>
                  <span className="ln">L{c.leftLine}</span>
                </header>
                <SegCode segs={c.leftSegs} />
              </div>
              <div className="contrast-side with">
                <header>
                  <span className="side with">Morph</span>
                  <span className="ln">L{c.rightLine}</span>
                </header>
                <SegCode segs={c.rightSegs} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
