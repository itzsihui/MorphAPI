export type ScenarioCategory =
  | "syntactic"
  | "behavioral"
  | "verification"
  | "concurrency"
  | "security";

export type DemoStatus = "live" | "taxonomy";

export type LiveScenarioId =
  | "morphpay"
  | "plaid"
  | "openai"
  | "stripe"
  | "stripe-errors"
  | "auth"
  | "envelope"
  | "async"
  | "mail"
  | "hmac"
  | "discriminator";

export type ScenarioCase = {
  id: string;
  number: string;
  title: string;
  category: ScenarioCategory;
  categoryLabel: string;
  provider: string;
  demoStatus: DemoStatus;
  /** When live, maps to server scenario */
  liveId?: LiveScenarioId;
  summary: string;
  contractDelta: string;
  aiAloneFails: string;
  astAloneFails: string;
  hybridWins: string;
  morphapiNeeds: string[];
  beforeSnippet: string;
  afterSnippet: string;
  phantomExample?: string;
  /** Measured live phantoms from last repo run (only for live cases) */
  liveEvidence?: {
    model: string;
    phantoms: string[];
    typecheck: "FAIL" | "PASS";
    reportPath: string;
  };
  references: Array<{ label: string; href: string; note?: string }>;
};

export const SCENARIOS: ScenarioCase[] = [
  {
    id: "morphpay-scaffolding",
    number: "1a",
    title: "Builder scaffolding hallucination",
    category: "syntactic",
    categoryLabel: "Syntactic & structural contract",
    provider: "MorphPay (synthetic FYP fixture — Stripe-like Builder)",
    demoStatus: "live",
    liveId: "morphpay",
    summary:
      "v1 charges.create(capture: boolean) → v2 PaymentIntent.Builder + CaptureMode.AUTOMATIC|MANUAL. Live gpt-4o-mini invents near-miss enum members.",
    contractDelta:
      "charges.create removed. New surface: PaymentIntent.Builder, setCaptureMode(CaptureMode.AUTOMATIC|MANUAL), morphpay.intents.confirm.",
    aiAloneFails:
      "Model migrates the call shape but invents CaptureMode.Automatic / Manual (PascalCase) instead of AUTOMATIC / MANUAL — classic scaffolding hallucination.",
    astAloneFails:
      "Pure rename rules cannot synthesize multi-step Builder chaining or decide AUTOMATIC vs MANUAL from capture: true/false without semantic mapping.",
    hybridWins:
      "AST finds charges.create spans → constrained LLM → oracle/morphpay-v2.json rejects phantoms → surgical apply → tsc PASS.",
    morphapiNeeds: [
      "Oracle: oracle/morphpay-v2.json (enum members + knownPhantoms)",
      "AST: findChargesCreateSpans",
      "Inspector: reject CaptureMode.Automatic / Manual / IMMEDIATE",
    ],
    beforeSnippet: `const charge = await morphpay.charges.create({
  amount: amountCents,
  currency: "usd",
  source: cardToken,
  capture: true,
});`,
    afterSnippet: `const charge = await morphpay.intents.confirm(
  new PaymentIntent.Builder()
    .setAmount(amountCents)
    .setCurrency("usd")
    .setPaymentMethod(cardToken)
    .setCaptureMode(CaptureMode.AUTOMATIC)
    .build()
);`,
    phantomExample: "CaptureMode.Automatic  // not a member — real is AUTOMATIC",
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: ["CaptureMode.Automatic", "CaptureMode.Manual"],
      typecheck: "FAIL",
      reportPath: "baselines/llm_only/out/report.json",
    },
    references: [
      {
        label: "Fixture (legacy client)",
        href: "/fixtures/client-v1/src/checkout.ts",
        note: "Repo path — open in IDE",
      },
      {
        label: "Oracle",
        href: "/oracle/morphpay-v2.json",
        note: "Allowed symbols + known phantoms",
      },
      {
        label: "Vague docs given to LLM",
        href: "/docs/morphpay-v2.md",
      },
    ],
  },
  {
    id: "plaid-enum-scaffolding",
    number: "1b",
    title: "Enum scaffolding — docs teach US, SDK needs Us",
    category: "syntactic",
    categoryLabel: "Syntactic & structural contract",
    provider: "Plaid Link (real TS SDK enum shapes from plaid@30)",
    demoStatus: "live",
    liveId: "plaid",
    summary:
      "Stringly country_codes: [\"US\"] → CountryCode.Us. Official docs list wire values US/GB; generated .d.ts uses Us/Gb. Live model wrote CountryCode.US.",
    contractDelta:
      "Legacy string products/country_codes → typed Products / CountryCode enums. Wire JSON stays \"US\"; TS member is Us.",
    aiAloneFails:
      "Given vague docs + legacy file only, gpt-4o-mini emitted CountryCode.US / GB (ISO identifiers). Typecheck: Did you mean 'Us'?",
    astAloneFails:
      "AST can find linkTokenCreate sites but cannot invent correct enum member names without an SDK/oracle allow-list.",
    hybridWins:
      "AST spans + oracle/plaid-link-v2.json (Us, Gb, …) + inspector → CountryCode.Us / Gb → tsc PASS.",
    morphapiNeeds: [
      "Oracle from published SDK enums (api.d.ts), not vague docs",
      "AST: findLinkTokenCreateSpans",
      "Inspector: reject CountryCode.US / GB / Products.TRANSACTIONS",
    ],
    beforeSnippet: `country_codes: ["US"],
products: ["transactions"],`,
    afterSnippet: `country_codes: [CountryCode.Us],
products: [Products.Transactions],`,
    phantomExample: 'CountryCode.US  // phantom — real member is Us = "US"',
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: ["CountryCode.US", "CountryCode.GB"],
      typecheck: "FAIL",
      reportPath: "baselines/plaid_llm_only/out/report.json",
    },
    references: [
      {
        label: "Plaid /link/token/create docs (wire values US, GB)",
        href: "https://plaid.com/docs/api/link/#linktokencreate",
      },
      {
        label: "plaid-openapi (2020-09-14.yml)",
        href: "https://github.com/plaid/plaid-openapi",
      },
      {
        label: "plaid-node (generated TS client)",
        href: "https://github.com/plaid/plaid-node",
      },
      {
        label: "Our oracle subset",
        href: "/oracle/plaid-link-v2.json",
      },
    ],
  },
  {
    id: "openai-deprecated-bias",
    number: "2",
    title: "Deprecated memory bias & stale parameters",
    category: "syntactic",
    categoryLabel: "Interface deprecation & parameter mutation",
    provider: "OpenAI-style chat (openai-chat-v0 → v1 in this repo)",
    demoStatus: "live",
    liveId: "openai",
    summary:
      "ChatCompletion.create({ engine }) → client.chat.completions.create({ model }). Live gpt-4o-mini often keeps engine or ChatCompletion.",
    contractDelta:
      "engine removed; model required. Nested client.chat.completions.create. ChatCompletion.create is not on v1.",
    aiAloneFails:
      "Given vague docs, models often hybridize: new OpenAI() but still pass engine, or keep ChatCompletion.create.",
    astAloneFails:
      "AST finds call sites but cannot invent the nested completions path without oracle constraints.",
    hybridWins:
      "AST ChatCompletion.create spans + oracle forbids engine → constrained LLM / fallback → tsc PASS.",
    morphapiNeeds: [
      "Oracle: oracle/openai-chat-v1.json (knownPhantoms: engine, ChatCompletion…)",
      "AST: findChatCompletionCreateSpans",
      "Negative constraints: FORBIDDEN engine",
    ],
    beforeSnippet: `await openai.ChatCompletion.create({
  engine: "gpt-4",
  messages: [{ role: "user", content: prompt }],
});`,
    afterSnippet: `await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: prompt }],
});`,
    phantomExample: 'new OpenAI(apiKeyString)  // v1 needs { apiKey } — live miss this run',
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: [
        "constructor: new OpenAI(string) instead of { apiKey } (tsc FAIL)",
      ],
      typecheck: "FAIL",
      reportPath: "baselines/openai_llm_only/out/report.json",
    },
    references: [
      {
        label: "Fixture (legacy client)",
        href: "/fixtures/openai-client-v0/src/chat.ts",
      },
      {
        label: "Oracle",
        href: "/oracle/openai-chat-v1.json",
      },
      {
        label: "Vague docs given to LLM",
        href: "/docs/openai-chat-v1.md",
      },
      {
        label: "OpenAI Node migration notes",
        href: "https://github.com/openai/openai-node/discussions/217",
      },
      {
        label: "openai-openapi",
        href: "https://github.com/openai/openai-openapi",
      },
    ],
  },
  {
    id: "stripe-unit-shift",
    number: "3",
    title: "Silent unit & semantic shifts",
    category: "behavioral",
    categoryLabel: "Behavioral break (often evades typecheckers)",
    provider: "Stripe-style amount (dollars → cents) / timestamp precision",
    demoStatus: "live",
    liveId: "stripe",
    summary:
      "Parameter name amount stays; unit changes (10.50 dollars → 1050 cents). Compilers still pass if the model forgets ×100. Live gpt-4o-mini often applies the conversion correctly, so we do not treat this as a MorphAPI claim case — fixture kept for taxonomy completeness only.",
    contractDelta:
      "Schema may still say integer/number; semantic unit flips. OpenAPI type alone may not show a break if type is unchanged.",
    aiAloneFails:
      "In theory: LLM sees identical identifier amount and leaves amount: amountDollars. In live runs: models often already insert Math.round(...*100) or cents literals — so AI alone frequently catches this scenario.",
    astAloneFails:
      "AST validates structure, not that the value must be ×100.",
    hybridWins:
      "Not a primary MorphAPI win here — live AI already handles dollars→cents often enough that we deprioritize this case.",
    morphapiNeeds: [
      "Oracle/migration rule: amount dollars→cents (optional; not a core claim)",
      "AST: assert transform expression at assign sites",
      "Future: Docker test loop for behavioral verification",
    ],
    beforeSnippet: `// Live fixture — dollars float
stripe.charges.create({ amount: amountDollars, currency: "usd", source });`,
    afterSnippet: `// Live hybrid — integer cents
stripe.charges.create({ amount: Math.round(amountDollars * 100), currency: "usd", source });`,
    references: [
      {
        label: "Stripe API — amounts in smallest currency unit",
        href: "https://docs.stripe.com/currencies#zero-decimal",
      },
    ],
  },
  {
    id: "reward-hacking",
    number: "4",
    title: "Reward hacking & test evasion",
    category: "verification",
    categoryLabel: "Verification evasion",
    provider: "Auth0 / JWT verification (symmetric → JWKS)",
    demoStatus: "live",
    liveId: "auth",
    summary:
      "Under typecheck-feedback loops, agents may add @ts-ignore / as any, invent Auth0.verify, or keep JWT_SECRET instead of real JWKS. Live repair-loop baseline vs MorphAPI anti-cheat.",
    contractDelta:
      "jwt.verify(token, secret) → async JWKS getSigningKey + PublicKey-branded verify.",
    aiAloneFails:
      "Smarter agents under CI pressure discover loopholes: @ts-ignore, as any, empty catch, phantom helpers — or leave secret verify and fail types.",
    astAloneFails:
      "AST cannot invent JWKS caching logic alone; also needs anti-cheat policies.",
    hybridWins:
      "AST locks jwt.verify spans + test mutation barrier; forbid @ts-ignore / as any / JWT_SECRET; oracle requires createJwksClient → getSigningKey → getPublicKey.",
    morphapiNeeds: [
      "Mutation barrier on verify.test.ts",
      "Diff scanner for suppression comments / as any",
      "Oracle: allowed auth APIs only",
    ],
    beforeSnippet: `jwt.verify(token, process.env.JWT_SECRET!);`,
    afterSnippet: `jwt.verify(
  token,
  (await jwksClient.getSigningKey(decodeHeader(token).kid)).getPublicKey()
);`,
    phantomExample: "// @ts-ignore — reward-hacking suppression",
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: [],
      typecheck: "PASS",
      reportPath: "baselines/auth_llm_only/out/report.json",
    },
    references: [
      {
        label: "SWE-Bench Pro (Scale) — agents still fail long-horizon tasks",
        href: "https://scale.com/blog/swe-bench-pro",
        note: "Top models ~23% on Pro vs >70% on Verified — evidence that scaling alone ≠ reliable repair",
      },
      {
        label: "SWE-Bench Pro paper (arXiv)",
        href: "https://arxiv.org/abs/2509.16941",
      },
      {
        label: "Our oracle",
        href: "/oracle/auth-jwt-v2.json",
      },
    ],
  },
  {
    id: "payload-envelope",
    number: "5",
    title: "Downstream payload wrapping / DFG blindness",
    category: "syntactic",
    categoryLabel: "Structural redesign & data-flow",
    provider: "GitHub REST / Shopify-style pagination envelopes",
    demoStatus: "live",
    liveId: "envelope",
    summary:
      "Flat array response → { data: [...], pagination }. Call updated; downstream users.map breaks at runtime.",
    contractDelta:
      "Response schema type: array → type: object with data + cursor.",
    aiAloneFails:
      "Updates the fetch site; misses cross-file consumers.",
    astAloneFails:
      "Single-file AST misses that users originated from the API response in another module.",
    hybridWins:
      "OpenAPI response diff + DFG/call-graph → edge adapter extracting .data; completeness over consumers.",
    morphapiNeeds: [
      "Response schema oracle",
      "AST/DFG from assign site to consumers",
      "Adapter splice at network edge",
    ],
    beforeSnippet: `// api.ts (edge)
return await api.listUsers();

// users.ts (consumers — out of LLM-only scope)
const users = await loadUsers();
users.map((u) => u.login);`,
    afterSnippet: `// edge adapter — consumers unchanged
return (await api.listUsers()).data;`,
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: ["UsersPage treated as User[] (DFG miss)"],
      typecheck: "FAIL",
      reportPath: "baselines/envelope_llm_only/out/report.json",
    },
    references: [
      {
        label: "Fixture (legacy client)",
        href: "/fixtures/users-client-v1/src/users.ts",
        note: "Repo path — open in IDE",
      },
      {
        label: "Oracle",
        href: "/oracle/users-list-v2.json",
      },
      {
        label: "Vague docs",
        href: "/docs/users-list-v2.md",
      },
      {
        label: "GitHub REST pagination",
        href: "https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api",
      },
      {
        label: "octokit/openapi",
        href: "https://github.com/octokit/openapi",
      },
    ],
  },
  {
    id: "async-contagion",
    number: "6",
    title: "Function coloring / sync→async contagion",
    category: "concurrency",
    categoryLabel: "Concurrency & control flow",
    provider: "AWS SDK for JavaScript (v2 → v3)",
    demoStatus: "live",
    liveId: "async",
    summary:
      "v3 operations return Promises (client.send(Command)). LLM migrates the leaf I/O file; consumers that treat Promise as string via `any` (or drop await) stay broken — classic sync→async contagion across files.",
    contractDelta:
      "getObject(params).promise() → client.send(new GetObjectCommand(params)); callers must await / stay Promise-colored.",
    aiAloneFails:
      "Updates io.ts only; misses app.ts call-graph — missing await hidden behind `any`.",
    astAloneFails:
      "Finding leaf call sites is easy; choosing propagation vs adapter across files needs synthesis.",
    hybridWins:
      "AST getObject().promise spans on io.ts → constrained LLM/oracle send(Command) → call-graph rewrite of app.ts → tsc PASS + contagion gate clean.",
    morphapiNeeds: [
      "AST spans on leaf I/O",
      "Call-graph / coloring propagation into consumers",
      "Typecheck + contagion gate",
    ],
    beforeSnippet: `// io.ts
return s3.getObject({ Bucket, Key }).promise().then(r => r.Body);

// app.ts (latent contagion)
const raw: any = fetchObjectBody(bucket, "settings.json");`,
    afterSnippet: `// io.ts
return client.send(new GetObjectCommand({ Bucket, Key })).then(r => r.Body);

// app.ts
const raw = await fetchObjectBody(bucket, "settings.json");`,
    phantomExample:
      "const raw: any = fetchObjectBody(...)  // Promise treated as string",
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: ["missing-await-on-async-call"],
      typecheck: "FAIL",
      reportPath: "baselines/async_llm_only/out/report.json",
    },
    references: [
      {
        label: "AWS SDK JS v3 modular migration",
        href: "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrating-to-v3.html",
      },
      {
        label: "aws-sdk-js-v3",
        href: "https://github.com/aws/aws-sdk-js-v3",
      },
      {
        label: "Our oracle",
        href: "/oracle/aws-s3-v2.json",
      },
    ],
  },
  {
    id: "multi-site",
    number: "7",
    title: "Incomplete multi-site refactoring",
    category: "syntactic",
    categoryLabel: "Widespread scope",
    provider: "SendGrid / Twilio-style signature reshape",
    demoStatus: "live",
    liveId: "mail",
    summary:
      "Flat args → structured payload across notify + cron + seed. LLMs often update the primary service and miss secondary files — partial migration.",
    contractDelta:
      "sendEmail(to, from, subject, body) → send({ to, from, subject, content }).",
    aiAloneFails:
      "Incomplete edits across files; SWE-Bench Pro shows multi-file tasks remain hard.",
    astAloneFails:
      "AST finds all sites, but diverse argument shapes defeat one static codemod.",
    hybridWins:
      "Enumerate all spans; span-by-span LLM + oracle; block until completeness checklist is clean.",
    morphapiNeeds: [
      "Repo-wide AST enumeration checklist",
      "Per-span verify + apply",
      "Completeness gate",
    ],
    beforeSnippet: `// notify.ts + cron.ts + seed.ts
await sendEmail(to, from, subject, body);`,
    afterSnippet: `await send({
  to, from, subject, content: body,
});`,
    references: [
      {
        label: "SWE-Bench Pro — multi-file collapse evidence",
        href: "https://scale.com/blog/swe-bench-pro",
      },
      {
        label: "Twilio OpenAPI (twilio-oai)",
        href: "https://github.com/twilio/twilio-oai",
      },
    ],
  },
  {
    id: "error-hierarchy",
    number: "8",
    title: "Exception hierarchy drift",
    category: "behavioral",
    categoryLabel: "Error-contract breakage",
    provider: "Stripe-style errors (stripe-errors-v1 → v2 in this repo)",
    demoStatus: "live",
    liveId: "stripe-errors",
    summary:
      "Happy-path create() updated; catch stripe.error.CardError left stale → unhandled crashes on declines.",
    contractDelta:
      "charges.create → paymentIntents.create; stripe.error.CardError → Stripe.errors.StripeCardError.",
    aiAloneFails:
      "Focuses on create path; leaves dead catch blocks referencing stripe.error.CardError.",
    astAloneFails:
      "Cannot map new error class names without oracle/docs.",
    hybridWins:
      "Expand AST to enclosing try/catch; oracle rejects stripe.error.*; rewrite handlers with the call.",
    morphapiNeeds: [
      "AST: findChargesCreateTrySpans (TryStatement wrapping charges.create)",
      "Oracle: oracle/stripe-errors-v2.json (knownPhantoms: stripe.error.CardError)",
      "Joint rewrite call + catch handlers",
    ],
    beforeSnippet: `try {
  await stripe.charges.create(...);
} catch (e) {
  if (e instanceof stripe.error.CardError) { ... }
}`,
    afterSnippet: `try {
  await stripe.paymentIntents.create(...);
} catch (e) {
  if (e instanceof Stripe.errors.StripeCardError) { ... }
}`,
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: [
        "stripe.error.CardError",
        "CardError",
        "stripe.error",
        "error.CardError",
      ],
      typecheck: "FAIL",
      reportPath: "baselines/stripe_errors_llm_only/out/report.json",
    },
    references: [
      {
        label: "Fixture charge.ts",
        href: "/fixtures/stripe-errors-client-v1/src/charge.ts",
      },
      {
        label: "Oracle stripe-errors-v2",
        href: "/oracle/stripe-errors-v2.json",
      },
      {
        label: "Docs stripe-errors-v2",
        href: "/docs/stripe-errors-v2.md",
      },
      {
        label: "Stripe error handling",
        href: "https://docs.stripe.com/error-handling",
      },
      {
        label: "stripe-node",
        href: "https://github.com/stripe/stripe-node",
      },
    ],
  },
  {
    id: "discriminator",
    number: "9",
    title: "Polymorphic discriminator mutation",
    category: "syntactic",
    categoryLabel: "Type system & schema discriminators",
    provider: "Discord / Slack Events API",
    demoStatus: "live",
    liveId: "discriminator",
    summary:
      "Event discriminator field/value changes; routers update registration but miss switch/case type guards.",
    contractDelta:
      "e.g. type: MESSAGE_CREATE → event_type: message.created (illustrative pattern).",
    aiAloneFails:
      "Updates listener setup; misses internal branches → fallthrough.",
    astAloneFails:
      "Cannot bind string literals in case arms to OpenAPI discriminator without a schema link.",
    hybridWins:
      "OpenAPI discriminator mapping + AST switch audit; exhaustive enum check.",
    morphapiNeeds: [
      "Oracle: discriminator property + allowed values",
      "AST: SwitchStatement / type guards",
      "Exhaustiveness vs schema",
    ],
    beforeSnippet: `// subscribe.ts
client.subscribe(["MESSAGE_CREATE", ...], handler);

// router.ts (out of LLM-only scope)
switch (event.type) {
  case "MESSAGE_CREATE":
    return handleMessageCreate(event);
}`,
    afterSnippet: `switch (event.event_type) {
  case "message.created":
    return handleMessageCreate(event);
}`,
    liveEvidence: {
      model: "gpt-4o-mini",
      phantoms: ["event.type / MESSAGE_CREATE left in router"],
      typecheck: "FAIL",
      reportPath: "baselines/discriminator_llm_only/out/report.json",
    },
    references: [
      {
        label: "Fixture subscribe",
        href: "/fixtures/events-client-v1/src/subscribe.ts",
        note: "Repo path — open in IDE",
      },
      {
        label: "Fixture router",
        href: "/fixtures/events-client-v1/src/router.ts",
      },
      {
        label: "Oracle",
        href: "/oracle/events-gateway-v2.json",
      },
      {
        label: "Discord gateway events",
        href: "https://discord.com/developers/docs/events/gateway-events",
      },
      {
        label: "Slack Events API",
        href: "https://api.slack.com/events",
      },
    ],
  },
  {
    id: "auth-hmac",
    number: "10",
    title: "Security & auth scheme overhaul",
    category: "security",
    categoryLabel: "Cryptographic & protocol evolution",
    provider: "Slack request signing / Shopify HMAC",
    demoStatus: "live",
    liveId: "hmac",
    summary:
      "Static tokens → HMAC-SHA256 signature headers. LLMs invent helpers or leave timing-unsafe === compares / query.token checks.",
    contractDelta:
      "apiKey / query token → HMAC over timestamp + body; verify with timing-safe compare.",
    aiAloneFails:
      "Hallucinates slack.verifyWebhook() or writes timing-unsafe compares / leaves WEBHOOK_TOKEN.",
    astAloneFails:
      "Cannot synthesize correct crypto middleware from syntax alone.",
    hybridWins:
      "Security scheme diff + audited template injection + AST splice; forbid unsafe compare.",
    morphapiNeeds: [
      "OpenAPI/security oracle: HMAC scheme",
      "Curated verify template",
      "AST: insert middleware; ban === on signatures",
    ],
    beforeSnippet: `if (req.query.token === process.env.WEBHOOK_TOKEN) { ... }`,
    afterSnippet: `return verifyWebhookRequest(req); // HMAC + timingSafeEqual inside v2`,
    references: [
      {
        label: "Slack request signing",
        href: "https://api.slack.com/authentication/verifying-requests-from-slack",
      },
      {
        label: "Shopify webhook validation",
        href: "https://shopify.dev/docs/apps/build/webhooks/subscribe/https",
      },
    ],
  },
];

export const LIVE_SCENARIOS = SCENARIOS.filter((s) => s.demoStatus === "live");
export const TAXONOMY_SCENARIOS = SCENARIOS.filter(
  (s) => s.demoStatus === "taxonomy"
);

export function getScenario(id: string): ScenarioCase | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
