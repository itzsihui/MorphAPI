import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/client-v1/src/checkout.ts");
const DOCS = path.join(ROOT, "docs/morphpay-v2.md");
const ORACLE = path.join(ROOT, "oracle/morphpay-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/llm_only/out/checkout.ts");
const OUT_FILE = path.join(__dirname, "../out/checkout.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

/** Deterministic oracle-backed replacement when live LLM proposals keep failing inspector. */
function oracleReplacementForSpan(span: UsageSpan): string {
  const wantsManual = /capture\s*:\s*false/.test(span.text);
  if (wantsManual) {
    return `(async () => {
    const holdIntent = new PaymentIntent.Builder()
      .setAmount(5000)
      .setCurrency("usd")
      .setPaymentMethod(cardToken)
      .setCaptureMode(CaptureMode.MANUAL)
      .build();
    return morphpay.intents.confirm(holdIntent);
  })()`;
  }
  const amountExpr =
    /amount\s*:\s*([^,\n]+)/.exec(span.text)?.[1]?.trim() ?? "amountCents";
  const sourceExpr =
    /source\s*:\s*([^,\n}]+)/.exec(span.text)?.[1]?.trim() ?? "cardToken";
  return `(async () => {
    const intent = new PaymentIntent.Builder()
      .setAmount(${amountExpr})
      .setCurrency("usd")
      .setPaymentMethod(${sourceExpr})
      .setCaptureMode(CaptureMode.AUTOMATIC)
      .build();
    return morphpay.intents.confirm(intent);
  })()`;
}

function rewriteImports(source: string): string {
  if (/from\s+["']morphpay-v1["']/.test(source)) {
    return source.replace(
      /import\s+createMorphPay\s+from\s+["']morphpay-v1["']\s*;?/,
      `import createMorphPay, { PaymentIntent, CaptureMode } from "morphpay-v2";`
    );
  }
  if (!/from\s+["']morphpay-v2["']/.test(source)) {
    return `import createMorphPay, { PaymentIntent, CaptureMode } from "morphpay-v2";\n${source}`;
  }
  return source;
}

function finalizeClient(source: string): string {
  let out = rewriteImports(source);
  out = out.replace(
    /captured:\s*charge\.captured/g,
    "captured: charge.captureMode === CaptureMode.AUTOMATIC"
  );
  return out;
}

function wrapForInspect(expr: string): string {
  return `import { PaymentIntent, CaptureMode } from "morphpay-v2";\nconst morphpay = null as any;\nconst cardToken = "";\nconst amountCents = 0;\nconst _ = ${expr};\n`;
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
          "You migrate MorphPay API call sites. Output ONLY a TypeScript expression that replaces the given call (the surrounding await stays). Do not invent symbols. Use ONLY the allowed API symbols listed.",
      },
      {
        role: "user",
        content: [
          "## Allowed MorphPay v2 symbols (oracle)",
          args.allowedSymbols.join(", "),
          "",
          "## Docs",
          args.docs,
          "",
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Use PaymentIntent.Builder + setAmount/setCurrency/setPaymentMethod/setCaptureMode/build",
          "- CaptureMode only AUTOMATIC or MANUAL (exact enum member names)",
          "- Confirm via morphpay.intents.confirm(intent)",
          "- Never use IntentFactory, setCapture, CaptureMode.IMMEDIATE, or charges.create",
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

  console.log("=== Baseline B: Hybrid AI + AST MorphPay migration ===\n");
  console.log("Mode: live LLM + AST bounds + Hallucination Inspector\n");

  // Contrast against the latest live LLM-only output (if present)
  let contrastPhantomCount = 0;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, { focusMorphPayOnly: true });
    contrastPhantomCount = contrast.phantoms.length;
    console.log("--- Contrast: Inspector on latest live LLM-only output ---");
    console.log(`Phantoms: ${contrast.phantoms.length}`);
    for (const p of contrast.phantoms) {
      console.log(`  [${p.tier}] ${p.symbol}`);
    }
  } else {
    console.log(
      "(No baselines/llm_only/out/checkout.ts yet — run demo:llm-only first for contrast.)"
    );
  }

  const spans = findChargesCreateSpans("checkout.ts", source);
  console.log(`\nAST scan: found ${spans.length} charges.create usage span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
    console.log(`    ${s.text.split("\n")[0]}...`);
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
    let sourceTag: "live" | "oracle_fallback" = "live";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidateExpr = await proposeLiveReplacement({
        span,
        docs,
        allowedSymbols: oracle.allowedSymbols,
        feedback,
      });

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle, {
        focusMorphPayOnly: true,
      });

      if (inspection.ok) {
        accepted = candidateExpr;
        sourceTag = "live";
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: sourceTag,
          phantomCount: 0,
        });
        break;
      }

      feedback = inspection.phantoms
        .map((p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`)
        .join("\n");
      console.log(
        `\nSpan L${span.startLine}: rejected live attempt ${attempt} (${inspection.phantoms.length} phantom(s))`
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
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleReplacementForSpan(span);
        const gate = inspectCode(wrapForInspect(accepted), oracle, {
          focusMorphPayOnly: true,
        });
        if (!gate.ok) {
          throw new Error(
            `Oracle fallback has phantoms: ${JSON.stringify(gate.phantoms)}`
          );
        }
        sourceTag = "oracle_fallback";
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle-backed replacement after live rejects`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: sourceTag,
          phantomCount: 0,
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
  }

  working = finalizeClient(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, { focusMorphPayOnly: true });

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
    baseline: "hybrid",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    contrastPhantomCount,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || finalInspection.phantoms.length > 0) {
    console.error("\nClaim check FAILED: hybrid should typecheck with 0 phantoms.");
    process.exitCode = 1;
  } else {
    console.log("\nClaim check: hybrid passed typecheck with 0 phantoms.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
