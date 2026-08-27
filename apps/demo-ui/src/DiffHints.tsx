import type { Phantom } from "./api";

type Props = {
  withoutCode: string | null;
  withCode: string | null;
  phantoms: Phantom[];
};

/** Lightweight highlight of lines that differ / contain known phantom tokens. */
export function DiffHints({ withoutCode, withCode, phantoms }: Props) {
  if (!withoutCode || !withCode) return null;

  const phantomTokens = phantoms.map((p) => p.symbol);
  const withoutLines = withoutCode.split("\n");
  const withLines = withCode.split("\n");

  const badLines = withoutLines
    .map((line, i) => ({ line, i: i + 1 }))
    .filter(
      ({ line }) =>
        phantomTokens.some((t) => line.includes(t.split(".").pop() || t)) ||
        line.includes("CaptureMode.Automatic") ||
        line.includes("CaptureMode.Manual") ||
        line.includes(".captured")
    )
    .slice(0, 6);

  return (
    <div className="diff-hints">
      <h3>Where they diverge</h3>
      <p>
        Left invents near-miss API scaffolding. Right only keeps symbols that
        exist in the MorphPay v2 oracle ({withLines.length} lines, typecheck
        clean when hybrid passes).
      </p>
      {badLines.length > 0 && (
        <ul>
          {badLines.map(({ line, i }) => (
            <li key={i}>
              <span className="ln">L{i}</span>
              <code>{line.trim()}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
