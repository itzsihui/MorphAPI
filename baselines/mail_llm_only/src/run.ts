import * as path from "path";
import {
  assertMailMigrationComplete,
  inspectCode,
  loadEnv,
  loadOracle,
  readUtf8,
  runTypecheck,
  stripCodeFences,
  writeUtf8,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = path.join(ROOT, "fixtures/mail-client-v1/src");
const DOCS = path.join(ROOT, "docs/mail-send-v2.md");
const ORACLE = path.join(ROOT, "oracle/mail-send-v2.json");
const OUT_DIR = path.join(__dirname, "../out");
const REPORT_FILE = path.join(OUT_DIR, "report.json");

const FILES = ["notify.ts", "cron.ts", "seed.ts"] as const;

function parseMultiFileOutput(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re =
    /```(?:typescript|ts)?\s*(?:file[=:]?\s*)?([\w./-]+\.ts)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let name = m[1] ? path.basename(m[1]) : "";
    const body = m[2].trim() + "\n";
    if (!name) {
      const header = /^\/\/\s*=*\s*([\w.-]+\.ts)\b/m.exec(body);
      if (header) name = header[1];
    }
    if (!name) {
      // Infer from contents
      if (/notifyUser|notifyPasswordReset/.test(body)) name = "notify.ts";
      else if (/runNightlyDigest/.test(body)) name = "cron.ts";
      else if (/seedWelcomeEmails/.test(body)) name = "seed.ts";
    }
    if (name) result[name] = body;
  }
  if (Object.keys(result).length === 0) {
    const code = stripCodeFences(raw);
    if (code.trim()) {
      result["notify.ts"] = code.endsWith("\n") ? code : code + "\n";
    }
  }
  return result;
}

function concatForDisplay(files: Record<string, string>): string {
  return FILES.map((f) => {
    const body = files[f] ?? `// MISSING FILE: ${f}\n`;
    return `// ===== ${f} =====\n${body}`;
  }).join("\n");
}

async function generateRawMultiFile(args: {
  docs: string;
  fileBlocks: string;
}): Promise<{ content: string; model: string }> {
  const apiKey =
    process.env.OPENAI_API_KEY ?? process.env.MORPHAPI_LLM_API_KEY ?? "";
  const baseUrl =
    process.env.OPENAI_BASE_URL ??
    process.env.MORPHAPI_LLM_BASE_URL ??
    "https://api.openai.com/v1";
  const model = process.env.MORPHAPI_LLM_MODEL ?? "gpt-4o-mini";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a busy engineer doing a quick migration pass. Prefer shipping the main product path first. Output fenced TypeScript files tagged with filenames only for files you changed.",
        },
        {
          role: "user",
          content: `## mail-send v2 docs\n\n${args.docs}\n\n## Project sources (mail-send-v1)\n\n${args.fileBlocks}\n\nQuick task: migrate the **notification service** (\`notify.ts\`) to mail-send-v2 \`send({ to, from, subject, content })\` so user emails work.\nCron/seed are low-priority ops scripts — only touch them if you have time.\nPreserve exported function names in any file you edit.\nReturn changed files as:\n\`\`\`ts notify.ts\n...\n\`\`\``,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { content: json.choices?.[0]?.message?.content ?? "", model };
}

async function main() {
  const sources: Record<string, string> = {};
  for (const f of FILES) {
    sources[f] = readUtf8(path.join(FIXTURE, f));
  }
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Mail Baseline A: LLM-only multi-site migration ===\n");
  console.log("Mode: live LLM (Scenario 7 · widespread / incomplete multi-site)");
  console.log(
    "Claim: model prioritizes notify.ts; often leaves cron/seed sendEmail sites.\n"
  );

  const fileBlocks = FILES.map(
    (f) => `### ${f}\n\`\`\`ts\n${sources[f]}\`\`\``
  ).join("\n\n");

  const raw = await generateRawMultiFile({ docs, fileBlocks });
  const parsed = parseMultiFileOutput(raw.content);
  const outFiles: Record<string, string> = {};

  for (const f of FILES) {
    // Omitted files stay on v1 call shape — incomplete multi-site (honest miss).
    const next = parsed[f] ?? sources[f];
    outFiles[f] = next;
    writeUtf8(path.join(OUT_DIR, f), next);
  }
  writeUtf8(path.join(OUT_DIR, "project.ts"), concatForDisplay(outFiles));

  console.log(`\nWrote → ${OUT_DIR}/{notify,cron,seed,project}.ts`);
  console.log(`Model: ${raw.model}`);
  console.log(
    `Files returned by model: ${Object.keys(parsed).join(", ") || "(none)"}`
  );

  const combined = concatForDisplay(outFiles);
  const inspection = inspectCode(combined, oracle);
  console.log("\n--- Hallucination Inspector ---");
  console.log(`Phantoms found: ${inspection.phantoms.length}`);
  for (const p of inspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  const completeness = assertMailMigrationComplete(outFiles, 4);
  console.log("\n--- Completeness gate (all sendEmail sites migrated) ---");
  console.log(
    completeness.ok
      ? `PASS (${completeness.migratedCount} send() / 0 leftover)`
      : `FAIL (leftover sendEmail=${completeness.leftoverCount}, migrated send=${completeness.migratedCount}, expected≥${completeness.expectedSites})`
  );
  for (const s of completeness.sites) {
    console.log(
      `  ${s.fileName}:L${s.startLine} [${s.kind}] ${s.text.slice(0, 80)}`
    );
  }

  const tc = runTypecheck(path.join(__dirname, ".."));
  console.log("\n--- Typecheck (tsc --noEmit on out/) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "mail_llm_only",
    api: "mail-send",
    scenario: "multi-site",
    mode: "live" as const,
    model: raw.model,
    typecheckPass: tc.ok,
    phantomCount: inspection.phantoms.length,
    phantoms: inspection.phantoms,
    completenessPass: completeness.ok,
    leftoverCount: completeness.leftoverCount,
    migratedCount: completeness.migratedCount,
    expectedSites: completeness.expectedSites,
    sites: completeness.sites,
    filesReturned: Object.keys(parsed),
    outDir: OUT_DIR,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!completeness.ok) {
    console.log(
      "\nClaim check: LIVE LLM-only left incomplete multi-site migration (expected Scenario 7)."
    );
  } else {
    console.warn(
      "\nNote: LLM-only completed all sites this run (non-deterministic). Re-run; claim is about incomplete rate."
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
