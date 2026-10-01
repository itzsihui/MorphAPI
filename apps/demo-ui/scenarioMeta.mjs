/**
 * Single source of truth for Workbench routing (all 11 live scenarios).
 * Paths are relative to repo ROOT.
 */

export const LIVE_SCENARIOS = [
  "morphpay",
  "plaid",
  "openai",
  "stripe",
  "stripe-errors",
  "auth",
  "envelope",
  "async",
  "mail",
  "hmac",
  "discriminator",
];

/** @type {Record<string, {
 *   label: string;
 *   number: string;
 *   oraclePath: string;
 *   docsPath: string;
 *   fixtureFiles: string[];
 *   spanFinders: string[];
 *   tsconfigPath: string;
 *   deprecatedSpec: string;
 *   deprecatedSymbols: string[];
 *   successorModule: string;
 *   successorSymbols: string[];
 *   successorKind?: "call" | "builder" | "constructor_then_call" | "multi_step";
 *   scripts: [string, string];
 *   schemaDelta: string;
 *   astAloneReason: string;
 *   gateFields: string[];
 * }>} */
export const SCENARIO_META = {
  morphpay: {
    label: "MorphPay Builder",
    number: "1a",
    oraclePath: "oracle/morphpay-v2.json",
    docsPath: "docs/morphpay-v2.md",
    fixtureFiles: ["fixtures/client-v1/src/checkout.ts"],
    spanFinders: ["charges.create"],
    tsconfigPath: "fixtures/client-v1/tsconfig.json",
    deprecatedSpec: "morphpay-v1#ChargesApi.create",
    deprecatedSymbols: ["create"],
    successorModule: "morphpay-v2",
    successorSymbols: ["PaymentIntentBuilder","CaptureMode"],
    successorKind: "builder",
    scripts: ["demo:llm-only", "demo:hybrid"],
    schemaDelta:
      "deprecated: charges.create → PaymentIntent.Builder + CaptureMode",
    astAloneReason:
      "Rename recipes cannot synthesize Builder chains or CaptureMode members without an oracle allow-list.",
    gateFields: ["typecheckPass", "phantomCount", "spansFound"],
  },
  plaid: {
    label: "Plaid Link enums",
    number: "1b",
    oraclePath: "oracle/plaid-link-v2.json",
    docsPath: "docs/plaid-link-v2.md",
    fixtureFiles: ["fixtures/plaid-client-v1/src/link.ts"],
    spanFinders: ["linkTokenCreate"],
    tsconfigPath: "fixtures/plaid-client-v1/tsconfig.json",
    deprecatedSpec: "plaid-link-v1#PlaidApi.linkTokenCreate",
    deprecatedSymbols: ["linkTokenCreate"],
    successorModule: "plaid-link-v2",
    successorSymbols: ["PlaidApi.linkTokenCreate","CountryCode","Products"],
    scripts: ["demo:plaid-llm-only", "demo:plaid-hybrid"],
    schemaDelta: "docs teach CountryCode.US → typed SDK needs CountryCode.Us",
    astAloneReason:
      "A pure rename cannot invent Us vs US without an SDK/oracle allow-list.",
    gateFields: ["typecheckPass", "phantomCount", "spansFound"],
  },
  openai: {
    label: "OpenAI engine→model",
    number: "2",
    oraclePath: "oracle/openai-chat-v1.json",
    docsPath: "docs/openai-chat-v1.md",
    fixtureFiles: ["fixtures/openai-client-v0/src/chat.ts"],
    spanFinders: ["ChatCompletion.create"],
    tsconfigPath: "fixtures/openai-client-v0/tsconfig.json",
    deprecatedSpec: "openai-chat-v0#default.ChatCompletion.create",
    deprecatedSymbols: ["create","ChatCompletion"],
    successorModule: "openai-chat-v1",
    successorSymbols: ["OpenAI"],
    scripts: ["demo:openai-llm-only", "demo:openai-hybrid"],
    schemaDelta:
      "deprecated: engine / ChatCompletion.create → model + chat.completions",
    astAloneReason:
      "Static renames miss memory-biased leftover engine keys and stale class names.",
    gateFields: ["typecheckPass", "phantomCount", "spansFound"],
  },
  stripe: {
    label: "Stripe unit shift",
    number: "3",
    oraclePath: "oracle/stripe-charge-v2.json",
    docsPath: "docs/stripe-charge-v2.md",
    fixtureFiles: ["fixtures/stripe-client-v1/src/charge.ts"],
    spanFinders: ["charges.create"],
    tsconfigPath: "fixtures/stripe-client-v1/tsconfig.json",
    deprecatedSpec: "stripe-charge-v1#ChargesApi.create",
    deprecatedSymbols: ["create"],
    successorModule: "stripe-charge-v2",
    successorSymbols: ["ChargesApi.create"],
    scripts: ["demo:stripe-llm-only", "demo:stripe-hybrid"],
    schemaDelta: "amount dollars → cents (×100) on charge create",
    astAloneReason:
      "Codemods rarely encode silent unit/semantic shifts without a behavioral oracle.",
    gateFields: ["typecheckPass", "behavioralPass", "scaledCount", "spansFound"],
  },
  auth: {
    label: "JWT→JWKS evasion",
    number: "4",
    oraclePath: "oracle/auth-jwt-v2.json",
    docsPath: "docs/auth-jwt-v2.md",
    fixtureFiles: ["fixtures/auth-client-v1/src/verify.ts"],
    spanFinders: ["jwt.verify"],
    tsconfigPath: "fixtures/auth-client-v1/tsconfig.json",
    deprecatedSpec: "auth-jwt-v1#jwt.verify",
    deprecatedSymbols: ["verify"],
    successorModule: "auth-jwt-v2",
    successorSymbols: ["createJwksClient","jwt"],
    successorKind: "multi_step",
    scripts: ["demo:auth-llm-only", "demo:auth-hybrid"],
    schemaDelta:
      "jwt.verify(secret) → async JWKS getSigningKey + PublicKey verify",
    astAloneReason:
      "Cannot synthesize JWKS async path; also cannot catch @ts-ignore / as any evasion.",
    gateFields: ["typecheckPass", "evasionCount", "phantomCount", "spansFound"],
  },
  envelope: {
    label: "Envelope / DFG",
    number: "5",
    oraclePath: "oracle/users-list-v2.json",
    docsPath: "docs/users-list-v2.md",
    fixtureFiles: [
      "fixtures/users-client-v1/src/api.ts",
      "fixtures/users-client-v1/src/users.ts",
    ],
    spanFinders: ["listUsers.await"],
    tsconfigPath: "fixtures/users-client-v1/tsconfig.json",
    deprecatedSpec: "users-list-v1#UsersListClient.listUsers",
    deprecatedSymbols: ["listUsers"],
    successorModule: "users-list-v2",
    successorSymbols: ["UsersListClient.listUsers","UsersPage"],
    scripts: ["demo:envelope-llm-only", "demo:envelope-hybrid"],
    schemaDelta: "flat User[] → UsersPage envelope (.data unwrap)",
    astAloneReason:
      "Leaf rename cannot fix downstream DFG uses that still treat the page as User[].",
    gateFields: [
      "typecheckPass",
      "behavioralPass",
      "unwrappedCount",
      "spansFound",
    ],
  },
  async: {
    label: "Async contagion",
    number: "6",
    oraclePath: "oracle/aws-s3-v2.json",
    docsPath: "docs/aws-s3-v2.md",
    fixtureFiles: [
      "fixtures/aws-s3-client-v1/src/io.ts",
      "fixtures/aws-s3-client-v1/src/app.ts",
    ],
    spanFinders: ["getObject.promise"],
    tsconfigPath: "fixtures/aws-s3-client-v1/tsconfig.json",
    deprecatedSpec: "aws-s3-v1#S3.getObject",
    deprecatedSymbols: ["getObject"],
    successorModule: "aws-s3-v2",
    successorSymbols: ["S3Client.send","GetObjectCommand"],
    successorKind: "constructor_then_call",
    scripts: ["demo:async-llm-only", "demo:async-hybrid"],
    schemaDelta:
      "getObject().promise() → client.send(GetObjectCommand) + await contagion",
    astAloneReason:
      "Leaf I/O rewrite without call-graph coloring leaves consumers missing await.",
    gateFields: ["typecheckPass", "spansFound", "phantomCount"],
  },
  mail: {
    label: "Multi-site mail",
    number: "7",
    oraclePath: "oracle/mail-send-v2.json",
    docsPath: "docs/mail-send-v2.md",
    fixtureFiles: [
      "fixtures/mail-client-v1/src/notify.ts",
      "fixtures/mail-client-v1/src/cron.ts",
      "fixtures/mail-client-v1/src/seed.ts",
      "fixtures/mail-client-v1/src/onboarding.ts",
    ],
    spanFinders: ["sendEmail"],
    tsconfigPath: "fixtures/mail-client-v1/tsconfig.json",
    deprecatedSpec: "mail-send-v1#sendEmail",
    deprecatedSymbols: ["sendEmail"],
    successorModule: "mail-send-v2",
    successorSymbols: ["send"],
    scripts: ["demo:mail-llm-only", "demo:mail-ast", "demo:mail-hybrid"],
    schemaDelta:
      "sendEmail(...) → send({...}); helpers return SendResult (messageId) — 1° callers must adapt",
    astAloneReason:
      "Incomplete multi-file recipes leave leftover call sites; Pure AST also misses callee→caller contract repairs.",
    gateFields: [
      "typecheckPass",
      "completenessPass",
      "migratedCount",
      "spansFound",
    ],
  },
  "stripe-errors": {
    label: "Error hierarchy",
    number: "8",
    oraclePath: "oracle/stripe-errors-v2.json",
    docsPath: "docs/stripe-errors-v2.md",
    fixtureFiles: ["fixtures/stripe-errors-client-v1/src/charge.ts"],
    spanFinders: ["try.charges.create"],
    tsconfigPath: "fixtures/stripe-errors-client-v1/tsconfig.json",
    deprecatedSpec: "stripe-errors-v1#default.charges.create",
    deprecatedSymbols: ["create"],
    successorModule: "stripe-errors-v2",
    successorSymbols: ["StripeCardError"],
    scripts: ["demo:stripe-errors-llm-only", "demo:stripe-errors-hybrid"],
    schemaDelta: "legacy CardError catch → new error class hierarchy",
    astAloneReason:
      "Catch-clause class renames miss hierarchy drift without an error oracle.",
    gateFields: [
      "typecheckPass",
      "leftoverLegacyCatch",
      "phantomCount",
      "spansFound",
    ],
  },
  discriminator: {
    label: "Discriminator",
    number: "9",
    oraclePath: "oracle/events-gateway-v2.json",
    docsPath: "docs/events-gateway-v2.md",
    fixtureFiles: [
      "fixtures/events-client-v1/src/subscribe.ts",
      "fixtures/events-client-v1/src/router.ts",
    ],
    spanFinders: ["event.switch"],
    tsconfigPath: "fixtures/events-client-v1/tsconfig.json",
    deprecatedSpec: "events-gateway-v1#GatewayClient.subscribe",
    deprecatedSymbols: [],
    successorModule: "events-gateway-v2",
    successorSymbols: ["GatewayClient.subscribe"],
    scripts: ["demo:discriminator-llm-only", "demo:discriminator-hybrid"],
    schemaDelta: "event type literals / switch arms → new discriminator map",
    astAloneReason:
      "Static switches miss new required discriminant values without a value map.",
    gateFields: [
      "typecheckPass",
      "behavioralPass",
      "failCount",
      "spansFound",
    ],
  },
  hmac: {
    label: "HMAC auth",
    number: "10",
    oraclePath: "oracle/webhook-auth-v2.json",
    docsPath: "docs/webhook-auth-v2.md",
    fixtureFiles: ["fixtures/webhook-client-v1/src/webhook.ts"],
    spanFinders: ["token.eq", "authorizeLegacyCompat"],
    tsconfigPath: "fixtures/webhook-client-v1/tsconfig.json",
    deprecatedSpec: "webhook-auth-v1#verifyWebhookRequest",
    deprecatedSymbols: [],
    successorModule: "webhook-auth-v2",
    successorSymbols: ["verifyWebhookRequest"],
    scripts: ["demo:hmac-llm-only", "demo:hmac-hybrid"],
    schemaDelta:
      "=== token compare / legacy authorize → timing-safe HMAC verify",
    astAloneReason:
      "Security scheme overhaul needs timing-safe helpers an oracle must allow-list.",
    gateFields: [
      "typecheckPass",
      "securityPass",
      "unsafeCompareCount",
      "spansFound",
    ],
  },
};

export function normalizeScenario(raw) {
  if (LIVE_SCENARIOS.includes(raw)) return raw;
  return "morphpay";
}

export function getMeta(scenarioInput) {
  const id = normalizeScenario(scenarioInput);
  return { id, ...SCENARIO_META[id] };
}
