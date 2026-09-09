import type { Phantom } from "./api";

type Props = {
  docsV1: string | null;
  docsV2: string | null;
  livePhantoms: Phantom[];
  /** Original v1 client — used to show an example AST span */
  beforeCode: string | null;
};

const EXAMPLE_PROMPT = `System:
You migrate MorphPay API call sites. Output ONLY a TypeScript expression
that replaces the given call (the surrounding await stays). Do not invent
symbols. Use ONLY the allowed API symbols listed.

User:
## Allowed MorphPay v2 symbols (oracle)
CaptureMode, CaptureMode.AUTOMATIC, CaptureMode.MANUAL, PaymentIntent,
PaymentIntent.Builder, setAmount, setCurrency, setPaymentMethod,
setCaptureMode, build, confirm, …

## Docs
(morphpay-v2.md — the vague migration guide)

## Call site to replace   ← this text comes from the AST span
\`\`\`ts
morphpay.charges.create({
  amount: amountCents,
  currency: "usd",
  source: cardToken,
  capture: true,
})
\`\`\`

## Rules
- Use PaymentIntent.Builder + setAmount/setCurrency/setPaymentMethod/setCaptureMode/build
- CaptureMode only AUTOMATIC or MANUAL (exact enum member names)
- Confirm via morphpay.intents.confirm(intent)
- Never use IntentFactory, setCapture, CaptureMode.IMMEDIATE, or charges.create`;

function extractExampleSpan(beforeCode: string | null): string {
  if (!beforeCode) {
    return `morphpay.charges.create({
  amount: amountCents,
  currency: "usd",
  source: cardToken,
  capture: true,
})`;
  }
  const match = beforeCode.match(
    /morphpay\.charges\.create\(\{[\s\S]*?\}\)/
  );
  return match ? match[0] : beforeCode.slice(0, 200);
}

