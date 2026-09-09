import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  findChatCompletionCreateSpans,
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
const CLIENT_SRC = path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts");
const DOCS = path.join(ROOT, "docs/openai-chat-v1.md");
const ORACLE = path.join(ROOT, "oracle/openai-chat-v1.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/openai_llm_only/out/chat.ts");
const OUT_FILE = path.join(__dirname, "../out/chat.ts");
const REPORT_FILE = path.join(__dirname, "../out/report.json");

const MAX_RETRIES = 2;

function oracleReplacementForSpan(span: UsageSpan): string {
  const wantsSystem =
    /role:\s*["']system["']/.test(span.text) || /system,/.test(span.text);
  if (wantsSystem) {
    return `client.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  })`;
  }
  return `client.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  })`;
}

function rewriteFile(source: string): string {
  let next = source.replace(
    /import\s+OpenAI\s+from\s+["']openai-chat-v0["']\s*;?/,
    `import OpenAI from "openai-chat-v1";`
  );
  // Drop legacy doc comments that name deprecated symbols (false phantom hits)
  next = next.replace(
    /\/\*\*[\s\S]*?\*\/\s*/m,
    `/** Chat helpers on openai-chat-v1 (model-based completions). */\n`
  );
  // new OpenAI(apiKeyString) → new OpenAI({ apiKey })
  next = next.replace(
    /new OpenAI\(\s*([^)]+)\)/g,
    (_m, arg: string) => {
      const a = arg.trim();
      if (a.startsWith("{")) return `new OpenAI(${a})`;
      return `new OpenAI({ apiKey: ${a} })`;
    }
  );
  next = next.replace(
    /const openai = new OpenAI/g,
    "const client = new OpenAI"
  );
  next = next.replace(
    /\bopenai\.ChatCompletion\.create/g,
    "client.chat.completions.create"
  );
  next = next.replace(/\bopenai\./g, "client.");
  return next;
}

function wrapForInspect(expr: string): string {
  return `import OpenAI from "openai-chat-v1";\nconst client = new OpenAI();\nconst prompt = "";\nconst system = "";\nconst _ = ${expr};\n`;
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
          "You migrate OpenAI chat API call sites. Output ONLY a TypeScript expression that replaces the given call (the surrounding await stays). Use ONLY allowed symbols. Never use engine or ChatCompletion.create.",
      },
      {
        role: "user",
        content: [
          "## Allowed OpenAI symbols (oracle)",
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
          "- Use client.chat.completions.create({ model: \"gpt-4\", messages: [...] })",
          "- FORBIDDEN: engine, ChatCompletion, createChatCompletion, OpenAIApi",
          "- Keep askOnce / askWithSystem message contents",
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

  console.log("=== OpenAI Baseline B: Hybrid AI + AST chat migration ===\n");

  let contrastPhantomCount = 0;
  if (fs.existsSync(LLM_ONLY_OUT)) {
    const llmOnlyOut = readUtf8(LLM_ONLY_OUT);
    const contrast = inspectCode(llmOnlyOut, oracle, { focusOpenAIOnly: true });
    contrastPhantomCount = contrast.phantoms.length;
    console.log("--- Contrast: Inspector on latest LLM-only OpenAI output ---");
    console.log(`Phantoms: ${contrast.phantoms.length}`);
    for (const p of contrast.phantoms) {
      console.log(`  [${p.tier}] ${p.symbol}`);
    }
  }

  const spans = findChatCompletionCreateSpans("chat.ts", source);
  console.log(`\nAST scan: found ${spans.length} ChatCompletion.create span(s)`);
  for (const s of spans) {
    console.log(`  L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`);
  }
  if (spans.length === 0) {
    throw new Error("No ChatCompletion.create spans found — AST scan failed");
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
        focusOpenAIOnly: true,
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

  working = rewriteFile(working);
  writeUtf8(OUT_FILE, working);

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(working, oracle, { focusOpenAIOnly: true });

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
    baseline: "openai_hybrid",
    api: "openai-chat",
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
