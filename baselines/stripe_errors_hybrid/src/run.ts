import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  findChargesCreateTrySpans,
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
const CLIENT_SRC = path.join(
  ROOT,
  "fixtures/stripe-errors-client-v1/src/charge.ts"
);
const DOCS = path.join(ROOT, "docs/stripe-errors-v2.md");
const ORACLE = path.join(ROOT, "oracle/stripe-errors-v2.json");
const LLM_ONLY_OUT = path.join(
  ROOT,
  "baselines/stripe_errors_llm_only/out/charge.ts"
);
const OUT_FILE = path.join(__dirname, "../out/charge.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

function oracleReplacementForSpan(span: UsageSpan): string {
  const amountMatch = span.text.match(/amount:\s*([^,\n]+)/);
  const amountExpr = amountMatch ? amountMatch[1].trim() : "amountCents";
  return `try {
    const charge = await stripe.paymentIntents.create({
      amount: ${amountExpr},
      currency: "usd",
      payment_method: source,
      confirm: true,
    });
    return { ok: true, id: charge.id };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeCardError) {
      return { ok: false, reason: "card_declined" };
    }
    throw e;
  }`;
}

function rewriteFile(source: string): string {
  let next = source.replace(
    /import\s+stripe\s+from\s+["']stripe-errors-v1["']\s*;?/,
    `import Stripe from "stripe-errors-v2";\n\nconst stripe = new Stripe(process.env.STRIPE_KEY ?? "sk_test");`
  );
  next = next.replace(
    /import\s+Stripe\s+from\s+["']stripe-errors-v1["']\s*;?/,
    `import Stripe from "stripe-errors-v2";`
  );
  next = next.replace(
    /\/\*\*[\s\S]*?Migrate to stripe-errors-v2[\s\S]*?\*\/\s*/m,
    `/** Charge helpers on stripe-errors-v2 (PaymentIntents + Stripe.errors). */\n`
  );
  if (
    !/const stripe = new Stripe/.test(next) &&
    /import Stripe from/.test(next)
  ) {
    next = next.replace(
      /import Stripe from "stripe-errors-v2";\s*/,
      `import Stripe from "stripe-errors-v2";\n\nconst stripe = new Stripe(process.env.STRIPE_KEY ?? "sk_test");\n`
    );
  }
  // Static Stripe.paymentIntents → instance stripe.paymentIntents
  next = next.replace(/\bStripe\.paymentIntents\b/g, "stripe.paymentIntents");
  return next;
}

function wrapForInspect(tryBlock: string): string {
  return `import Stripe from "stripe-errors-v2";
const stripe = new Stripe("sk_test");
const source = "tok_visa";
const amountCents = 2000;
async function _f() {
  ${tryBlock}
}
`;
}

function candidateStructurallyOk(candidate: string, span: UsageSpan): string | null {
  if (/stripe\.error\.CardError/.test(candidate)) {
    return "leftover stripe.error.CardError";
  }
  if (/\.charges\s*\.\s*create\s*\(/.test(candidate)) {
    return "leftover charges.create";
  }
  if (!/paymentIntents\.create/.test(candidate)) {
    return "missing paymentIntents.create";
  }
  if (!/Stripe\.errors\.StripeCardError/.test(candidate)) {
    return "missing Stripe.errors.StripeCardError catch";
  }
  if (/\bStripe\.paymentIntents\b/.test(candidate)) {
    return "static Stripe.paymentIntents (use instance stripe)";
  }
  // Reject object shorthand / wrong binding when span used amountCents
  if (/\bamountCents\b/.test(span.text)) {
    if (!/\bamountCents\b/.test(candidate)) {
      return "must keep amount: amountCents from the original span";
    }
  }
  if (/amount:\s*amount\s*[,}]/.test(candidate) && !/amount:\s*amountCents/.test(candidate)) {
    return "bare amount: amount is invalid (use amountCents or a literal)";
  }
  return null;
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
          "You migrate Stripe try/catch payment sites. Output ONLY a TypeScript try/catch statement that replaces the given block. Use ONLY allowed symbols. Never use stripe.error.CardError or charges.create.",
      },
      {
        role: "user",
        content: [
          "## Allowed Stripe symbols (oracle)",
          args.allowedSymbols.join(", "),
          "",
          "## Docs",
          args.docs,
          "",
          "## try/catch site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Use stripe.paymentIntents.create({ amount: <same expr as input>, currency, payment_method: source, confirm: true })",
          "- If the input uses amountCents, keep amount: amountCents (never bare `amount`)",
          "- Catch with: e instanceof Stripe.errors.StripeCardError",
          "- FORBIDDEN: charges.create, stripe.error.CardError, Stripe.paymentIntents (static)",
          "- Keep the same return shapes { ok: true, id } / { ok: false, reason }",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/;?\s*$/, "");
}

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log(
    "=== Stripe Errors Baseline B: Hybrid AI + AST try/catch migration ===\n"
  );

  let contrastPhantomCount = 0;
  let contrastLeftoverCatch = false;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, {
      focusStripeErrorsOnly: true,
    });
    contrastPhantomCount = contrast.phantoms.length;
    contrastLeftoverCatch = /stripe\.error\.CardError/.test(llmOnlyOut);
    console.log(
      "--- Contrast: Inspector on latest LLM-only Stripe-errors output ---"
    );
    console.log(`Phantoms: ${contrast.phantoms.length}`);
    console.log(`Leftover stripe.error.CardError: ${contrastLeftoverCatch}`);
    for (const p of contrast.phantoms) {
      console.log(`  [${p.tier}] ${p.symbol}`);
    }
  }

  const spans = findChargesCreateTrySpans("charge.ts", source);
  console.log(
    `\nAST scan: found ${spans.length} try.charges.create span(s)`
  );
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No try.charges.create spans found — AST scan failed");
  }

  let working = source;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  for (const span of sorted) {
    let feedback: string | undefined;
    let accepted: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidate = await proposeLiveReplacement({
        span,
        docs,
        allowedSymbols: oracle.allowedSymbols,
        feedback,
      });

      const structural = candidateStructurallyOk(candidate, span);
      const inspection = inspectCode(wrapForInspect(candidate), oracle, {
        focusStripeErrorsOnly: true,
      });

      if (inspection.ok && !structural) {
        accepted = candidate;
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          phantomCount: 0,
        });
        break;
      }

      feedback = [
        ...inspection.phantoms.map(
          (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
        ),
        structural ? `- structural: ${structural}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      console.log(
        `\nSpan L${span.startLine}: rejected live attempt ${attempt} (${inspection.phantoms.length} phantom(s)${structural ? `, ${structural}` : ""})`
      );
      for (const p of inspection.phantoms) {
        console.log(`  [${p.tier}] ${p.symbol}`);
      }
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: inspection.phantoms.length,
        phantoms: inspection.phantoms,
        structural,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleReplacementForSpan(span);
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle-backed replacement after live rejects`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
          phantomCount: 0,
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
  }

  working = rewriteFile(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, {
    focusStripeErrorsOnly: true,
  });

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "stripe_errors_hybrid",
    api: "stripe-errors",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    contrastPhantomCount,
    contrastLeftoverCatch,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck with 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log("\nClaim check: hybrid passed typecheck with 0 phantoms.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
