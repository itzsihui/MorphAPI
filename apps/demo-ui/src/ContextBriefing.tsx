export function ContextBriefing() {
  return (
    <section className="docs-briefing context-briefing">
      <article>
        <h2>Cursor has AST — why that is not MorphAPI</h2>
        <p>
          Cursor uses Tree-sitter / LSP heavily for{" "}
          <strong>passive</strong> indexing: syntax-aware RAG chunking, local
          type context, shadow-workspace diagnostics. That proves AST matters
          for developer tools.
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Cursor (editor agent)</th>
                <th>MorphAPI (FYP)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AST purpose</td>
                <td>Chunking / retrieval / diagnostics</td>
                <td>
                  Active span slice, surgical splice, call-site checklist
                </td>
              </tr>
              <tr>
                <td>Upstream contract</td>
                <td>No OpenAPI/oracle diff engine</td>
                <td>SDK/OpenAPI-derived membership oracle</td>
              </tr>
              <tr>
                <td>Symbol ground truth</td>
                <td>LLM + workspace context</td>
                <td>Deterministic allow-list + inspector reject</td>
              </tr>
              <tr>
                <td>Trigger</td>
                <td>Human chat / composer</td>
                <td>
                  Migration runner / (future) CI · Dependabot-for-APIs
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="claim">
          Same family of tools; different job. Cursor does not replace an
          API-contract repair oracle.
        </p>
      </article>

      <article>
        <h2>Stainless: provider-side speed ≠ consumer repair</h2>
        <p>
          <a
            href="https://www.stainless.com/"
            target="_blank"
            rel="noreferrer"
          >
            Stainless
          </a>{" "}
          (and similar) generate typed SDKs from OpenAPI for vendors (OpenAI,
          Cloudflare, Mux, …). That automates the{" "}
          <strong>supply</strong> side. It does{" "}
          <strong>not</strong> open PRs in your private app repo.
        </p>
        <ul>
          <li>
            Faster SDK majors → more frequent consumer breakage (velocity
            paradox).
          </li>
          <li>
            Vendor codemods (e.g. Cloudflare migrate) are often brittle /
            non-idempotent — static AST limits.
          </li>
          <li>
            Stainless <code>.d.ts</code> quality helps MorphAPI oracles — it
            does not replace them.
          </li>
        </ul>
        <p>
          Reads:{" "}
          <a
            href="https://blog.cloudflare.com/lessons-from-building-an-automated-sdk-pipeline"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare SDK pipeline
          </a>
          ,{" "}
          <a
            href="https://www.mux.com/blog/keeping-up-with-the-node-ish-ecosystem"
            target="_blank"
            rel="noreferrer"
          >
            Mux Node ecosystem
          </a>
          .
        </p>
      </article>

      <article>
        <h2>OpenAPI: wide adoption, not full behavioral coverage</h2>
        <p>
          OpenAPI is the dominant machine-readable REST contract. Plaid
          publishes{" "}
          <a
            href="https://github.com/plaid/plaid-openapi"
            target="_blank"
            rel="noreferrer"
          >
            plaid-openapi
          </a>{" "}
          and documents it from{" "}
          <a href="https://plaid.com/docs/api/" target="_blank" rel="noreferrer">
            plaid.com/docs/api
          </a>
          . Diffs catch paths, params, types, enums, many auth scheme changes.
        </p>
        <p>
          <strong>Blind spots:</strong> same type, new unit (cents); side-effect
          workflow changes; spec drift vs production; thin error docs; webhook
          payloads often under-specified. Structural oracle + (future) tests
          close the loop.
        </p>
      </article>

      <article>
        <h2>Two deployment models</h2>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th></th>
                <th>Model 1 — Local CLI / Action</th>
                <th>Model 2 — Managed GitHub App</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Code access</td>
                <td>Stays in VPC / laptop</td>
                <td>Repo install (like Dependabot)</td>
              </tr>
              <tr>
                <td>Trigger</td>
                <td>Manual / CI on failure</td>
                <td>Upstream spec release → PR</td>
              </tr>
              <tr>
                <td>FYP focus</td>
                <td>
                  <strong>This deliverable</strong>
                </td>
                <td>Thesis “production architecture”</td>
              </tr>
              <tr>
                <td>Analogy</td>
                <td>ESLint / OpenRewrite CLI</td>
                <td>Dependabot / Snyk for API drift</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Clarification: Stainless never asks customers to share codebases —
          only the vendor OpenAPI. Model 2 is the consumer-side agent product.
        </p>
      </article>

      <article>
        <h2>Comparative matrix (live baselines)</h2>
        <p className="lede">
          Status is from the catalog (<code>demoStatus: live</code> for 1a–10).
          “Last LLM-only” is from the latest{" "}
          <code>baselines/*_llm_only/out/report.json</code> on disk — not a
          multi-run rate.
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table matrix-dense">
            <thead>
              <tr>
                <th>#</th>
                <th>Mode</th>
                <th>Provider</th>
                <th>AI alone</th>
                <th>AST alone</th>
                <th>Hybrid</th>
                <th>Status</th>
                <th>Last LLM-only</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1a</td>
                <td>Builder phantoms</td>
                <td>MorphPay</td>
                <td>Wrong enum case</td>
                <td>No Builder synth</td>
                <td>Oracle + spans</td>
                <td>Live</td>
                <td>Miss (tsc FAIL, 2 phantoms)</td>
              </tr>
              <tr>
                <td>1b</td>
                <td>Enum Us vs US</td>
                <td>Plaid</td>
                <td>CountryCode.US</td>
                <td>No member names</td>
                <td>SDK oracle</td>
                <td>Live</td>
                <td>Miss (tsc FAIL, 2 phantoms)</td>
              </tr>
              <tr>
                <td>2</td>
                <td>Stale params</td>
                <td>OpenAI</td>
                <td>engine= bias</td>
                <td>Miss response paths</td>
                <td>Forbid + rewrite</td>
                <td>Live</td>
                <td>Miss (tsc FAIL)</td>
              </tr>
              <tr>
                <td>3</td>
                <td>Unit shift</td>
                <td>Stripe-like</td>
                <td>Often converts (not a MorphAPI claim)</td>
                <td>Structure OK</td>
                <td>Transform rule</td>
                <td>Live</td>
                <td>
                  Passed* — model wrote ×100 via{" "}
                  <code>amountCents</code> / <code>1050</code>; gate flagged
                  call-site shape only
                </td>
              </tr>
              <tr>
                <td>4</td>
                <td>Reward hack</td>
                <td>JWT/Auth0</td>
                <td>Fake CI / evasion</td>
                <td>No JWKS synth</td>
                <td>Lock tests</td>
                <td>Live</td>
                <td>Passed (tsc PASS, evasionCount 0 after repair)</td>
              </tr>
              <tr>
                <td>5</td>
                <td>Envelope</td>
                <td>GitHub</td>
                <td>Miss .map sites</td>
                <td>Single-file</td>
                <td>DFG adapter</td>
                <td>Live</td>
                <td>Miss (behavioral FAIL, tsc FAIL)</td>
              </tr>
              <tr>
                <td>6</td>
                <td>Async</td>
                <td>AWS v3</td>
                <td>Forget callers</td>
                <td>No strategy</td>
                <td>Call-graph</td>
                <td>Live</td>
                <td>Miss (tsc FAIL, 1 phantom)</td>
              </tr>
              <tr>
                <td>7</td>
                <td>Multi-site</td>
                <td>SendGrid/Twilio</td>
                <td>Partial edit</td>
                <td>Rule explosion</td>
                <td>Checklist</td>
                <td>Live</td>
                <td>Miss (completeness FAIL — cron/seed leftover)</td>
              </tr>
              <tr>
                <td>8</td>
                <td>Errors</td>
                <td>Stripe</td>
                <td>Dead catch</td>
                <td>No mapping</td>
                <td>try/catch expand</td>
                <td>Live</td>
                <td>Miss (tsc FAIL, 4 phantoms)</td>
              </tr>
              <tr>
                <td>9</td>
                <td>Discriminator</td>
                <td>Discord/Slack</td>
                <td>Miss switch</td>
                <td>No schema bind</td>
                <td>Exhaustive audit</td>
                <td>Live</td>
                <td>Miss (behavioral FAIL, tsc FAIL)</td>
              </tr>
              <tr>
                <td>10</td>
                <td>HMAC auth</td>
                <td>Slack/Shopify</td>
                <td>Bad crypto / leftover token ===</td>
                <td>No crypto synth</td>
                <td>Template splice</td>
                <td>Live</td>
                <td>Miss (security FAIL — static token left)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          *Scenario 3: catalog explicitly deprioritizes this as a MorphAPI
          differentiator because live models often already apply dollars→cents.
          Scenario 4 last report passed the baseline’s own gates; that is one
          run, not a claim that AI never evades.
        </p>
      </article>
    </section>
  );
}
