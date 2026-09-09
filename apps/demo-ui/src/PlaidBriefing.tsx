import type { Phantom } from "./api";

type Props = {
  docsV2: string | null;
  livePhantoms: Phantom[];
  withoutCode: string | null;
  withCode: string | null;
};

const PROVIDERS = [
  {
    name: "Stripe",
    site: "stripe.com",
    artifact: "OpenAPI + @stripe/stripe-node .d.ts",
    extract: "Parse schemas / AST over declaration files",
  },
  {
    name: "GitHub REST",
    site: "docs.github.com",
    artifact: "octokit OpenAPI + @octokit/openapi-types",
    extract: "Paths, params, response interfaces from JSON schemas",
  },
  {
    name: "OpenAI",
    site: "platform.openai.com",
    artifact: "openai-openapi + typed SDKs",
    extract: "Methods, model enums, request payload schemas",
  },
  {
    name: "Twilio",
    site: "twilio.com",
    artifact: "twilio-oai OpenAPI defs",
    extract: "Per-service JSON routes and parameter types",
  },
  {
    name: "Plaid",
    site: "plaid.com",
    artifact: "plaid-openapi + plaid TS SDK enums",
    extract: "Products, CountryCode, and related symbols (this demo)",
  },
  {
    name: "Shopify",
    site: "shopify.dev",
    artifact: "GraphQL schema + REST OpenAPI",
    extract: "GraphQL AST / introspection for types & mutations",
  },
  {
    name: "Slack",
    site: "api.slack.com",
    artifact: "API specs + @slack/web-api types",
    extract: "Method signatures and option objects",
  },
  {
    name: "AWS",
    site: "aws.amazon.com",
    artifact: "aws-sdk-js-v3 .d.ts / Smithy models",
    extract: "ts-morph over command input/output shapes",
  },
  {
    name: "Google Cloud",
    site: "cloud.google.com",
    artifact: "googleapis .proto + Discovery JSON",
    extract: "Parse protobuf RPCs and message fields",
  },
  {
    name: "Spotify",
    site: "developer.spotify.com",
    artifact: "Web API OpenAPI 3.0",
    extract: "Endpoints, query params, OAuth scopes",
  },
];

