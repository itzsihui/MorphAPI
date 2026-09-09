import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertHmacSecurity,
  findAuthorizeLegacyCompatSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  oracleAuthorizeLegacyCompatReplacement,
  readUtf8,
  runTypecheck,
  writeUtf8,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const CLIENT_SRC = path.join(ROOT, "fixtures/webhook-client-v1/src/webhook.ts");
const DOCS = path.join(ROOT, "docs/webhook-auth-v2.md");
const ORACLE = path.join(ROOT, "oracle/webhook-auth-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/hmac_llm_only/out/webhook.ts");
const OUT_FILE = path.join(__dirname, "../out/webhook.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

function rewriteImports(source: string): string {
  let out = source;
  // Drop mid-file imports the model sometimes injects into replacements
  out = out.replace(
    /^\s*import\s+[\s\S]*?from\s+["']webhook-auth-v[12]["']\s*;?\s*$/gm,
    ""
  );
  if (/from\s+["']webhook-auth-v1["']/.test(out)) {
    out = out.replace(
      /import\s+verifyWebhookRequest\s*,\s*\{\s*type\s+WebhookRequest\s*\}\s+from\s+["']webhook-auth-v1["']\s*;?/,
      `import verifyWebhookRequest, { type WebhookRequest } from "webhook-auth-v2";`
    );
    out = out.replace(
      /from\s+["']webhook-auth-v1["']/,
      'from "webhook-auth-v2"'
    );
  }
  if (!/from\s+["']webhook-auth-v2["']/.test(out)) {
    out = `import verifyWebhookRequest, { type WebhookRequest } from "webhook-auth-v2";\n${out}`;
  }
  // Collapse duplicate verifyWebhookRequest imports to one canonical line
  const importLines = out.match(/^import[\s\S]*?from\s+["']webhook-auth-v2["']\s*;?\s*$/gm) ?? [];
  if (importLines.length > 1) {
    out = out.replace(/^import[\s\S]*?from\s+["']webhook-auth-v2["']\s*;?\s*$/gm, "");
    out = `import verifyWebhookRequest, { type WebhookRequest } from "webhook-auth-v2";\n${out.trimStart()}`;
  }
  return out;
}

function normalizeLegacyCompatCandidate(raw: string): string {
  let code = raw.trim();
  code = code.replace(/^import[\s\S]*?;\s*/gm, "");
  // Prefer pure delegate form
  if (/verifyWebhookRequest\s*\(\s*req\s*\)/.test(code)) {
    return oracleAuthorizeLegacyCompatReplacement();
  }
  return code.replace(/;?\s*$/, "");
}

function looksSafeLegacyCompat(fn: string): boolean {
  const compact = fn.replace(/\s+/g, " ");
  return (
    /export function authorizeLegacyCompat\(req: WebhookRequest\): boolean/.test(
      compact
    ) &&
    /return verifyWebhookRequest\(req\);/.test(compact) &&
    !/WEBHOOK_TOKEN/.test(fn) &&
    !/===/.test(fn) &&
    !/import\s+/.test(fn)
  );
}

async function proposeLegacyCompat(args: {
  spanText: string;
  docs: string;
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate webhook auth helpers. Output ONLY a full TypeScript function declaration for authorizeLegacyCompat. Use webhook-auth-v2 verifyWebhookRequest. Do not invent Slack/Shopify helpers. Do not use === on signatures or query tokens.",
      },
      {
        role: "user",
        content: [
          "## Docs",
          args.docs,
          "",
          "## Function to replace",
          "```ts",
          args.spanText,
          "```",
          "",
          "Rules:",
          "- export function authorizeLegacyCompat(req: WebhookRequest): boolean",
          "- Delegate to verifyWebhookRequest(req) OR implement HMAC with createHmac + timingSafeEqual",
          "- Never compare signatures/tokens with ===",
          "- Never call verifySlackRequest / verifyShopifyWebhook / slack.verifyWebhook",
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

  console.log("=== HMAC Baseline B: Hybrid AI + AST + security gate ===\n");
  console.log("Mode: live LLM + authorizeLegacyCompat span + HMAC oracle\n");

  let contrastSecurityPass: boolean | null = null;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const prev = assertHmacSecurity(readUtf8(LLM_ONLY_OUT));
    contrastSecurityPass = prev.ok;
    console.log("--- Contrast: security gate on latest LLM-only output ---");
    console.log(prev.ok ? "LLM-only security PASS" : "LLM-only security FAIL");
    for (const f of prev.findings.filter((x) => !x.ok)) {
      console.log(`  [${f.kind}] ${f.detail}`);
    }
  }

  let working = rewriteImports(source);
  const spans = findAuthorizeLegacyCompatSpans("webhook.ts", working);
  console.log(
    `\nAST scan: found ${spans.length} authorizeLegacyCompat span(s)`
  );
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No authorizeLegacyCompat span — AST scan failed");
  }

  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  const sorted = [...spans].sort((a, b) => b.start - a.start);
  for (const span of sorted) {
    let feedback: string | undefined;
    let accepted: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const candidateRaw = await proposeLegacyCompat({
        spanText: span.text,
        docs,
        feedback,
      });
      const candidate = normalizeLegacyCompatCandidate(candidateRaw);

      const probe = rewriteImports(
        working.slice(0, span.start) + candidate + working.slice(span.end)
      );
      const inspection = inspectCode(probe, oracle);
      const security = assertHmacSecurity(probe);
      const shapeOk = looksSafeLegacyCompat(candidate);

      if (inspection.ok && security.ok && shapeOk) {
        accepted = candidate;
        console.log(
          `\nSpan L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          securityPass: true,
        });
        break;
      }

      feedback = [
        ...inspection.phantoms.map(
          (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
        ),
        ...security.findings
          .filter((f) => !f.ok)
          .map((f) => `- [security] ${f.kind}: ${f.detail}`),
        !shapeOk
          ? "- function must be: export function authorizeLegacyCompat(req: WebhookRequest): boolean { return verifyWebhookRequest(req); }"
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      console.log(`\nSpan L${span.startLine}: rejected live attempt ${attempt}`);
      console.log(feedback);
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        securityPass: security.ok,
        phantomCount: inspection.phantoms.length,
        shapeOk,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleAuthorizeLegacyCompatReplacement();
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle-backed authorizeLegacyCompat`
        );
        attemptLog.push({
          span: `${span.startLine}:${span.startChar}`,
          attempt: attempt + 1,
          source: "oracle_fallback",
        });
      }
    }

    if (!accepted) throw new Error("No accepted replacement");
    working = applySpanReplacement(working, span.start, span.end, accepted);
  }

  working = rewriteImports(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle);
  const finalSecurity = assertHmacSecurity(working);

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Security gate (final) ---");
  console.log(finalSecurity.ok ? "PASS" : "FAIL");
  for (const f of finalSecurity.findings) {
    console.log(`  [${f.ok ? "ok" : "FAIL"}] ${f.kind}: ${f.detail}`);
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "hmac_hybrid",
    api: "webhook-auth",
    scenario: "auth-hmac",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    securityPass: finalSecurity.ok,
    staticTokenCount: finalSecurity.staticTokenCount,
    unsafeCompareCount: finalSecurity.unsafeCompareCount,
    securityFindings: finalSecurity.findings,
    contrastSecurityPass,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_FILE,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || !finalSecurity.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, pass security gate, 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck + HMAC security gate."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
