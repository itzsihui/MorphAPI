import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertEnvelopeUnwrap,
  findListUsersAwaitSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  oracleEnvelopeReplacementForSpan,
  readUtf8,
  runTypecheck,
  writeUtf8,
  type UsageSpan,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const API_SRC = path.join(ROOT, "fixtures/users-client-v1/src/api.ts");
const USERS_SRC = path.join(ROOT, "fixtures/users-client-v1/src/users.ts");
const DOCS = path.join(ROOT, "docs/users-list-v2.md");
const ORACLE = path.join(ROOT, "oracle/users-list-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/envelope_llm_only/out/api.ts");
const OUT_API = path.join(__dirname, "../out/api.ts");
const OUT_USERS = path.join(__dirname, "../out/users.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

function rewriteImports(source: string): string {
  if (/from\s+["']users-list-v1["']/.test(source)) {
    return source.replace(
      /from\s+["']users-list-v1["']/,
      `from "users-list-v2"`
    );
  }
  if (!/from\s+["']users-list-v2["']/.test(source)) {
    return `import createUsersApi from "users-list-v2";\n${source}`;
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import createUsersApi from "users-list-v2";\nconst api = createUsersApi("k");\nexport async function loadUsers() {\n  return ${expr};\n}\n`;
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
          "You migrate users-list API call sites at the network edge. Output ONLY a TypeScript expression that replaces the given expression so downstream User[] consumers keep working.",
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
          "- listUsers() now returns { data: User[]; pagination }",
          "- Edge adapter: return (await api.listUsers()).data so loadUsers() still yields User[]",
          "- Do NOT return the raw envelope object",
          "",
          "## Expression to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Output a single expression",
          "- Unwrap .data at the network edge",
          "- Preserve the receiver from the call site",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/;?\s*$/, "");
}

async function main() {
  const apiSource = readUtf8(API_SRC);
  const usersSource = readUtf8(USERS_SRC);
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log(
    "=== Envelope Baseline B: Hybrid AI + AST + DFG .data adapter ===\n"
  );
  console.log("Mode: live LLM + AST spans + envelope unwrap gate\n");

  let contrastBehavioralPass: boolean | null = null;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = assertEnvelopeUnwrap("api.ts", llmOnlyOut);
    contrastBehavioralPass = contrast.ok;
    console.log("--- Contrast: envelope gate on latest LLM-only edge ---");
    console.log(
      contrast.ok
        ? "LLM-only already unwrapped .data at edge"
        : `LLM-only blind sites: ${contrast.wrappedBlindCount}`
    );
    for (const s of contrast.sites) {
      console.log(
        `  L${s.startLine}: ${s.binding ?? "(expr)"} → ${
          s.unwrapped ? "unwrapped" : "BLIND"
        }`
      );
    }
  }

  // Prefer awaiting form for span detection — normalize fixture if bare return
  let working = apiSource;
  if (!/await\s+\w+\.listUsers\(/.test(working)) {
    working = working.replace(
      /return\s+(\w+)\.listUsers\(\)\s*;/,
      "return await $1.listUsers();"
    );
  }

  const spans = findListUsersAwaitSpans("api.ts", working);
  console.log(`\nAST scan: found ${spans.length} listUsers await span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No listUsers await spans found — AST scan failed");
  }

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
      const looksUnwrapped = /\.data\s*$/.test(candidateExpr.trim());

      if (inspection.ok && looksUnwrapped) {
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
      if (!looksUnwrapped) {
        reasons.push(
          "- [behavioral] must unwrap .data at edge, e.g. (await api.listUsers()).data"
        );
      }
      feedback = reasons.join("\n");
      console.log(`\nSpan L${span.startLine}: rejected live attempt ${attempt}`);
      console.log(feedback);
      attemptLog.push({
        span: `${span.startLine}:${span.startChar}`,
        attempt,
        source: "live",
        phantomCount: inspection.phantoms.length,
        behavioralPass: looksUnwrapped,
        phantoms: inspection.phantoms,
      });

      if (attempt === MAX_RETRIES) {
        accepted = oracleEnvelopeReplacementForSpan(span.text);
        usedOracleFallback = true;
        console.log(
          `Span L${span.startLine}: applied oracle-backed .data edge adapter after live rejects`
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
  writeUtf8(OUT_API, working);
  // Consumers stay as-is — edge adapter preserves User[] contract
  writeUtf8(OUT_USERS, usersSource.replace(/users-list-v1/g, "users-list-v2"));

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle);
  const finalBehavioral = assertEnvelopeUnwrap("api.ts", working);

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- DFG / envelope gate (final) ---");
  console.log(
    finalBehavioral.ok
      ? "PASS (edge unwraps .data)"
      : `FAIL (${finalBehavioral.wrappedBlindCount} blind)`
  );
  for (const s of finalBehavioral.sites) {
    console.log(
      `  L${s.startLine}: ${s.binding ?? "(expr)"} → ${
        s.unwrapped ? "unwrapped" : "BLIND"
      }`
    );
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "envelope_hybrid",
    api: "users-list",
    scenario: "payload-envelope",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    behavioralPass: finalBehavioral.ok,
    envelopeSites: finalBehavioral.sites,
    unwrappedCount: finalBehavioral.unwrappedCount,
    wrappedBlindCount: finalBehavioral.wrappedBlindCount,
    contrastBehavioralPass,
    spansFound: spans.length,
    attempts: attemptLog,
    outFile: OUT_API,
    outConsumers: OUT_USERS,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || !finalBehavioral.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, unwrap .data at edge, and have 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid passed typecheck + DFG envelope unwrap at edge."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
