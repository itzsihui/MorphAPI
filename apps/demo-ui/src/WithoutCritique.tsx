import type { Report, Scenario } from "./api";

type Critique = {
  headline: string;
  summary: string;
  bullets: string[];
};

function phantomList(report: Report | null | undefined, limit = 4): string {
  const syms = (report?.phantoms ?? []).map((p) => p.symbol).filter(Boolean);
  if (syms.length === 0) return "";
  return syms.slice(0, limit).join(", ") + (syms.length > limit ? "…" : "");
}

function buildCritique(
  scenario: Scenario,
  report: Report | null | undefined,
  withoutPass: boolean
): Critique {
  const phantoms = phantomList(report);
  const tscFail = report?.typecheckPass === false;

  switch (scenario) {
    case "morphpay":
      return {
        headline: "What's wrong without MorphAPI",
        summary: tscFail
          ? "Pure LLM migrates toward a Builder shape but invents near-miss scaffolding that fails typecheck."
          : "Pure LLM output still drifts from the MorphPay v2 oracle.",
        bullets: [
          phantoms
            ? `Inspector flagged phantoms: ${phantoms} (not in oracle/morphpay-v2.json).`
            : "No CaptureMode / Builder symbols matched the trusted oracle.",
          "Typical miss: CaptureMode.Automatic / Manual instead of AUTOMATIC / MANUAL.",
          "Whole-file rewrite — no AST span lock — so illegal names land before tsc.",
          withoutPass
            ? "This run happened to typecheck; re-run — scaffolding hallucination is frequent, not guaranteed every seed."
            : "Typecheck FAIL — migration is not shippable without manual cleanup.",
        ],
      };

    case "plaid":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Docs teach wire values (US/GB); the TypeScript SDK needs enum members (Us/Gb). Pure LLM confuses the two.",
        bullets: [
          phantoms
            ? `Phantoms: ${phantoms} — illegal enum members vs plaid-link-v2 oracle.`
            : "Enum membership did not match CountryCode.Us / Products.* from the SDK oracle.",
          "CountryCode.US / GB looks “right” from HTTP docs but is wrong for the TS client.",
          "Without an SDK oracle gate, the model optimizes for readable docs, not .d.ts members.",
          tscFail
            ? "Typecheck FAIL — Link token create will not compile."
            : "Even if tsc passes, enum drift is the failure mode MorphAPI targets.",
        ],
      };

    case "openai":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Legacy ChatCompletion / engine memory bleeds into the v1 migration; constructor and call shape often break.",
        bullets: [
          phantoms
            ? `Phantoms: ${phantoms}.`
            : "Inspector may show 0 phantoms while tsc still fails (e.g. new OpenAI(string) vs { apiKey }).",
          "Common leftover: engine: or ChatCompletion.create instead of chat.completions.create({ model }).",
          "Full-file generation drops surgical safety — one wrong constructor fails the package.",
          tscFail
            ? "Typecheck FAIL on this run."
            : "Gate may pass; watch for deprecated call shapes on re-runs.",
        ],
      };

    case "stripe":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Symbols and types can look fine while amounts stay in dollars — a silent behavioral break.",
        bullets: [
          report?.behavioralPass === false
            ? `Behavioral FAIL: ${report.unscaledCount ?? "?"} amount site(s) not scaled to cents.`
            : "Amount scaling is the claim metric (not phantom symbols).",
          "tsc can PASS while charges still send 10.5 instead of 1050.",
          "OpenAPI “number” alone does not encode dollars→cents; needs a transform gate.",
          withoutPass
            ? "This run scaled correctly — models sometimes catch unit shift; MorphAPI still enforces it."
            : "Ship risk: undercharge / overcharge without a compile error.",
        ],
      };

    case "auth":
      return {
        headline: "What's wrong without MorphAPI",
        summary: withoutPass
          ? "LLM-only may typecheck after a repair loop, but the migration is noisier and weaker under anti-cheat pressure."
          : "Under typecheck pressure, pure LLM often cheats or leaves a broken JWKS migration.",
        bullets: [
          report?.evasionCount && report.evasionCount > 0
            ? `Evasion tactics detected (${report.evasionCount}) — @ts-ignore / as any / secret leak patterns.`
            : "Repair loops reward “make tsc green,” not a trustworthy JWKS verify path.",
          "Whole-file rewrite: verbose intermediates, dropped usage-site comments, missing jwksUri fallbacks.",
          "May keep or reintroduce JWT_SECRET-shaped thinking even when JWKS APIs appear.",
          "MorphAPI locks jwt.verify spans + forbids cheat markers + requires createJwksClient → getSigningKey → getPublicKey.",
        ],
      };

    case "envelope":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Edge listUsers may “upgrade,” but consumers still treat the response as User[] — DFG blindness.",
        bullets: [
          report?.behavioralPass === false
            ? `Behavioral FAIL: ${report.wrappedBlindCount ?? "?"} consumer site(s) still blind to { data, pagination }.`
            : "Envelope unwrap (.data) is the success metric.",
          "LLM often edits only the edge file and leaves users.ts / callers on the old shape.",
          tscFail
            ? "Typecheck FAIL when the envelope type no longer matches flat User[]."
            : "Even with green tsc on a partial edit, runtime pagination/data access breaks.",
          "MorphAPI adds an edge .data adapter so downstream stays typed without rewriting every consumer.",
        ],
      };

    case "async":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Sync→async / client.send(Command) migrations drop await or leave .promise() — contagion up the call stack.",
        bullets: [
          phantoms
            ? `Issues: ${phantoms}.`
            : "Missing await, leftover .promise(), or broken async coloring on callers.",
          "Leaf fix without propagating async to app.ts / callers leaves pending Promises.",
          tscFail
            ? "Typecheck FAIL on this run."
            : "Logic bugs can hide if types are loose.",
          "MorphAPI AST spans + contagion gate require a consistent async stack.",
        ],
      };

    case "mail":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Multi-file sendEmail→send migrations are incomplete — secondary sites (cron/seed) left on the legacy API.",
        bullets: [
          report?.completenessPass === false
            ? `Completeness FAIL: ${report.leftoverCount ?? "?"} leftover sendEmail site(s) (migrated ${report.migratedCount ?? "?"}/${report.expectedSites ?? "?"}).`
            : "Completeness checklist is the claim metric.",
          phantoms
            ? `Leftover symbols: ${phantoms}.`
            : "tsc can PASS while sendEmail remains in sibling files.",
          "Pure LLM focuses on the file in the prompt and misses notify/cron/seed siblings.",
          "MorphAPI enumerates every sendEmail span and blocks until the checklist is clean.",
        ],
      };

    case "stripe-errors":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Happy-path create() migrates; catch blocks keep stripe.error.CardError — declines become unhandled.",
        bullets: [
          report?.leftoverLegacyCatch
            ? "Leftover legacy catch: stripe.error.CardError still present."
            : "Legacy error-class paths are the core failure mode.",
          phantoms
            ? `Phantoms: ${phantoms}.`
            : "Inspector looks for stripe.error.* / CardError traps.",
          "Focus bias: models update paymentIntents.create and leave instanceof handlers stale.",
          tscFail
            ? "Typecheck FAIL — legacy error module is gone on v2."
            : "Runtime: declined cards bypass the handler and crash or mis-route.",
        ],
      };

    case "discriminator":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Listener registration updates, but switch/case type guards keep the old discriminator — fallthrough bugs.",
        bullets: [
          report?.behavioralPass === false
            ? `Behavioral FAIL: ${report.failCount ?? "?"} discriminator site(s) still wrong.`
            : "Router / switch exhaustiveness is the claim metric.",
          "Typical leftover: event.type / MESSAGE_CREATE while the edge uses event_type.",
          "LLM edits subscribe.ts and leaves router.ts on the legacy discriminator.",
          tscFail
            ? "Typecheck FAIL when narrowed types no longer match."
            : "Silent fallthrough at runtime if types are stringly.",
        ],
      };

    case "hmac":
      return {
        headline: "What's wrong without MorphAPI",
        summary:
          "Token / shared-secret checks look “migrated” but keep static compare or skip HMAC + timing-safe equality.",
        bullets: [
          report?.securityPass === false
            ? `Security FAIL: staticToken=${report.staticTokenCount ?? 0}, unsafeCompare=${report.unsafeCompareCount ?? 0}.`
            : "securityPass (HMAC + timingSafeEqual) is the claim metric.",
          "Common miss: token === process.env.WEBHOOK_TOKEN instead of createHmac verify.",
          tscFail
            ? "Typecheck FAIL on this run."
            : "Green tsc does not mean the auth scheme is safe.",
          "MorphAPI security gate rejects static token equality and requires the HMAC path.",
        ],
      };

    default:
      return {
        headline: "What's wrong without MorphAPI",
        summary: "Pure LLM output failed the scenario success gate.",
        bullets: [
          phantoms ? `Phantoms: ${phantoms}.` : "See report.json for details.",
          tscFail ? "Typecheck FAIL." : "Check behavioral / completeness / security gates.",
        ],
      };
  }
}

export function WithoutCritique({
  scenario,
  report,
  withoutPass,
}: {
  scenario: Scenario;
  report: Report | null | undefined;
  withoutPass: boolean;
}) {
  const critique = buildCritique(scenario, report, withoutPass);
  const tone = withoutPass ? "soft" : "hard";

  return (
    <aside className={`without-critique ${tone}`} aria-label={critique.headline}>
      <h3>{critique.headline}</h3>
      <p className="without-critique-summary">{critique.summary}</p>
      <ul>
        {critique.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {withoutPass ? (
        <p className="without-critique-note">
          Scoreboard may show PASS for this seed — MorphAPI still wins on
          locality, oracle constraints, and anti-cheat / semantic gates.
        </p>
      ) : null}
    </aside>
  );
}
