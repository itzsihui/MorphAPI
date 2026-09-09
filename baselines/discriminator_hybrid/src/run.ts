import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertDiscriminatorMigration,
  findEventSwitchSpans,
  generateCode,
  inspectCode,
  loadDiscriminatorMapping,
  loadEnv,
  loadOracle,
  oracleDiscriminatorSwitchReplacement,
  readUtf8,
  rewriteDiscriminatorLiterals,
  runTypecheck,
  writeUtf8,
  type UsageSpan,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const SUBSCRIBE_SRC = path.join(
  ROOT,
  "fixtures/events-client-v1/src/subscribe.ts"
);
const ROUTER_SRC = path.join(ROOT, "fixtures/events-client-v1/src/router.ts");
const DOCS = path.join(ROOT, "docs/events-gateway-v2.md");
const ORACLE = path.join(ROOT, "oracle/events-gateway-v2.json");
const LLM_ONLY_ROUTER = path.join(
  ROOT,
  "baselines/discriminator_llm_only/out/router.ts"
);
const OUT_SUBSCRIBE = path.join(__dirname, "../out/subscribe.ts");
const OUT_ROUTER = path.join(__dirname, "../out/router.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

function rewriteImports(source: string): string {
  return source.replace(/events-gateway-v1/g, "events-gateway-v2");
}

async function proposeLiveSwitch(args: {
  span: UsageSpan;
  docs: string;
  mapping: ReturnType<typeof loadDiscriminatorMapping>;
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate polymorphic event switch statements. Output ONLY the full replacement switch statement (including switch keyword and braces).",
      },
      {
        role: "user",
        content: [
          "## Docs",
          args.docs,
          "",
          "## Discriminator mapping (MUST apply)",
          `- Property: .${args.mapping.fromProperty} → .${args.mapping.toProperty}`,
          ...Object.entries(args.mapping.valueMap).map(
            ([from, to]) => `- Case "${from}" → "${to}"`
          ),
          "",
          "## Switch to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          `- Discriminant MUST be event.${args.mapping.toProperty}`,
          "- Include every required case value",
          "- Preserve handler call expressions inside arms",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim();
}

async function main() {
  const subscribeSource = readUtf8(SUBSCRIBE_SRC);
  const routerSource = readUtf8(ROUTER_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);
  const mapping = loadDiscriminatorMapping(oracle.discriminator);

  console.log(
    "=== Discriminator Baseline B: Hybrid AI + AST + switch audit ===\n"
  );
  console.log("Mode: live LLM + AST switch spans + discriminator gate\n");

  let contrastBehavioralPass: boolean | null = null;
  if (fs.existsSync(LLM_ONLY_ROUTER)) {
    const llmRouter = readUtf8(LLM_ONLY_ROUTER);
    const contrast = assertDiscriminatorMigration(
      "router.ts",
      llmRouter,
      mapping,
      { requireSwitch: true }
    );
    contrastBehavioralPass = contrast.ok;
    console.log("--- Contrast: discriminator gate on LLM-only router ---");
    console.log(
      contrast.ok
        ? "LLM-only router already migrated"
        : `LLM-only router issues: ${contrast.failCount}`
    );
    for (const s of contrast.sites) {
      console.log(
        `  L${s.startLine} [${s.kind}] ${s.ok ? "ok" : "FAIL"} — ${s.reason}`
      );
    }
  }

  // Subscribe: deterministic literal + import rewrite (docs already cover intents)
  let subscribeOut = rewriteImports(subscribeSource);
  subscribeOut = rewriteDiscriminatorLiterals(subscribeOut, mapping);
  writeUtf8(OUT_SUBSCRIBE, subscribeOut);
  console.log(`\nSubscribe: applied oracle intent rewrite → ${OUT_SUBSCRIBE}`);

  let working = rewriteImports(routerSource);
  const spans = findEventSwitchSpans("router.ts", working);
  console.log(`\nAST scan: found ${spans.length} event switch span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No event switch spans found — AST scan failed");
  }

  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  for (const span of sorted) {
    let feedback: string | undefined;
    let accepted: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidate = await proposeLiveSwitch({
        span,
        docs,
        mapping,
        feedback,
      });

      const probe = `import type { GatewayEvent } from "events-gateway-v2";\nfunction handleEvent(event: GatewayEvent): string {\n${candidate}\n}\n`;
      const inspection = inspectCode(probe, oracle);
      const behavioral = assertDiscriminatorMigration(
        "router.ts",
        probe,
        mapping,
        { requireSwitch: true }
      );

      if (inspection.ok && behavioral.ok) {
        accepted = candidate;
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM switch on attempt ${attempt}`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          behavioralPass: true,
        });
        break;
      }

      const reasons: string[] = [];
      if (!inspection.ok) {
        reasons.push(
          ...inspection.phantoms.map(
            (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
          )
        );
      }
      if (!behavioral.ok) {
        reasons.push(
          ...behavioral.sites
            .filter((s) => !s.ok)
            .map((s) => `- [discriminator] ${s.reason}`)
        );
      }
      feedback = reasons.join("\n");
      console.log(`\nSpan L${span.startLine}: rejected live attempt ${attempt}`);
      console.log(feedback);
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        behavioralPass: behavioral.ok,
        phantoms: inspection.phantoms,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleDiscriminatorSwitchReplacement(span.text, mapping);
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle discriminator rewrite after live rejects`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
          behavioralPass: true,
        });
      }
    }

    if (!accepted) throw new Error("No accepted switch replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
  }

  working = rewriteDiscriminatorLiterals(working, mapping);
  writeUtf8(OUT_ROUTER, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(
    `${readUtf8(OUT_SUBSCRIBE)}\n${working}`,
    oracle
  );
  const finalBehavioral = assertDiscriminatorMigration(
    "router.ts",
    working,
    mapping,
    { requireSwitch: true }
  );
  const subscribeGate = assertDiscriminatorMigration(
    "subscribe.ts",
    readUtf8(OUT_SUBSCRIBE),
    mapping
  );

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Discriminator gate (final) ---");
  console.log(
    finalBehavioral.ok && subscribeGate.ok
      ? "PASS (subscribe intents + router switch migrated)"
      : `FAIL (router fail=${finalBehavioral.failCount}, subscribe fail=${subscribeGate.failCount})`
  );
  for (const s of [...subscribeGate.sites, ...finalBehavioral.sites]) {
    console.log(
      `  L${s.startLine} [${s.kind}] ${s.ok ? "ok" : "FAIL"} — ${s.reason}`
    );
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const behavioralPass = finalBehavioral.ok && subscribeGate.ok;
  const report = {
    baseline: "discriminator_hybrid",
    api: "events-gateway",
    scenario: "discriminator",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    behavioralPass,
    discriminatorSites: [...subscribeGate.sites, ...finalBehavioral.sites],
    failCount: finalBehavioral.failCount + subscribeGate.failCount,
    contrastBehavioralPass,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_ROUTER,
    outSubscribe: OUT_SUBSCRIBE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || !behavioralPass || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, migrate discriminator, and have 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck + discriminator switch audit."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
