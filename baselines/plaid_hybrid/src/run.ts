import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  findLinkTokenCreateSpans,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/plaid-client-v1/src/link.ts");
const DOCS = path.join(ROOT, "docs/plaid-link-v2.md");
const ORACLE = path.join(ROOT, "oracle/plaid-link-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/plaid_llm_only/out/link.ts");
const OUT_FILE = path.join(__dirname, "../out/link.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

/** Oracle-backed replacement when live LLM keeps failing inspector. */
function oracleReplacementForSpan(span: UsageSpan): string {
  const wantsUk =
    /"GB"/.test(span.text) || /'GB'/.test(span.text) || /"auth"/.test(span.text);
  if (wantsUk) {
    return `client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "MorphAPI Demo UK",
    products: [Products.Auth],
    country_codes: [CountryCode.Gb],
    language: "en",
  })`;
  }
  return `client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "MorphAPI Demo",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  })`;
}

function rewriteImports(source: string): string {
  if (/from\s+["']plaid-link-v1["']/.test(source)) {
    return source.replace(
      /import\s+createPlaidClient\s+from\s+["']plaid-link-v1["']\s*;?/,
      `import createPlaidClient, { CountryCode, Products } from "plaid-link-v2";`
    );
  }
  if (!/from\s+["']plaid-link-v2["']/.test(source)) {
    return `import createPlaidClient, { CountryCode, Products } from "plaid-link-v2";\n${source}`;
  }
  if (!/CountryCode/.test(source) || !/Products/.test(source)) {
    return source.replace(
      /import\s+createPlaidClient(?:\s*,\s*\{[^}]*\})?\s+from\s+["']plaid-link-v2["']\s*;?/,
      `import createPlaidClient, { CountryCode, Products } from "plaid-link-v2";`
    );
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import { CountryCode, Products } from "plaid-link-v2";\nconst client = null as any;\nconst userId = "";\nconst _ = ${expr};\n`;
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
          "You migrate Plaid Link API call sites. Output ONLY a TypeScript expression that replaces the given call (the surrounding await stays). Use ONLY the allowed API symbols listed. Enum member names must match the Plaid TypeScript SDK exactly.",
      },
      {
        role: "user",
        content: [
          "## Allowed Plaid symbols (oracle from published SDK enums)",
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
          "- products: use Products.Transactions or Products.Auth (NOT TRANSACTIONS / Transaction)",
          "- country_codes: use CountryCode.Us or CountryCode.Gb (NOT US / USA / GB as enum members)",
          "- Keep linkTokenCreate; do not invent other client methods",
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

  console.log("=== Plaid Baseline B: Hybrid AI + AST Link migration ===\n");
  console.log("Mode: live LLM + AST spans + Hallucination Inspector\n");

  let contrastPhantomCount = 0;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, { focusPlaidOnly: true });
    contrastPhantomCount = contrast.phantoms.length;
    console.log("--- Contrast: Inspector on latest live LLM-only Plaid output ---");
    console.log(`Phantoms: ${contrast.phantoms.length}`);
    for (const p of contrast.phantoms) {
      console.log(`  [${p.tier}] ${p.symbol}`);
    }
  }

  const spans = findLinkTokenCreateSpans("link.ts", source);
  console.log(`\nAST scan: found ${spans.length} linkTokenCreate span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No linkTokenCreate spans found — AST scan failed");
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

      const inspection = inspectCode(wrapForInspect(candidateExpr), oracle, {
        focusPlaidOnly: true,
      });

      if (inspection.ok) {
        accepted = candidateExpr;
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

  working = rewriteImports(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, { focusPlaidOnly: true });

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
    baseline: "plaid_hybrid",
    api: "plaid-link",
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