export function DocsBriefing({
  docsV1,
  docsV2,
  livePhantoms,
  beforeCode,
}: Props) {
  const exampleSpan = extractExampleSpan(beforeCode);

  return (
    <section className="docs-briefing">
      <article>
        <h2>MorphPay v1 vs v2 — what changed?</h2>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Concern</th>
                <th>v1 (old)</th>
                <th>v2 (new)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Package</td>
                <td>
                  <code>morphpay-v1</code>
                </td>
                <td>
                  <code>morphpay-v2</code>
                </td>
              </tr>
              <tr>
                <td>Create payment</td>
                <td>
                  <code>morphpay.charges.create(&#123;…&#125;)</code>
                </td>
                <td>
                  <code>new PaymentIntent.Builder()…build()</code>
                </td>
              </tr>
              <tr>
                <td>Card / source</td>
                <td>
                  <code>source</code>
                </td>
                <td>
                  <code>setPaymentMethod(…)</code>
                </td>
              </tr>
              <tr>
                <td>Capture</td>
                <td>
                  <code>capture: true \| false</code>
                </td>
                <td>
                  <code>setCaptureMode(CaptureMode.AUTOMATIC \| MANUAL)</code>
                </td>
              </tr>
              <tr>
                <td>Confirm</td>
                <td>implicit in create</td>
                <td>
                  <code>morphpay.intents.confirm(intent)</code>
                </td>
              </tr>
              <tr>
                <td>Result field</td>
                <td>
                  <code>charge.captured</code>
                </td>
                <td>
                  <code>intent.captureMode</code> (no <code>captured</code>)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Roughly <strong>6 breaking mappings</strong> — package, call shape,
          source rename, capture model, confirm step, and return fields. Easy to
          describe in English; hard to get every symbol exactly right.
        </p>
      </article>

      <div className="docs-grid">
        <article>
          <h2>v1 API docs</h2>
          <pre className="doc-md">
            <code>{docsV1 ?? "Missing docs/morphpay-v1.md"}</code>
          </pre>
        </article>
        <article>
          <h2>v2 API docs</h2>
          <p className="doc-note">
            This is what the LLM sees. Notice{" "}
            <code>setCaptureMode(/* capture mode */)</code> — the exact enum
            names are not spelled out, which invites guessing.
          </p>
          <pre className="doc-md">
            <code>{docsV2 ?? "Missing docs/morphpay-v2.md"}</code>
          </pre>
        </article>
      </div>

      <article>
        <h2>AST → constrained LLM — what actually goes in?</h2>
        <p>
          The AST does <strong>not</strong> send the whole file to the model.
          It finds each <code>morphpay.charges.create(...)</code> call and
          returns a <strong>span</strong>: exact text + start/end offsets.
        </p>
        <p>
          Example span text extracted from your v1 client (this is the main
          AST → LLM payload piece):
        </p>
        <pre className="doc-md">
          <code>{exampleSpan}</code>
        </pre>
        <p>
          That span is then wrapped into a <strong>constrained prompt</strong>{" "}
          (see <code>proposeLiveReplacement</code> in{" "}
          <code>baselines/hybrid/src/run.ts</code>):
        </p>
        <ol>
          <li>
            <strong>System:</strong> replace only this call expression; no
            whole-file rewrite.
          </li>
          <li>
            <strong>Oracle allow-list:</strong> legal MorphPay v2 symbols.
          </li>
          <li>
            <strong>Docs:</strong> vague v2 migration guide (semantics).
          </li>
          <li>
            <strong>Call site:</strong> the AST <code>span.text</code> above.
          </li>
          <li>
            <strong>Rules:</strong> exact enum names, confirm via{" "}
            <code>intents.confirm</code>, no phantoms.
          </li>
        </ol>
        <pre className="doc-md">
          <code>{EXAMPLE_PROMPT}</code>
        </pre>
        <p>
          LLM-only baseline is different: it gets the <em>entire</em> client
          file + docs and may rewrite everything. Hybrid only asks for a
          replacement expression for that one span.
        </p>
      </article>

      <article>
        <h2>Why is this hard for AI alone?</h2>
        <ol>
          <li>
            <strong>Semantics ≠ fidelity.</strong> Models often choose the right
            pattern (Builder + capture mode) but invent the wrong constant names.
          </li>
          <li>
            <strong>Incomplete / vague docs.</strong> Real changelogs often omit
            exact enum members, builders, or confirm steps — same as our v2
            guide.
          </li>
          <li>
            <strong>Near-miss training data.</strong> TitleCase names like{" "}
            <code>Automatic</code> / <code>Manual</code> look plausible because
            other SDKs use them; MorphPay requires{" "}
            <code>AUTOMATIC</code> / <code>MANUAL</code>.
          </li>
          <li>
            <strong>Whole-file rewrite.</strong> Unbounded LLM edits also keep
            leftover v1 fields (e.g. <code>charge.captured</code>) that no longer
            exist.
          </li>
          <li>
            <strong>Looks correct to humans.</strong> High textual overlap fools
            CodeBLEU / casual review; only compile or an oracle catches it.
          </li>
        </ol>
      </article>

      <article>
        <h2>Why not just paste the full SDK into the AI?</h2>
        <p>
          You <strong>can</strong> put the SDK in the prompt — and it often
          helps. It still does not replace the oracle.
        </p>
        <ol>
          <li>
            <strong>The model still guesses.</strong> Even with types in
            context, LLMs are probabilistic. They skim, mix SDKs, or emit
            near-misses (<code>Automatic</code> vs <code>AUTOMATIC</code>).
            Fuller context reduces errors; it does not make them{" "}
            <strong>zero</strong>.
          </li>
          <li>
            <strong>Reading ≠ checking.</strong> Prompting with the SDK =
            “please try to follow this.” Oracle = “reject if not in this set”
            (deterministic). Hoping the model attended to the right line is not
            a membership test.
          </li>
          <li>
            <strong>Huge real SDKs.</strong> Stripe/AWS types are enormous. You
            cannot dump everything every time; the model may only see a slice
            and invent the rest.
          </li>
          <li>
            <strong>Wrong failure mode.</strong> Without a gate, a confident
            wrong patch can still look fine and land in a PR. The inspector
            gives an explicit phantom count for evaluation.
          </li>
          <li>
            <strong>Unbounded edits.</strong> “Here’s the SDK, rewrite the
            file” still invites whole-file drift. AST spans keep edits local.
          </li>
        </ol>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Approach</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>SDK / docs in prompt (or RAG)</td>
                <td>Helps LLM <strong>propose</strong> the migration</td>
              </tr>
              <tr>
                <td>Oracle + inspector</td>
                <td>
                  <strong>Guarantees</strong> symbols are legal before apply
                </td>
              </tr>
              <tr>
                <td>AST spans</td>
                <td>
                  <strong>Limits</strong> where it may edit
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          So the claim is not “AI can’t see types.” It is:{" "}
          <strong>
            AI alone is not a reliable fidelity layer; hybrid adds a
            deterministic check the model cannot skip.
          </strong>
        </p>
      </article>

      <article>
        <h2>What kind of hallucinations show up?</h2>
        <p>
          Literature calls this <strong>scaffolding hallucination</strong>: the
          migration intent is right, but the glue symbols are wrong.
        </p>
        <div className="hallucination-cards">
          <div className="h-card">
            <h3>Atomic</h3>
            <p>
              Invented classes, enums, or constants that are not in the API.
            </p>
            <ul>
              <li>
                <code>CaptureMode.Automatic</code> / <code>Manual</code>
              </li>
              <li>
                <code>CaptureMode.IMMEDIATE</code>
              </li>
              <li>
                <code>IntentFactory</code>
              </li>
            </ul>
          </div>
          <div className="h-card">
            <h3>Scope-bound</h3>
            <p>
              Real-looking methods used on the wrong object or in an invalid
              chain.
            </p>
            <ul>
              <li>
                <code>Builder.setCapture(true)</code> (v1 idea on v2 Builder)
              </li>
              <li>
                Calling <code>.confirm()</code> on the Builder / intent instead
                of <code>morphpay.intents.confirm</code>
              </li>
            </ul>
          </div>
          <div className="h-card">
            <h3>Leftover v1 fields</h3>
            <p>Old return shape kept after migration.</p>
            <ul>
              <li>
                <code>charge.captured</code> — does not exist on{" "}
                <code>PaymentIntent</code>
              </li>
            </ul>
          </div>
        </div>
        {livePhantoms.length > 0 && (
          <div className="live-phantoms">
            <h3>From your last live LLM-only run</h3>
            <ul>
              {livePhantoms.map((p) => (
                <li key={p.symbol + p.reason}>
                  <span className="tier">[{p.tier}]</span>{" "}
                  <code>{p.symbol}</code> — {p.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      <article>
        <h2>Why MorphAPI (AI + AST) is better</h2>
        <ol>
          <li>
            <strong>AST locates usages</strong> — only edit{" "}
            <code>charges.create</code> spans, not the whole file.
          </li>
          <li>
            <strong>Constrained LLM</strong> — prompt includes the oracle’s
            allowed symbols (<code>AUTOMATIC</code>, <code>MANUAL</code>, …).
          </li>
          <li>
            <strong>Hallucination Inspector</strong> — rejects phantoms before
            they land in the repo.
          </li>
          <li>
            <strong>Surgical apply + typecheck</strong> — verified nodes only;
            compile is the final gate.
          </li>
        </ol>
        <p className="claim">
          LLM decides <em>what</em> the migration means; AST + oracle enforce{" "}
          <em>which symbols are legal</em>. That is the hybrid thesis.
        </p>
      </article>

      <article>
        <h2>Docs vs SDK oracle — who does what?</h2>
        <p>
          Short version:{" "}
          <strong>
            pure AI reads docs and guesses; MorphAPI also verifies against an
            SDK-derived oracle.
          </strong>
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Approach</th>
                <th>Reads</th>
                <th>Hard “is this symbol real?” check</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pure AI (baseline)</td>
                <td>Vague migration docs</td>
                <td>
                  <strong>No</strong> — model only predicts plausible text
                </td>
              </tr>
              <tr>
                <td>MorphAPI (hybrid)</td>
                <td>
                  Docs (for LLM semantics) + AST span + oracle allow-list
                </td>
                <td>
                  <strong>Yes</strong> — Hallucination Inspector vs oracle JSON
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ol>
          <li>
            <strong>The AI does not run the oracle check.</strong> It only
            proposes code. Even with the SDK in the prompt, that is soft
            guidance inside the model — not a deterministic membership test.
          </li>
          <li>
            <strong>
              AST does not spot <code>Automatic</code> vs{" "}
              <code>AUTOMATIC</code>.
            </strong>{" "}
            AST finds <em>where</em> to edit. The{" "}
            <strong>oracle + inspector</strong> catch illegal symbols.
          </li>
          <li>
            Near-miss example: training data makes{" "}
            <code>CaptureMode.Automatic</code> look plausible; MorphPay only
            allows <code>AUTOMATIC</code> / <code>MANUAL</code>. LLM may emit
            the wrong one; inspector rejects it because it is not in the
            oracle set.
          </li>
        </ol>
        <pre className="doc-md">
          <code>{`LLM writes:     CaptureMode.Automatic
Oracle has:     CaptureMode.AUTOMATIC, CaptureMode.MANUAL
Inspector:      "Automatic" ∉ oracle  →  phantom  →  reject / retry

AI proposes  →  MorphAPI verifies  →  only then apply`}</code>
        </pre>
      </article>

      <article>
        <h2>What is an SDK-derived oracle?</h2>
        <p>
          A checklist of legal API symbols{" "}
          <strong>built from the real SDK</strong> (typed library), not from
          the vague markdown docs.
        </p>
        <ul>
          <li>
            <strong>SDK</strong> — what developers install, e.g.{" "}
            <code>packages/morphpay-v2</code> defining{" "}
            <code>CaptureMode.AUTOMATIC</code>, <code>setCaptureMode</code>, …
          </li>
          <li>
            <strong>Oracle</strong> — that surface flattened into something
            checkable, e.g. <code>oracle/morphpay-v2.json</code>
          </li>
          <li>
            <strong>“SDK-derived”</strong> — parse the SDK (AST /{" "}
            <code>.d.ts</code> / OpenAPI) → fill that list. Truth comes from
            what the library really exports.
          </li>
        </ul>
        <p>
          In this demo the JSON was written by hand to match MorphPay v2;
          later you auto-generate it from the SDK. Same idea: SDK = source of
          truth → oracle = machine-readable copy for the inspector.
        </p>
      </article>

      <article>
        <h2>But not every API has an SDK…?</h2>
        <p>
          True. The oracle does not require a TypeScript package specifically —
          it needs <strong>some machine-readable contract</strong> of “what
          exists.”
        </p>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>If the provider ships…</th>
                <th>Oracle can be built from…</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Client SDK (npm / PyPI / jar)</td>
                <td>Parse types / exports (easiest — this demo)</td>
              </tr>
              <tr>
                <td>OpenAPI / Swagger</td>
                <td>Paths, schemas, enums</td>
              </tr>
              <tr>
                <td>GraphQL / protobuf / gRPC</td>
                <td>Schema / IDL extract</td>
              </tr>
              <tr>
                <td>Only a vague README</td>
                <td>
                  <strong>No strong oracle</strong> — real FYP limitation
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If there is truly nothing structured: state that as a scope limit;
          fallbacks are weaker (compile/tests only, or ask for OpenAPI).
          MorphAPI targets the common case where APIs{" "}
          <em>do</em> publish a contract (SDK or OpenAPI). The contribution is
          using that contract to catch scaffolding hallucinations — not
          claiming every undocumented API can be verified the same way.
        </p>
      </article>

      <article>
        <h2>Human in the loop — PRs, tests, and approval</h2>
        <p>
          A fair point (and part of the full MorphAPI design): the system does{" "}
          <strong>not</strong> silently push to <code>main</code>. It prepares
          a change; a human still owns the merge.
        </p>
        <ol>
          <li>
            <strong>Automated PR (full vision).</strong> After AST + LLM +
            oracle (+ ideally sandbox tests), MorphAPI opens a pull request —
            not a direct production deploy.
          </li>
          <li>
            <strong>Coder still approves.</strong> The developer reviews the
            diff, rationale, and verification badge, then merges or rejects.
            Humans stay the final strategic approver.
          </li>
          <li>
            <strong>Tests must pass.</strong> Environment-in-the-Loop: install
            deps, run the client’s unit/integration tests in a sandbox. No
            green tests → no trustworthy PR.
          </li>
          <li>
            <strong>What this baseline demo shows today.</strong> Live LLM-only
            vs hybrid on MorphPay: phantoms, typecheck, surgical apply. Full PR
            bot + sandbox test gate are later phases — same safety story.
          </li>
        </ol>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>What it proves</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Oracle / inspector</td>
                <td>Symbols exist in the target API (no phantoms)</td>
              </tr>
              <tr>
                <td>Typecheck / compile</td>
                <td>Patch is syntactically / typed-legal</td>
              </tr>
              <tr>
                <td>Test suite</td>
                <td>Behavior still matches intent</td>
              </tr>
              <tr>
                <td>Human PR review</td>
                <td>Architectural OK to merge</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="claim">
          MorphAPI reduces review from “hunt for hallucinated APIs” to “approve
          a verified migration PR.”
        </p>
      </article>

      <article className="innovation">
        <h2>FYP innovation — what is actually novel?</h2>
        <p className="lead-insight">
          In academic software engineering, innovation rarely comes from
          inventing a new parser. Trying to invent a “better AST algorithm”
          than Tree-sitter or the TypeScript compiler would be unnecessary.
          MorphAPI’s innovation is{" "}
          <strong>AST-Guided Constrained Generation</strong> and{" "}
          <strong>Bimodal Program Verification</strong> — using formal syntax
          trees as structural guardrails to bound, slice, and surgically repair
          code from non-deterministic language models.
        </p>

        <h3>The closed-loop triad</h3>
        <div className="triad">
          <div className="triad-card">
            <span className="triad-label">AST static parser</span>
            <strong>Scope &amp; surgical spans</strong>
            <p>WHERE to edit — exact call-site locality</p>
          </div>
          <div className="triad-arrow" aria-hidden>
            →
          </div>
          <div className="triad-card">
            <span className="triad-label">LLM generative AI</span>
            <strong>Semantic glue-code</strong>
            <p>WHAT to write — intent / builder translation</p>
          </div>
          <div className="triad-arrow" aria-hidden>
            →
          </div>
          <div className="triad-card">
            <span className="triad-label">Extracted oracle</span>
            <strong>Symbol verification</strong>
            <p>IF IT IS VALID — deterministic membership</p>
          </div>
        </div>

        <h3>Three technical pillars</h3>
        <div className="pillars">
          <div className="pillar">
            <h4>1. AST-Guided Scope Bounding</h4>
            <p>
              <strong>Problem:</strong> Raw LLM tools ingest entire files —
              high token cost, latency, and unwanted edits to unrelated code,
              comments, or formatting.
            </p>
            <p>
              <strong>Innovation:</strong> AST queries isolate the exact
              byte-offset span of the target API call. Vague “migrate this
              500-line module” becomes “rewrite this CallExpression spanning
              bytes 412–480.”
            </p>
            <p className="pillar-term">
              Formal term: AST-Guided Constrained Generation &amp; Span
              Isolation
            </p>
          </div>
          <div className="pillar">
            <h4>2. Surgical AST Splicing</h4>
            <p>
              <strong>Problem:</strong> Whole-file LLM rewrites often change
              indentation, strip comments, restyle variables, or break
              unrelated structure.
            </p>
            <p>
              <strong>Innovation:</strong> After oracle validation, splice the
              snippet into the exact span — surrounding file left untouched.
            </p>
            <p className="pillar-term">
              Formal term: Surgical Program Repair via Byte-Offset AST Splicing
            </p>
          </div>
          <div className="pillar">
            <h4>3. Triad Verification (AST + LLM + Oracle)</h4>
            <p>
              <strong>Problem:</strong> Scaffolding hallucination — plausible
              patches with phantom symbols that are not in the target API.
            </p>
            <p>
              <strong>Innovation:</strong> Closed loop — AST = WHERE, LLM =
              WHAT, Oracle = IF VALID — before code is saved or executed.
            </p>
            <p className="pillar-term">
              Formal term: Deterministic Oracle-Based Symbol Verification /
              Pre-Execution Scaffolding Hallucination Mitigation
            </p>
          </div>
        </div>

        <h3>Academic terminology cheat-sheet</h3>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Informal</th>
                <th>Formal term for thesis / defense</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AST restricts where the LLM edits</td>
                <td>
                  AST-Guided Constrained Generation &amp; Span Isolation
                </td>
              </tr>
              <tr>
                <td>Replace only exact lines; keep formatting</td>
                <td>
                  Surgical Program Repair via Byte-Offset AST Splicing
                </td>
              </tr>
              <tr>
                <td>SDK JSON catches fake methods</td>
                <td>Deterministic Oracle-Based Symbol Verification</td>
              </tr>
              <tr>
                <td>Catch AI hallucinations before running code</td>
                <td>
                  Pre-Execution Scaffolding Hallucination Mitigation
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Summary roles</h3>
        <div className="diff-table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>Element</th>
                <th>Responsibility</th>
                <th>Why essential</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>AST parser</td>
                <td>Target locality &amp; surgical splice</td>
                <td>Exact edit boundaries; no surrounding churn</td>
              </tr>
              <tr>
                <td>Generative LLM</td>
                <td>Semantic adaptation</td>
                <td>
                  Non-1-to-1 shifts, builders, object transforms
                </td>
              </tr>
              <tr>
                <td>Extracted oracle</td>
                <td>Symbol truth</td>
                <td>
                  Eliminates scaffolding hallucinations / phantoms
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Meeting script (for your professor)</h3>
        <blockquote className="meeting-script">
          <p>
            Professor, we are not claiming to invent a novel AST algorithm — we
            use industry-standard parsers such as the TypeScript Compiler API
            (and similarly Tree-sitter-class tools). Our core technical
            innovation is <em>AST-Guided Constrained Generation</em>.
          </p>
          <p>
            First, we use the AST as a structural guardrail to isolate the
            exact target call-site span. That shrinks the LLM prompt to a small
            snippet, lowering token cost and stopping the model from
            hallucinating edits elsewhere in the file.
          </p>
          <p>
            Second, the LLM performs the semantic translation of that isolated
            span.
          </p>
          <p>
            Third, an inspector cross-references the generated patch against an
            extracted API oracle to deterministically catch phantom symbols
            before any code is saved or executed.
          </p>
          <p>
            The AST is special not as a new parsing algorithm, but as a precise
            bounding mechanism and surgical editor for generative AI.
          </p>
        </blockquote>
      </article>
    </section>
  );
}
