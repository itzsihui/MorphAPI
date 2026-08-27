import type { Phantom } from "./api";

type Props = {
  title: string;
  subtitle: string;
  code: string | null;
  phantoms: Phantom[];
  status: "pass" | "fail" | "neutral";
  emptyHint: string;
};

export function CodePanel({
  title,
  subtitle,
  code,
  phantoms,
  status,
  emptyHint,
}: Props) {
  return (
    <article className={`panel status-${status}`}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className={`pill ${status}`}>
          {status === "pass" ? "typecheck PASS" : status === "fail" ? "typecheck FAIL" : "source"}
        </span>
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
        <code>{code ?? emptyHint}</code>
      </pre>
    </article>
  );
}
