import type { LiveScenarioId } from "./scenarios/catalog";

export function Landing({
  onOpenTaxonomy,
  onOpenLive,
}: {
  onOpenTaxonomy: () => void;
  onOpenLive: (liveId: LiveScenarioId) => void;
}) {
  return (
    <section className="landing">
      <div className="landing-hero">
        <p className="eyebrow">MorphAPI · Final Year Project</p>
        <h1>Self-maintaining API migrations</h1>
        <p className="lede">
          Pure LLMs invent plausible scaffolding. Pure ASTs cannot synthesize
          new business logic. MorphAPI couples{" "}
          <strong>AST scope</strong>, <strong>LLM synthesis</strong>, and a{" "}
          <strong>spec/SDK oracle</strong> so illegal symbols never land.
        </p>
        <div className="landing-cta">
          <button type="button" className="btn primary" onClick={onOpenTaxonomy}>
            Browse 10 failure modes
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => onOpenLive("plaid")}
          >
            Run live Plaid demo
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => onOpenLive("morphpay")}
          >
            Run live MorphPay demo
          </button>
        </div>
      </div>

      <article className="landing-card">
        <h2>Two axes of breaking change</h2>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Axis</th>
                <th>What breaks</th>
                <th>Typical detector</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Syntactic / structural</td>
                <td>
                  Renamed methods, removed params, new builders, enum member
                  names
                </td>
                <td>OpenAPI diff, <code>.d.ts</code>, typecheck</td>
              </tr>
              <tr>
                <td>Behavioral / semantic</td>
                <td>
                  Unit shifts (dollars→cents), side-effect changes, error
                  semantics
                </td>
                <td>Specs alone often miss → need tests / runtime</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article className="landing-card">
        <h2>Why each tool alone fails</h2>
        <div className="triad landing-triad">
          <div>
            <h3>AI alone</h3>
            <p>
              Probabilistic tokens + training bias → phantom symbols, stale
              params, incomplete multi-file edits.
            </p>
          </div>
          <div>
            <h3>AST alone</h3>
            <p>
              Exact spans and search — but semantic blindness: cannot invent
              Configuration wrappers, HMAC, or unit transforms.
            </p>
          </div>
          <div>
            <h3>Hybrid</h3>
            <p>
              AST bounds <em>where</em>; LLM proposes <em>what</em>; oracle
              decides <em>if valid</em> before apply.
            </p>
          </div>
        </div>
      </article>

      <article className="landing-card">
        <h2>Won&apos;t GPT-5 / Claude-5 make this obsolete?</h2>
        <p className="claim">
          No — MorphAPI is neurosymbolic: symbolic tools for exactness;
          neural models for fuzzy synthesis. Compilers are boolean; LLMs are
          probabilistic.
        </p>
        <ol>
          <li>
            <strong>Zero-day asymmetry.</strong> Brand-new SDK breaks are not in
            training data; priors favor deprecated GitHub patterns.
          </li>
          <li>
            <strong>Reward hacking.</strong> Test-feedback loops incentivize{" "}
            <code>@ts-ignore</code>, deleted assertions, empty catches — smarter
            models can cheat more creatively.
          </li>
          <li>
            <strong>Prompt-to-program paradox.</strong> Even high per-token
            accuracy compounds across a multi-file migration; one phantom
            symbol fails the build.
          </li>
          <li>
            <strong>Context ≠ call-graph.</strong> Huge windows still miss
            transitive sites; AST enumeration has 100% recall of known call
            nodes.
          </li>
        </ol>
      </article>

      <article className="landing-card">
        <h2>Evidence from research (not our claim of 90%)</h2>
        <p>
          External benchmarks show long-horizon coding remains hard even as
          models improve:
        </p>
        <ul>
          <li>
            <a
              href="https://scale.com/blog/swe-bench-pro"
              target="_blank"
              rel="noreferrer"
            >
              SWE-Bench Pro (Scale AI)
            </a>
            : frontier models ~23% resolve on the public Pro set vs &gt;70% on
            SWE-Bench Verified — multi-file, repo-realistic tasks collapse
            performance.
          </li>
          <li>
            <a
              href="https://arxiv.org/abs/2509.16941"
              target="_blank"
              rel="noreferrer"
            >
              SWE-Bench Pro paper
            </a>
            : failure modes include wrong solutions, syntax/tool errors, and
            context management — not “one more billion parameters.”
          </li>
        </ul>
        <p>
          <strong>Our repo evidence (live runs):</strong> MorphPay LLM-only →{" "}
          <code>CaptureMode.Automatic</code> phantoms; Plaid LLM-only →{" "}
          <code>CountryCode.US</code> phantoms; hybrid typechecks clean. See{" "}
          <strong>Live demos</strong>.
        </p>
      </article>

      <article className="landing-card doc-note">
        <h2>Honest scope</h2>
        <p>
          This repository <strong>runs</strong> two scaffolding baselines
          (MorphPay + Plaid). The other eight failure modes are a rigorous{" "}
          <strong>thesis taxonomy</strong> with illustrative snippets and real
          provider doc links — labeled Taxonomy, not fake PASS/FAIL reports.
        </p>
      </article>
    </section>
  );
}
