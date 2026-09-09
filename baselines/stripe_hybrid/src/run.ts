import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertAmountTransform,
  extractAmountExprFromSpanText,
  findChargesCreateSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  readUtf8,
  runTypecheck,
  writeUtf8,
  type UsageSpan,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const CLIENT_SRC = path.join(ROOT, "fixtures/stripe-client-v1/src/charge.ts");
const DOCS = path.join(ROOT, "docs/stripe-charge-v2.md");
const ORACLE = path.join(ROOT, "oracle/stripe-charge-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/stripe_llm_only/out/charge.ts");
const OUT_FILE = path.join(__dirname, "../out/charge.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

/** Oracle-backed replacement: force dollars→cents on amount. */
function oracleReplacementForSpan(span: UsageSpan): string {
  const amountExpr = extractAmountExprFromSpanText(span.text);
  const sourceMatch = /source\s*:\s*([^,\n}]+)/.exec(span.text);
  const sourceExpr = sourceMatch?.[1]?.trim() ?? "cardToken";
  const currencyMatch = /currency\s*:\s*([^,\n}]+)/.exec(span.text);
  const currencyExpr = currencyMatch?.[1]?.trim() ?? '"usd"';
  return `stripe.charges.create({
    amount: Math.round((${amountExpr}) * 100),
    currency: ${currencyExpr},
    source: ${sourceExpr},
  })`;
}

function rewriteImports(source: string): string {
  if (/from\s+["']stripe-charge-v1["']/.test(source)) {
    return source.replace(
      /import\s+createStripeCharge\s+from\s+["']stripe-charge-v1["']\s*;?/,
      `import createStripeCharge from "stripe-charge-v2";`
    );
  }
  if (!/from\s+["']stripe-charge-v2["']/.test(source)) {
    return `import createStripeCharge from "stripe-charge-v2";\n${source}`;
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import createStripeCharge from "stripe-charge-v2";\nconst stripe = createStripeCharge("k");\nconst cardToken = "";\nconst amountDollars = 0;\nconst _ = ${expr};\n`;
}

async function proposeLiveReplacement(args: {
  span: UsageSpan;
  docs: string;
  allowedSymbols: string[];
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate Stripe-style charge API call sites. Output ONLY a TypeScript expression that replaces the given call (the surrounding await stays). Do not invent symbols.",
      },
      {
        role: "user",
        content: [
          "## Allowed symbols (oracle)",
          args.allowedSymbols.join(", "),
          "",
          "## Docs",
          args.docs,
          "",
          "## Migration transforms (MUST apply)",
          "- amount: dollars → cents. Replace amount: <expr> with amount: Math.round(<expr> * 100)",
          "- Do not leave bare amount: amountDollars or amount: <float literal dollars>",
          "",
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Keep stripe.charges.create({ amount, currency, source })",
          "- Scale amount with Math.round(... * 100)",
          "- Preserve currency and source expressions from the call site",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Stripe Baseline B: Hybrid AI + AST + amount transform ===\n");
  console.log("Mode: live LLM + AST spans + behavioral amount gate\n");

  let contrastBehavioralPass: boolean | null = null;
  let contrastTypecheck: boolean | null = null;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = assertAmountTransform("charge.ts", llmOnlyOut);
    contrastBehavioralPass = contrast.ok;
    console.log("--- Contrast: behavioral gate on latest LLM-only output ---");
    console.log(
      contrast.ok
        ? "LLM-only already scaled amounts"
        : `LLM-only unscaled sites: ${contrast.unscaledCount}`
    );
    for (const s of contrast.sites) {
      console.log(
        `  L${s.startLine}: ${s.amountExpr} → ${s.scaled ? "scaled" : "UNSCALED"}`
      );
    }
  }

  const spans = findChargesCreateSpans("charge.ts", source);
  console.log(`\nAST scan: found ${spans.length} charges.create span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No charges.create spans found — AST scan failed");
  }

  let working = source;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  for (const span of sorted) {
    let feedback: string | undefined;
    let accepted: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidateExpr = await proposeLiveReplacement({
        span,
        docs,
        allowedSymbols: oracle.allowedSymbols,
        feedback,
      });

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle);
      const behavioral = assertAmountTransform(
        "span.ts",
        wrapForInspect(candidateExpr)
      );

      if (inspection.ok && behavioral.ok) {
        accepted = candidateExpr;
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          phantomCount: 0,
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
            .filter((s) => !s.scaled)
            .map((s) => `- [behavioral] amount ${s.amountExpr}: ${s.reason}`)
        );
      }
      feedback = reasons.join("\n");
      console.log(
        `\nSpan L${span.startLine}: rejected live attempt ${attempt}`
      );
      console.log(feedback);
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: inspection.phantoms.length,
        behavioralPass: behavioral.ok,
        phantoms: inspection.phantoms,
        amountSites: behavioral.sites,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleReplacementForSpan(span);
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle-backed ×100 replacement after live rejects`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
          behavioralPass: true,
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
  }

  working = rewriteImports(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  contrastTypecheck = tc.ok;
  const finalInspection = inspectCode(working, oracle);
  const finalBehavioral = assertAmountTransform("charge.ts", working);

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Behavioral gate (final) ---");
  console.log(
    finalBehavioral.ok
      ? "PASS (all amount sites scaled ×100)"
      : `FAIL (${finalBehavioral.unscaledCount} unscaled)`
  );
  for (const s of finalBehavioral.sites) {
    console.log(
      `  L${s.startLine}: amount: ${s.amountExpr} → ${s.scaled ? "scaled" : "UNSCALED"}`
    );
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "stripe_hybrid",
    api: "stripe-charge",
    scenario: "stripe-unit-shift",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    behavioralPass: finalBehavioral.ok,
    amountSites: finalBehavioral.sites,
    scaledCount: finalBehavioral.scaledCount,
    unscaledCount: finalBehavioral.unscaledCount,
    contrastBehavioralPass,
    contrastTypecheck,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || !finalBehavioral.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, scale all amounts, and have 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck + behavioral amount transform."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
