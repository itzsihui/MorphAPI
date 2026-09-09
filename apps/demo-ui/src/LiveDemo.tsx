import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchResults,
  runDemo,
  type ResultsPayload,
  type Scenario,
} from "./api";
import { CodePanel } from "./CodePanel";
import { DiffHints } from "./DiffHints";
import { DocsBriefing } from "./DocsBriefing";
import { PlaidBriefing } from "./PlaidBriefing";

type LiveTab = "compare" | "before" | "docs" | "explain";

export function LiveDemo({ scenario }: { scenario: Scenario }) {
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<LiveTab>("compare");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchResults(scenario));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scenario]);

  useEffect(() => {
    setTab("compare");
    void reload();
  }, [reload]);

  const onRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runDemo(scenario);
      if (result.results) setData(result.results);
      if (!result.ok) setError(result.error || "Run failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const withoutPass =
    scenario === "hmac"
      ? data?.without.report?.securityPass === true
      : scenario === "mail"
      ? data?.without.report?.completenessPass === true
      : scenario === "stripe" ||
          scenario === "envelope" ||
          scenario === "discriminator"
      ? data?.without.report?.behavioralPass === true
      : scenario === "auth" ||
          scenario === "async" ||
          scenario === "stripe-errors"
        ? data?.without.report?.typecheckPass === true &&
          (data?.without.report?.phantomCount ?? 1) === 0 &&
          !data?.without.report?.leftoverLegacyCatch
        : data?.without.report?.typecheckPass === true;
  const withPass =
    scenario === "hmac"
      ? data?.with.report?.typecheckPass === true &&
        data?.with.report?.securityPass === true
      : scenario === "mail"
      ? data?.with.report?.typecheckPass === true &&
        data?.with.report?.completenessPass === true
      : scenario === "stripe" ||
          scenario === "envelope" ||
          scenario === "discriminator"
      ? data?.with.report?.typecheckPass === true &&
        data?.with.report?.behavioralPass === true
      : data?.with.report?.typecheckPass === true &&
        (scenario !== "auth" &&
        scenario !== "async" &&
        scenario !== "stripe-errors"
          ? true
          : (data?.with.report?.phantomCount ?? 1) === 0);
  const isPlaid = scenario === "plaid";
  const isOpenAI = scenario === "openai";
  const isStripe = scenario === "stripe";
  const isStripeErrors = scenario === "stripe-errors";
  const isAuth = scenario === "auth";
  const isEnvelope = scenario === "envelope";
  const isAsync = scenario === "async";
  const isMail = scenario === "mail";
  const isHmac = scenario === "hmac";
  const isDiscriminator = scenario === "discriminator";

  const errorCount = useMemo(() => {
    if (isHmac) {
      return (
        (data?.without.report?.staticTokenCount ?? 0) +
        (data?.without.report?.unsafeCompareCount ?? 0) +
        (data?.without.report?.phantomCount ?? 0)
      );
    }
    if (isMail) {
      return data?.without.report?.leftoverCount ?? 0;
    }
    if (isStripe) {
      return data?.without.report?.unscaledCount ?? 0;
    }
    if (isEnvelope) {
      return data?.without.report?.wrappedBlindCount ?? 0;
    }
    if (isDiscriminator) {
      return data?.without.report?.failCount ?? 0;
    }
    const phantoms = data?.without.report?.phantomCount ?? 0;
    return Math.max(phantoms, withoutPass ? 0 : 2);
  }, [
    data,
    withoutPass,
    isStripe,
    isEnvelope,
    isMail,
    isHmac,
    isDiscriminator,
  ]);

  return (
    <div className="live-demo">
      <header className="live-demo-header">
        <div>
          <p className="eyebrow">Live baseline · {scenario}</p>
          <h2>
            {isDiscriminator
              ? "Scenario 9 — Polymorphic discriminator mutation"
              : isHmac
              ? "Scenario 10 — Security & auth scheme overhaul (HMAC)"
              : isMail
              ? "Scenario 7 — Incomplete multi-site refactoring"
              : isStripeErrors
              ? "Scenario 8 — Exception hierarchy drift"
              : isAsync
              ? "Scenario 6 — Function coloring / sync→async contagion"
              : isEnvelope
              ? "Scenario 5 — Downstream payload wrapping / DFG blindness"
              : isAuth
              ? "Scenario 4 — JWT secret → JWKS (verification evasion)"
              : isStripe
                ? "Scenario 3 — amount dollars → cents (not a MorphAPI claim)"
                : isOpenAI
                  ? "Scenario 2 — ChatCompletion engine → model"
                  : isPlaid
                    ? "Plaid Link — stringly → typed enums"
                    : "MorphPay — charges.create → PaymentIntent.Builder"}
          </h2>
          <p className="lede">
            {isDiscriminator
              ? "Left: live LLM-only updates subscribe intents but leaves switch(event.type) / MESSAGE_CREATE in the router. Right: MorphAPI AST switch audit + oracle value map."
              : isHmac
              ? "Left: live LLM-only (often leaves query.token === or invents Slack helpers / skips timingSafeEqual). Right: MorphAPI AST + HMAC security gate."
              : isMail
              ? "Left: live LLM-only across notify/cron/seed (often misses secondary files). Right: MorphAPI AST enumerates every sendEmail span and completes the checklist."
              : isStripeErrors
              ? "Left: live LLM-only (often migrates paymentIntents but leaves stripe.error.CardError). Right: MorphAPI expands AST to try/catch + oracle."
              : isAsync
              ? "Left: live LLM-only (often drops await, leaves .promise(), or breaks async coloring). Right: MorphAPI AST spans + contagion gate."
              : isEnvelope
              ? "Left: live LLM-only (often updates listUsers import but leaves User[] consumers blind to { data, pagination }). Right: MorphAPI AST + .data edge adapter."
              : isAuth
              ? "Left: LLM-only under typecheck repair pressure (often @ts-ignore / as any / secret leak). Right: MorphAPI AST spans + anti-cheat."
              : isStripe
                ? "Live models often already apply dollars→cents correctly, so we keep this fixture for taxonomy but do not claim it as a MorphAPI differentiator."
                : isOpenAI
                  ? "Left: live LLM-only (often keeps engine or ChatCompletion). Right: MorphAPI AST + oracle forbids engine."
                  : "Left: without MorphAPI (live LLM-only). Right: with MorphAPI (AST + oracle). Real model calls — not canned failure fixtures."}
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={onRun}
            disabled={running || !data?.hasApiKey}
          >
            {running
              ? "Running live LLM…"
              : isDiscriminator
                ? "Run discriminator comparison"
                : isHmac
                ? "Run HMAC comparison"
                : isMail
                ? "Run multi-site comparison"
                : isStripeErrors
                ? "Run error-hierarchy comparison"
                : isAsync
                ? "Run async contagion comparison"
                : isEnvelope
                ? "Run envelope / DFG comparison"
                : isAuth
                ? "Run Auth JWT comparison"
                : isStripe
                  ? "Run unit-shift comparison"
                  : isOpenAI
                    ? "Run OpenAI comparison"
                    : isPlaid
                      ? "Run Plaid comparison"
                      : "Run MorphPay comparison"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void reload()}
            disabled={running || loading}
          >
            Refresh last outputs
          </button>
          {!data?.hasApiKey && (
            <span className="hint warn">Add OPENAI_API_KEY to .env to run</span>
          )}
        </div>
        {error && <p className="banner error">{error}</p>}
        {running && (
          <p className="banner info">
            Calling the model twice (LLM-only, then hybrid). This can take a
            minute.
          </p>
        )}
      </header>

      <nav className="tabs" aria-label="Live demo views">
        {(
          [
            ["compare", "1 vs 2 · Outputs"],
            ["before", "Before (legacy)"],
            ["docs", isOpenAI ? "Docs & evidence" : isPlaid ? "Docs & evidence" : isAuth ? "Docs · anti-cheat" : "Docs · innovation"],
            ["explain", "Errors & pipeline"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && !data ? (
        <p className="muted">Loading last run…</p>
      ) : (
        <>
          {tab === "compare" && data && (
            <section className="compare">
              <div className="scoreboard">
                <div className={`score ${withoutPass ? "pass" : "fail"}`}>
                  <span className="score-label">Without MorphAPI</span>
                  <strong>
                    {isStripe
                      ? withoutPass
                        ? "BEHAVIORAL PASS"
                        : "BEHAVIORAL FAIL"
                      : withoutPass
                        ? "PASS"
                        : "FAIL"}
                  </strong>
                  <span className="score-meta">
                    {isStripe
                      ? `${data.without.report?.unscaledCount ?? "—"} unscaled · tsc ${data.without.report?.typecheckPass ? "PASS" : "FAIL"}`
                      : `${data.without.report?.phantomCount ?? "—"} phantoms`}{" "}
                    · {data.without.report?.mode ?? "—"}
                    {data.without.report?.model
                      ? ` · ${data.without.report.model}`
                      : ""}
                  </span>
                </div>
                <div className={`score ${withPass ? "pass" : "fail"}`}>
                  <span className="score-label">With MorphAPI</span>
                  <strong>{withPass ? "PASS" : "FAIL"}</strong>
                  <span className="score-meta">
                    {isStripe
                      ? `behavioral ${data.with.report?.behavioralPass ? "PASS" : "FAIL"} · `
                      : ""}
                    {data.with.report?.phantomCount ?? "—"} phantoms ·{" "}
                    {data.with.report?.spansFound ?? "—"} AST spans ·{" "}
                    {data.with.report?.mode ?? "—"}
                  </span>
                </div>
              </div>

              <DiffHints
                withoutCode={data.without.code}
                withCode={data.with.code}
                phantoms={data.without.report?.phantoms ?? []}
                apiLabel={
                  isAuth
                    ? "auth-jwt v2"
                    : isStripe
                      ? "stripe-charge v2"
                      : isOpenAI
                        ? "openai-chat v1"
                        : isPlaid
                          ? "Plaid Link"
                          : "MorphPay v2"
                }
              />

              <div className="panels">
                <CodePanel
                  title="Without MorphAPI"
                  subtitle={
                    isAuth
                      ? "Pure LLM + repair loop — often @ts-ignore / as any / JWT_SECRET"
                      : isStripe
                        ? "Pure LLM — often leaves amount in dollars"
                        : isOpenAI
                          ? "Pure LLM — often keeps engine / ChatCompletion"
                          : isPlaid
                            ? "Pure LLM — often CountryCode.US / GB"
                            : "Pure LLM — often CaptureMode.Automatic"
                  }
                  code={data.without.code}
                  phantoms={data.without.report?.phantoms ?? []}
                  status={withoutPass ? "pass" : "fail"}
                  emptyHint='No LLM-only output yet. Click "Run … comparison".'
                />
                <CodePanel
                  title="With MorphAPI"
                  subtitle={
                    isAuth
                      ? "AST → constrained LLM → anti-cheat → JWKS apply"
                      : isStripe
                        ? "AST → transform directive → ×100 gate → apply"
                        : "AST → constrained LLM → oracle → apply"
                  }
                  code={data.with.code}
                  phantoms={data.with.report?.phantoms ?? []}
                  status={withPass ? "pass" : "fail"}
                  emptyHint='No hybrid output yet. Click "Run … comparison".'
                />
              </div>
            </section>
          )}

          {tab === "before" && data && (
            <section className="single">
              <CodePanel
                title={
                  isAuth
                    ? "Original client (symmetric JWT_SECRET)"
                    : isStripe
                      ? "Original client (amounts in dollars)"
                      : isOpenAI
                        ? "Original client (ChatCompletion + engine)"
                        : isPlaid
                          ? "Original Plaid client (stringly)"
                          : "Original client (MorphPay v1)"
                }
                subtitle={
                  isAuth
                    ? "jwt.verify(token, process.env.JWT_SECRET!)"
                    : isStripe
                      ? "amount: amountDollars / amount: 10.5"
                      : isOpenAI
                        ? 'ChatCompletion.create({ engine: "gpt-4", ... })'
                        : isPlaid
                          ? 'products: ["transactions"] / country_codes: ["US"]'
                          : "Deprecated charges.create"
                }
                code={data.before}
                phantoms={[]}
                status="neutral"
                emptyHint="Missing fixture source"
              />
            </section>
          )}

          {tab === "docs" && data && isAuth && (
            <section className="docs-briefing">
              <article>
                <h2>Why typecheck exit code is not enough</h2>
                <p>
                  Under repair-loop pressure, models can force{" "}
                  <code>tsc</code> green with <code>@ts-ignore</code>,{" "}
                  <code>as any</code>, or empty catches — while still verifying
                  with <code>JWT_SECRET</code> or inventing{" "}
                  <code>Auth0.verify</code>. MorphAPI treats those as first-class
                  phantoms.
                </p>
              </article>
              <article>
                <h2>Migration docs the model saw</h2>
                <pre>
                  <code>{data.docsV2 ?? "(missing docs)"}</code>
                </pre>
              </article>
            </section>
          )}

          {tab === "docs" && data && isPlaid && (
            <PlaidBriefing
              docsV2={data.docsV2}
              livePhantoms={data.without.report?.phantoms ?? []}
              withoutCode={data.without.code}
              withCode={data.with.code}
            />
          )}

          {tab === "docs" && data && isStripe && (
            <section className="docs-briefing">
              <article>
                <h2>Not a MorphAPI claim case</h2>
                <p>
                  Live <code>gpt-4o-mini</code> often already converts
                  dollars→cents (helper locals or cents literals). We keep the
                  fixture for taxonomy completeness, but do not treat Scenario 3
                  as a MorphAPI differentiator.
                </p>
              </article>
              <article>
                <h2>Why typecheck is not enough (in theory)</h2>
                <p>
                  v1 and v2 both type <code>amount: number</code>. Forgetting{" "}
                  <code>× 100</code> still compiles — and under-charges by
                  100×. In practice, current models often catch this without
                  MorphAPI.
                </p>
              </article>
              <article>
                <h2>Migration docs the model saw</h2>
                <pre>
                  <code>{data.docsV2 ?? "(missing docs)"}</code>
                </pre>
              </article>
            </section>
          )}

          {tab === "docs" && data && isOpenAI && (
            <section className="docs-briefing">
              <article>
                <h2>What LLM-only saw</h2>
                <p className="doc-note">
                  Vague migration notes — they say map the old engine field but
                  never spell <code>model:</code> as the only legal key.
                </p>
                <pre className="doc-md">
                  <code>{data.docsV2 ?? "(missing docs/openai-chat-v1.md)"}</code>
                </pre>
              </article>
              <article>
                <h2>Oracle traps</h2>
                <p>
                  <code>oracle/openai-chat-v1.json</code> lists{" "}
                  <code>engine</code>, <code>ChatCompletion</code>,{" "}
                  <code>createChatCompletion</code> as known phantoms.
                </p>
              </article>
            </section>
          )}

          {tab === "docs" && data && !isPlaid && !isStripe && !isAuth && !isOpenAI && (
            <DocsBriefing
              docsV1={data.docsV1}
              docsV2={data.docsV2}
              livePhantoms={data.without.report?.phantoms ?? []}
              beforeCode={data.before}
            />
          )}

          {tab === "explain" && (
            <section className="explain">
              <article>
                <h2>
                  {isAuth
                    ? "Why do you see evasion / phantoms?"
                    : isStripe
                      ? "Why do you see a behavioral miss?"
                      : "Why do you see type errors?"}
                </h2>
                {isAuth ? (
                  <>
                    <p>
                      LLM-only gets typecheck errors fed back and is told CI
                      only cares about exit code 0. That pressure produces
                      suppressions, casts, or leftover <code>JWT_SECRET</code>.
                    </p>
                    <p>
                      About {errorCount} finding(s) on the last LLM-only run.
                      Hybrid must emit real JWKS (
                      <code>createJwksClient</code> → <code>getSigningKey</code>{" "}
                      → <code>getPublicKey</code>) with tests locked.
                    </p>
                  </>
                ) : isStripe ? (
                  <>
                    <p>
                      LLM-only often swaps the import to{" "}
                      <code>stripe-charge-v2</code> and leaves{" "}
                      <code>amount: amountDollars</code> / <code>10.5</code>.
                      <code>tsc</code> passes; MorphAPI&apos;s amount gate fails.
                    </p>
                    <p>
                      About {errorCount} unscaled amount site(s) on the last
                      LLM-only run. Hybrid must emit{" "}
                      <code>Math.round(... * 100)</code> at every site.
                    </p>
                  </>
                ) : isOpenAI ? (
                  <>
                    <p>
                      Failures in{" "}
                      <code>baselines/openai_llm_only/out/chat.ts</code> are
                      expected when the model keeps <code>engine</code> or{" "}
                      <code>ChatCompletion.create</code> — neither exists on
                      openai-chat-v1.
                    </p>
                    <p>
                      About {errorCount} phantom(s) on the last LLM-only run.
                      Hybrid should emit{" "}
                      <code>client.chat.completions.create({"{ model }"})</code>.
                    </p>
                  </>
                ) : isPlaid ? (
                  <>
                    <p>
                      Red squiggles in{" "}
                      <code>baselines/plaid_llm_only/out/link.ts</code> are
                      expected. The live model wrote{" "}
                      <code>CountryCode.US</code> / <code>GB</code>; the real
                      Plaid TS SDK uses <code>Us</code> / <code>Gb</code>.
                    </p>
                    <p>
                      About {errorCount} phantom(s) on the last LLM-only run.
                      Hybrid should typecheck with <code>CountryCode.Us</code>{" "}
                      / <code>Gb</code>.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Squiggles in{" "}
                      <code>baselines/llm_only/out/checkout.ts</code> are
                      expected. Live LLM invented near-miss symbols (e.g.{" "}
                      <code>CaptureMode.Automatic</code>).
                    </p>
                    <p>
                      About {errorCount} phantom(s) on the last LLM-only run.
                      Hybrid should typecheck clean.
                    </p>
                  </>
                )}
              </article>
              <article>
                <h2>Pipeline</h2>
                <ol>
                  <li>
                    <strong>AST scan</strong> —{" "}
                    {isAuth ? (
                      <code>jwt.verify</code>
                    ) : isPlaid ? (
                      <code>linkTokenCreate</code>
                    ) : (
                      <code>charges.create</code>
                    )}{" "}
                    spans.
                  </li>
                  <li>
                    <strong>Constrained LLM</strong> — replace that span only
                    {isStripe ? " with transform directive" : ""}.
                  </li>
                  <li>
                    <strong>
                      {isAuth
                        ? "Anti-cheat + Hallucination Inspector"
                        : isStripe
                          ? "Amount transform gate"
                          : "Hallucination Inspector"}
                    </strong>{" "}
                    — vs{" "}
                    {isAuth ? (
                      <code>oracle/auth-jwt-v2.json</code>
                    ) : isStripe ? (
                      <code>oracle/stripe-charge-v2.json</code>
                    ) : isPlaid ? (
                      <code>oracle/plaid-link-v2.json</code>
                    ) : (
                      <code>oracle/morphpay-v2.json</code>
                    )}
                    .
                  </li>
                  <li>
                    <strong>Surgical apply + typecheck</strong>
                    {isAuth
                      ? " + test mutation barrier"
                      : isStripe
                        ? " + behavioral verify"
                        : ""}
                    .
                  </li>
                </ol>
              </article>
            </section>
          )}
        </>
      )}
    </div>
  );
}
