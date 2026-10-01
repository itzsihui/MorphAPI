export function WhyTypeScript() {
  return (
    <section className="docs-briefing context-briefing">
      <article>
        <h2>Why TypeScript is the test language</h2>
        <p className="lede">
          Building a multi-language (polyglot) migration engine is one of the
          most common ways an FYP runs out of time. MorphAPI bounds both the
          target codebases and the repair engine strictly to TypeScript
          (Node.js). That is the strongest technical and academic choice for
          four reasons.
        </p>
      </article>

      <article>
        <h2>1. The TypeScript Compiler API is unmatched for static analysis</h2>
        <p>
          In dynamically typed languages (Python, Ruby), building an AST-based
          type checker and symbol resolver from scratch is hard. In TypeScript,
          the compiler itself (<code>typescript</code> on npm) is an open API.
        </p>
        <ul>
          <li>
            Industrial-grade tooling out of the box:{" "}
            <code>ts.createSourceFile</code>, <code>ts.TypeChecker</code>, AST
            traversal helpers, plus higher-level wrappers like{" "}
            <code>ts-morph</code>.
          </li>
          <li>
            Exact AST node spans, enclosing <code>async</code> functions, and
            cross-file type tracing with minimal boilerplate.
          </li>
          <li>
            In this repo: <code>@morphapi/core</code> (<code>astScan</code>,{" "}
            <code>impactGraph</code>, <code>codePropertyGraph</code>,{" "}
            <code>asyncContagion</code>) is built directly on{" "}
            <code>import * as ts from "typescript"</code>.
          </li>
        </ul>
      </article>

      <article>
        <h2>2. Free, deterministic oracles via .d.ts declaration files</h2>
        <p>
          MorphAPI depends on a ground-truth oracle to eliminate hallucinated
          and phantom symbols.
        </p>
        <ul>
          <li>
            Modern API providers (Stripe, Plaid, OpenAI, Twilio, AWS) ship
            typed TypeScript SDKs on npm.
          </li>
          <li>
            Those packages include compiled <code>.d.ts</code> files — a purely
            static blueprint of every exported class, method signature,
            interface, and enum.
          </li>
          <li>
            Walking a <code>.d.ts</code> to emit <code>oracle.json</code> is a
            short script. Doing the same statically in Python, without
            executing untrusted code, is significantly harder.
          </li>
        </ul>
      </article>

      <article>
        <h2>3. Instant compiler verification (tsc --noEmit)</h2>
        <p>
          The cascade repair loop and evaluation rubrics need an objective
          answer to "did this patch break the build?"
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th></th>
                <th>Python</th>
                <th>TypeScript</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Missing property / renamed param</td>
                <td>Caught only when runtime tests execute that path</td>
                <td>
                  Caught by <code>tsc --noEmit</code> with a specific
                  diagnostic code
                </td>
              </tr>
              <tr>
                <td>Hallucinated member (e.g. <code>header.header</code>)</td>
                <td>Passes syntax check</td>
                <td>Compile error (TS2339)</td>
              </tr>
              <tr>
                <td>Forgotten argument</td>
                <td>Runtime <code>TypeError</code></td>
                <td>Compile error (TS2554)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="claim">
          Every baseline in <code>baselines/*</code> uses a strict{" "}
          <code>tsc</code> pass/fail as its compiler gate.
        </p>
      </article>

      <article>
        <h2>4. Code sharing with the Workbench UI</h2>
        <p>
          The visualization dashboard (the 4-pane Workbench) is React + Vite,
          also written in TypeScript.
        </p>
        <ul>
          <li>
            Core report types (<code>RepairIssue</code>, <code>UsageSpan</code>
            , <code>ApproachReport</code>, <code>Citation</code>) live in{" "}
            <code>@morphapi/core</code> and can be imported by the frontend
            as-is.
          </li>
          <li>
            No custom serialization layer, duplicate schemas, or
            Python↔JavaScript bindings.
          </li>
        </ul>
      </article>

      <article>
        <h2>Defending the choice</h2>
        <p>
          <em>
            "Why did you only test TypeScript instead of Python, Java, or Go?"
          </em>
        </p>
        <blockquote className="claim">
          We scoped our empirical prototype strictly to the TypeScript
          ecosystem to evaluate our core research questions with maximum
          precision. TypeScript provides first-class declaration files (
          <code>.d.ts</code>), enabling deterministic oracle extraction from
          published SDK artifacts without dynamic runtime execution.
          Furthermore, static type-checking (<code>tsc</code>) provides an
          objective, compiler-enforced baseline for our Scaffolding
          Hallucination and Cascade Repair evaluations. The underlying
          methodology — AST slicing, symbol allow-listing, and 1-degree impact
          analysis — is language-agnostic and directly portable to Python (via
          type stubs) or Java.
        </blockquote>
      </article>
    </section>
  );
}
