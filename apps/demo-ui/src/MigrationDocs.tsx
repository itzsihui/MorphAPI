import type { ReactNode } from "react";

export type MigrationDocsProps = {
  note: ReactNode;
  docs: string | null;
  docsPath: string;
  oraclePath: string;
  oracleBody: ReactNode;
};

/**
 * Shared live-demo docs tab — same layout as Scenario 2 (OpenAI):
 * vague docs the model saw + oracle traps.
 */
export function MigrationDocs({
  note,
  docs,
  docsPath,
  oraclePath,
  oracleBody,
}: MigrationDocsProps) {
  return (
    <section className="docs-briefing">
      <article>
        <h2>What LLM-only saw</h2>
        <p className="doc-note">{note}</p>
        <pre className="doc-md">
          <code>{docs ?? `(missing ${docsPath})`}</code>
        </pre>
      </article>
      <article>
        <h2>Oracle traps</h2>
        <p>
          <code>{oraclePath}</code> {oracleBody}
        </p>
      </article>
    </section>
  );
}