export function PlaidBriefing({
  docsV2,
  livePhantoms,
  withoutCode,
  withCode,
}: Props) {
  return (
    <section className="docs-briefing">
      <article>
        <h2>Why we picked Plaid (not every provider)</h2>
        <p>
          Many large APIs publish machine-readable contracts (OpenAPI,{" "}
          <code>.d.ts</code>, GraphQL, protobuf). We did{" "}
          <strong>not</strong> run MorphAPI against all of them — we chose{" "}
          <strong>Plaid</strong> as a second, real-shaped baseline beside
          MorphPay.
        </p>
        <ol>
          <li>
            <strong>Published contract.</strong> Plaid ships{" "}
            <code>plaid-openapi</code> and a generated TypeScript SDK — enough
            to build an SDK-derived oracle (e.g. <code>CountryCode.Us</code>,{" "}
            <code>Products.Transactions</code>).
          </li>
          <li>
            <strong>Training-memory traps.</strong> LLMs often mix ISO-looking
            names (<code>US</code>, <code>GB</code>) with the real TS enum
            members (<code>Us</code>, <code>Gb</code>). That is classic
            scaffolding hallucination.
          </li>
          <li>
            <strong>SDK history bias.</strong> Plaid kept root API date{" "}
            <code>2020-09-14</code> for years while client libraries jumped
            (hand-written <code>plaid.Client</code> → OpenAPI-generated{" "}
            <code>PlaidApi</code>). Public code + model memory still confuse
            eras — good stress for “docs vs symbol truth.”
          </li>
          <li>
            <strong>Scoped experiment.</strong> Our demo migrates stringly Link
            token fields → typed enums. Small enough to measure phantoms +
            typecheck; realistic enough to cite Plaid’s published enums.
          </li>
        </ol>
      </article>

      <article>
        <h2>What we give the LLM (and what we do not)</h2>
        <p>
          The LLM-only baseline does <strong>not</strong> receive Plaid’s full
          OpenAPI YAML or the full <code>plaid-node</code> repo. It receives
          two MorphAPI demo files that mimic a typical “migrate this” chat:
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Input</th>
                <th>Path</th>
                <th>Origin</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Docs</td>
                <td>
                  <code>docs/plaid-link-v2.md</code>
                </td>
                <td>
                  Written by us — vague on purpose (placeholders, no{" "}
                  <code>Us</code>/<code>Gb</code> spelled out). Not copied from
                  Plaid’s site.
                </td>
              </tr>
              <tr>
                <td>Source</td>
                <td>
                  <code>fixtures/plaid-client-v1/src/link.ts</code>
                </td>
                <td>
                  Our legacy fixture (string{" "}
                  <code>&quot;US&quot;</code> / <code>&quot;transactions&quot;</code>
                  ). Not a dump of <code>plaid-node</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>api.d.ts</code> / OpenAPI
                </td>
                <td>—</td>
                <td>
                  <strong>Not</strong> in the LLM-only prompt. Used offline to
                  build the oracle.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Hybrid still uses the same docs, but adds an{" "}
          <strong>oracle allow-list</strong> (and inspector retries) — a small
          symbol set extracted from the published SDK, not the entire repo
          pasted into the model.
        </p>
      </article>

      <article>
        <h2>OpenAPI vs plaid-node (what each repo is)</h2>
        <p>
          Two published artifacts, related but not the same thing you paste into
          ChatGPT:
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Repo</th>
                <th>What it contains</th>
                <th>Role for MorphAPI</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a
                    href="https://github.com/plaid/plaid-openapi"
                    target="_blank"
                    rel="noreferrer"
                  >
                    plaid/plaid-openapi
                  </a>
                </td>
                <td>
                  Mostly <code>2020-09-14.yml</code> — the OpenAPI contract
                  (paths, schemas, wire enum <em>values</em> like{" "}
                  <code>&quot;US&quot;</code>).
                </td>
                <td>
                  Source of truth for the HTTP API; Plaid generates SDKs from
                  it.
                </td>
              </tr>
              <tr>
                <td>
                  <a
                    href="https://github.com/plaid/plaid-node"
                    target="_blank"
                    rel="noreferrer"
                  >
                    plaid/plaid-node
                  </a>{" "}
                  (or a fork)
                </td>
                <td>
                  Generated TypeScript client: <code>PlaidApi</code>,{" "}
                  <code>linkTokenCreate</code>, enums like{" "}
                  <code>CountryCode.Us = &quot;US&quot;</code> in{" "}
                  <code>.d.ts</code>.
                </td>
                <td>
                  Where <strong>TS member names</strong> (<code>Us</code> vs{" "}
                  <code>US</code>) live — what our oracle mirrors.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          OpenAPI ≈ <em>what the API is</em>. plaid-node ≈{" "}
          <em>how you call it from Node</em>. We are <strong>not</strong>{" "}
          saying developers normally paste one of these instead of the other.
        </p>
      </article>

      <article>
        <h2>Why developers usually do not paste the full repo</h2>
        <ol>
          <li>
            <strong>Size / cost.</strong> Full OpenAPI YAML or generated{" "}
            <code>api.d.ts</code> is huge — blows context and buries the few
            lines that matter.
          </li>
          <li>
            <strong>Workflow.</strong> People ask “migrate this file” and paste{" "}
            <em>their</em> client + a docs snippet — not “ingest all of Plaid.”
          </li>
          <li>
            <strong>SDK already installed.</strong> It sits in{" "}
            <code>node_modules</code>; they rarely treat it as prompt material.
            Models are expected to “know Plaid.”
          </li>
          <li>
            <strong>Prose feels enough.</strong> Docs say “use country codes”;
            models map that to ISO-looking identifiers (
            <code>CountryCode.US</code>) and miss the real TS keys.
          </li>
        </ol>
        <p>
          IDE agents that auto-index <code>node_modules</code> or RAG over
          specs can do better — that is a <em>different</em> baseline than
          docs + one file. MorphAPI’s point: extract a small allow-list once
          and <strong>verify</strong>, instead of relying on someone pasting
          the whole contract every time.
        </p>
      </article>

      <article>
        <h2>What this experiment proves (and does not)</h2>
        <p>
          We do <strong>not</strong> claim: “AI fails even when given the
          entire OpenAPI / plaid-node tree in the prompt.”
        </p>
        <p>
          We <strong>do</strong> claim: given prose docs + legacy client code
          (a common agent/dev setup), a pure LLM often invents plausible but
          illegal scaffolding symbols; a system with an SDK-derived oracle can
          catch or correct that before merge.
        </p>
        <p className="claim">
          Docs → semantics. SDK / OpenAPI → oracle (membership), not “paste
          the whole repo into the model.”
        </p>
      </article>

      <article>
        <h2>Plaid versioning (short context)</h2>
        <p>
          Plaid versioning shows up in two layers — useful background for why
          client code drifts:
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>What it is</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Root API dates</td>
                <td>
                  Historical backends (e.g. 2017–2019 legacy; current{" "}
                  <code>2020-09-14</code>)
                </td>
                <td>
                  One long-lived active root; schema still evolves via OpenAPI
                  minors
                </td>
              </tr>
              <tr>
                <td>SDK majors</td>
                <td>
                  e.g. plaid-node pre-v9 hand-written vs v9+ OpenAPI-generated
                </td>
                <td>
                  Breaking client patterns even when the root date header stays
                  put
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Our baseline focuses on <strong>typed enum fidelity</strong> (what
          the published <code>.d.ts</code> actually exports), not replaying
          every historical Plaid root version.
        </p>
      </article>

      <article>
        <h2>What the live AI got wrong</h2>
        <p>
          On the last LLM-only run, the model moved to{" "}
          <code>Products.*</code> / <code>CountryCode.*</code> (right idea)
          but invented illegal members:
        </p>
        {livePhantoms.length > 0 ? (
          <ul className="live-phantoms" style={{ listStyle: "none", padding: 0 }}>
            {livePhantoms.map((p) => (
              <li key={p.symbol + p.reason}>
                <span className="tier">[{p.tier}]</span> <code>{p.symbol}</code>{" "}
                — {p.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No phantoms loaded — run a live Plaid comparison.</p>
        )}
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>AI wrote (wrong)</th>
                <th>Real Plaid TS SDK</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>CountryCode.US</code> / <code>CountryCode.GB</code>
                </td>
                <td>
                  <code>CountryCode.Us</code> / <code>CountryCode.Gb</code>
                </td>
              </tr>
              <tr>
                <td>
                  (common other misses) <code>Products.TRANSACTIONS</code>
                </td>
                <td>
                  <code>Products.Transactions</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          TypeScript then fails (<code>Did you mean &apos;Us&apos;?</code>).
          That failure <em>is</em> the scaffolding evidence.
        </p>
        {withoutCode && withCode && (
          <div className="docs-grid" style={{ marginTop: "1rem" }}>
            <div>
              <h3>LLM-only snippet</h3>
              <pre className="doc-md">
                <code>
                  {withoutCode
                    .split("\n")
                    .filter((l) => /CountryCode|Products/.test(l))
                    .slice(0, 8)
                    .join("\n") || withoutCode.slice(0, 400)}
                </code>
              </pre>
            </div>
            <div>
              <h3>Hybrid (oracle-clean) snippet</h3>
              <pre className="doc-md">
                <code>
                  {withCode
                    .split("\n")
                    .filter((l) => /CountryCode|Products/.test(l))
                    .slice(0, 8)
                    .join("\n") || withCode.slice(0, 400)}
                </code>
              </pre>
            </div>
          </div>
        )}
      </article>

      <article>
        <h2>Why the AI was wrong (docs vs SDK — docs are not “outdated”)</h2>
        <p>
          Official Plaid docs for{" "}
          <a
            href="https://plaid.com/docs/api/link/#linktokencreate"
            target="_blank"
            rel="noreferrer"
          >
            /link/token/create
          </a>{" "}
          (current API, root version <code>2020-09-14</code>) describe{" "}
          <code>country_codes</code> as <code>[string]</code> with possible
          values <code>US</code>, <code>GB</code>, … and show Node samples like{" "}
          <code>country_codes: [&apos;US&apos;]</code>. That is{" "}
          <strong>correct for the HTTP/JSON API</strong> — the wire format is
          ISO strings.
        </p>
        <p>
          The TypeScript SDK adds a <em>different</em> surface for the same
          values:
        </p>
        <pre className="doc-md">
          <code>{`// From published plaid-node api.d.ts (latest generated client)
export declare enum CountryCode {
  Us = "US",  // TS member name "Us", JSON value still "US"
  Gb = "GB",
  // ...
}`}</code>
        </pre>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>What you write</th>
                <th>What goes on the wire</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Docs / REST</td>
                <td>
                  <code>&apos;US&apos;</code>
                </td>
                <td>
                  <code>&quot;US&quot;</code>
                </td>
              </tr>
              <tr>
                <td>TS SDK (correct)</td>
                <td>
                  <code>CountryCode.Us</code>
                </td>
                <td>
                  <code>&quot;US&quot;</code>
                </td>
              </tr>
              <tr>
                <td>What the LLM invented</td>
                <td>
                  <code>CountryCode.US</code>
                </td>
                <td>
                  Does not compile — no such enum member
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          So the model was not “reading an old API.” It blurred{" "}
          <strong>allowed string values</strong> (what docs teach) with{" "}
          <strong>TypeScript enum member names</strong> (what{" "}
          <code>api.d.ts</code> exports). Docs say “enum” meaning a fixed set of
          ISO codes — not “the identifier is <code>US</code>.”
        </p>
        <p>
          <strong>Why MorphAPI is correct here:</strong> our oracle is built
          from the published SDK symbol surface (
          <code>CountryCode.Us</code>, <code>CountryCode.Gb</code>, …), not from
          guessing identifiers off the docs page. The Hallucination Inspector
          rejects <code>CountryCode.US</code>; hybrid lands members that
          typecheck. Same live Plaid API — we verify against the{" "}
          <em>client contract</em> the code must satisfy.
        </p>
        <p className="claim">
          Docs teach wire values (<code>US</code>). SDK requires member names (
          <code>Us</code>). Pure AI confuses them; MorphAPI checks the SDK
          oracle.
        </p>
      </article>

      <article>
        <h2>How MorphAPI fixes it on Plaid</h2>
        <ol>
          <li>
            <strong>AST</strong> finds each <code>linkTokenCreate(...)</code>{" "}
            span (not the whole file).
          </li>
          <li>
            <strong>Constrained LLM</strong> proposes a replacement; prompt
            includes the oracle allow-list.
          </li>
          <li>
            <strong>Inspector</strong> rejects <code>CountryCode.US</code> etc.
            against <code>oracle/plaid-link-v2.json</code> (from real SDK enum
            names).
          </li>
          <li>
            <strong>Surgical apply + typecheck</strong> — only clean symbols
            land.
          </li>
        </ol>
        <p className="claim">
          Vague Link docs → AI guesses ISO-looking members. SDK oracle → we
          catch the miss before merge.
        </p>
      </article>

      <article>
        <h2>Vague docs the LLM sees</h2>
        <p className="doc-note">
          This is <strong>our</strong> demo markdown (
          <code>docs/plaid-link-v2.md</code>), not an official Plaid doc dump.
          Placeholders for products / country codes — no <code>Us</code> /{" "}
          <code>Gb</code> spelled out. That is intentional for the LLM-only
          baseline.
        </p>
        <pre className="doc-md">
          <code>{docsV2 ?? "Missing docs/plaid-link-v2.md"}</code>
        </pre>
      </article>

      <article>
        <h2>Industry context: published contracts (examples)</h2>
        <p>
          These providers show that building an oracle from OpenAPI / SDK types
          / GraphQL / protobuf is normal — not a MorphPay-only trick. We{" "}
          <strong>have not</strong> implemented MorphAPI for every row; Plaid is
          the one we ran as a second live baseline.
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Site</th>
                <th>Machine-readable artifact</th>
                <th>Oracle extract idea</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((p) => (
                <tr key={p.name}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.name === "Plaid" ? " ← tried" : ""}
                  </td>
                  <td>{p.site}</td>
                  <td>{p.artifact}</td>
                  <td>{p.extract}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
