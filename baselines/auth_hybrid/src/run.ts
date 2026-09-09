import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  findJwtVerifySpans,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/auth-client-v1/src/verify.ts");
const TEST_SRC = path.join(ROOT, "fixtures/auth-client-v1/src/verify.test.ts");
const DOCS = path.join(ROOT, "docs/auth-jwt-v2.md");
const ORACLE = path.join(ROOT, "oracle/auth-jwt-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/auth_llm_only/out/verify.ts");
const OUT_FILE = path.join(__dirname, "../out/verify.ts");
const OUT_TEST = path.join(__dirname, "../out/verify.test.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

const ORACLE_EXPR = `jwt.verify(
    token,
    (await jwksClient.getSigningKey(decodeHeader(token).kid)).getPublicKey()
  )`;

function oracleReplacementForSpan(_span: UsageSpan): string {
  return ORACLE_EXPR;
}

function rewriteImports(source: string): string {
  let out = source;
  if (/from\s+["']auth-jwt-v1["']/.test(out)) {
    out = out.replace(
      /import\s+\{\s*jwt\s*\}\s+from\s+["']auth-jwt-v1["']\s*;?/,
      `import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";`
    );
  }
  if (!/from\s+["']auth-jwt-v2["']/.test(out)) {
    out = `import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";\n${out}`;
  } else if (!/decodeHeader/.test(out) || !/createJwksClient/.test(out)) {
    out = out.replace(
      /import\s+\{[^}]*\}\s+from\s+["']auth-jwt-v2["']\s*;?/,
      `import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";`
    );
  }
  return out;
}

function finalizeClient(source: string): string {
  let out = rewriteImports(source);

  if (!/createJwksClient\s*\(/.test(out)) {
    // Insert shared JWKS client after imports
    const lines = out.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\b/.test(lines[i])) lastImport = i;
    }
    const clientDecl = [
      "",
      "const jwksClient = createJwksClient({",
      '  jwksUri: process.env.JWKS_URI ?? "https://example.auth0.com/.well-known/jwks.json",',
      "});",
      "",
    ];
    lines.splice(lastImport + 1, 0, ...clientDecl);
    out = lines.join("\n");
  }

  // Secret→JWKS verify is async
  out = out.replace(
    /export\s+function\s+verifyAccessToken/g,
    "export async function verifyAccessToken"
  );
  out = out.replace(
    /export\s+function\s+verifyIdToken/g,
    "export async function verifyIdToken"
  );
  out = out.replace(
    /export\s+async\s+async\s+function/g,
    "export async function"
  );

  return out;
}

function wrapForInspect(expr: string): string {
  return [
    `import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";`,
    `const jwksClient = createJwksClient({ jwksUri: "" });`,
    `const token = "";`,
    `const _ = ${expr};`,
  ].join("\n");
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
          "You migrate Auth JWT call sites. Output ONLY a TypeScript expression that replaces the given jwt.verify(...) call (surrounding statement structure stays). Use ONLY allowed API symbols. Forbidden: @ts-ignore, as any, empty catch, JWT_SECRET, Auth0.verify, verifyWithJwks.",
      },
      {
        role: "user",
        content: [
          "## Allowed auth-jwt-v2 symbols (oracle)",
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
          "- Replace secret verify with JWKS method chain on jwksClient",
          "- REQUIRED shape (or equivalent with locals):",
          "  jwt.verify(token, (await jwksClient.getSigningKey(decodeHeader(token).kid)).getPublicKey())",
          "- getSigningKey / getPublicKey are METHODS — never free functions",
          "- Do NOT invent Auth0.verify / jwt.verifyWithJwks / verifySync",
          "- Do NOT use @ts-ignore or `as any`",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

async function main() {
  const source = readUtf8(CLIENT_SRC);
  const testSource = readUtf8(TEST_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Auth JWT Baseline B: Hybrid AI + AST + anti-cheat ===\n");
  console.log("Mode: live LLM + AST spans + Hallucination/Evasion Inspector\n");

  // Mutation barrier: never rewrite the test file
  writeUtf8(OUT_TEST, testSource);

  let contrastPhantomCount = 0;
  let contrastEvasionCount = 0;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, {
      focusAuthOnly: true,
      detectEvasion: true,
    });
    contrastPhantomCount = contrast.phantoms.length;
    contrastEvasionCount = contrast.phantoms.filter((p) =>
      [
        "@ts-ignore",
        "@ts-expect-error",
        "@ts-nocheck",
        "as any",
        "empty-catch",
        "catch-return-null",
        "deleted-assert",
        "JWT_SECRET",
      ].includes(p.symbol)
    ).length;
    console.log("--- Contrast: Inspector on latest live LLM-only Auth output ---");
    console.log(`Findings: ${contrast.phantoms.length} (evasion≈${contrastEvasionCount})`);
    for (const p of contrast.phantoms) {
      console.log(`  [${p.tier}] ${p.symbol}`);
    }
  }

  const spans = findJwtVerifySpans("verify.ts", source);
  console.log(`\nAST scan: found ${spans.length} jwt.verify span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No jwt.verify spans found — AST scan failed");
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
        focusAuthOnly: true,
        detectEvasion: true,
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
        `\nSpan L${span.startLine}: rejected live attempt ${attempt} (${inspection.phantoms.length} finding(s))`
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
          `Span L${span.startLine}: applied oracle-backed JWKS replacement after live rejects`
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

  working = finalizeClient(working);
  writeUtf8(OUT_FILE, working);

  // Confirm test file untouched (mutation barrier)
  const writtenTest = readUtf8(OUT_TEST);
  if (writtenTest !== testSource) {
    throw new Error("Mutation barrier violated: verify.test.ts was modified");
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, {
    focusAuthOnly: true,
    detectEvasion: true,
  });

  console.log("\n--- Hallucination + Evasion Inspector (final) ---");
  console.log(`Findings: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "auth_hybrid",
    api: "auth-jwt",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    contrastPhantomCount,
    contrastEvasionCount,
    spansFound: spans.length,
    attempts: attemptLog,
    testMutationBarrier: true,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck with 0 phantoms/evasions."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck with 0 phantoms/evasions; tests locked."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
