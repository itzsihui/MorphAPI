import * as fs from "fs";
import * as path from "path";
import {
  applySpanReplacement,
  assertMailMigrationComplete,
  findSendEmailSpans,
  generateCode,
  inspectCode,
  loadEnv,
  loadOracle,
  oracleMailReplacementForSpan,
  readUtf8,
  runTypecheck,
  writeUtf8,
  type UsageSpan,
} from "@morphapi/core";

loadEnv(path.resolve(__dirname, "../../.."));

const ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = path.join(ROOT, "fixtures/mail-client-v1/src");
const DOCS = path.join(ROOT, "docs/mail-send-v2.md");
const ORACLE = path.join(ROOT, "oracle/mail-send-v2.json");
const LLM_ONLY_OUT = path.join(ROOT, "baselines/mail_llm_only/out");
const OUT_DIR = path.join(__dirname, "../out");
const REPORT_FILE = path.join(OUT_DIR, "report.json");

const FILES = ["notify.ts", "cron.ts", "seed.ts"] as const;
const MAX_RETRIES = 2;

function rewriteImports(source: string): string {
  if (/from\s+["']mail-send-v1["']/.test(source)) {
    return source.replace(
      /import\s+sendEmail\s+from\s+["']mail-send-v1["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  if (/sendEmail/.test(source) && /from\s+["']mail-send-v2["']/.test(source)) {
    return source.replace(
      /import\s+sendEmail\s+from\s+["']mail-send-v2["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  if (!/from\s+["']mail-send-v2["']/.test(source)) {
    return `import send from "mail-send-v2";\n${source}`;
  }
  if (!/\bsend\b/.test(source.split("\n")[0] ?? "")) {
    return source.replace(
      /import\s+\w+\s+from\s+["']mail-send-v2["']\s*;?/,
      `import send from "mail-send-v2";`
    );
  }
  return source;
}

function wrapForInspect(expr: string): string {
  return `import send from "mail-send-v2";\nconst email = "";\nconst name = "";\nconst token = "";\nconst opsInbox = "";\nconst summary = "";\nconst tenant = "";\nconst _ = ${expr};\n`;
}

function concatForDisplay(files: Record<string, string>): string {
  return FILES.map((f) => {
    const body = files[f] ?? `// MISSING FILE: ${f}\n`;
    return `// ===== ${f} =====\n${body}`;
  }).join("\n");
}

async function proposeLiveReplacement(args: {
  span: UsageSpan;
  docs: string;
  feedback?: string;
}): Promise<string> {
  const { code } = await generateCode({
    messages: [
      {
        role: "system",
        content:
          "You migrate mail-send API call sites. Output ONLY a TypeScript expression that replaces the given sendEmail(...) call (surrounding await stays).",
      },
      {
        role: "user",
        content: [
          "## Docs",
          args.docs,
          "",
          "## Call site to replace",
          "```ts",
          args.span.text,
          "```",
          "",
          "Rules:",
          "- Replace sendEmail(to, from, subject, body) with send({ to, from, subject, content: body })",
          "- Do not invent symbols; use send from mail-send-v2",
          "- Preserve argument expressions",
          args.feedback ? `\nPrevious attempt rejected:\n${args.feedback}` : "",
        ].join("\n"),
      },
    ],
  });
  return code.trim().replace(/^await\s+/, "").replace(/;?\s*$/, "");
}

function looksLikeSend(expr: string): boolean {
  return /^\s*send\s*\(/.test(expr) && !/sendEmail/.test(expr);
}

async function main() {
  const docs = readUtf8(DOCS);
  const oracle = loadOracle(ORACLE);

  console.log("=== Mail Baseline B: Hybrid AI + AST completeness checklist ===\n");
  console.log("Mode: live LLM + AST spans across notify/cron/seed\n");

  let contrastLeftover: number | null = null;
  if (fs.existsSync(path.join(LLM_ONLY_OUT, "report.json"))) {
    try {
      const prev = JSON.parse(
        readUtf8(path.join(LLM_ONLY_OUT, "report.json"))
      ) as { leftoverCount?: number };
      contrastLeftover = prev.leftoverCount ?? null;
      console.log("--- Contrast: LLM-only leftover sendEmail sites ---");
      console.log(`leftover=${contrastLeftover}`);
    } catch {
      /* ignore */
    }
  }

  const working: Record<string, string> = {};
  for (const f of FILES) {
    working[f] = readUtf8(path.join(FIXTURE, f));
  }

  type FileSpan = UsageSpan & { file: string };
  const allSpans: FileSpan[] = [];
  for (const f of FILES) {
    for (const span of findSendEmailSpans(f, working[f])) {
      allSpans.push({ ...span, file: f });
    }
  }

  console.log(`AST scan: found ${allSpans.length} sendEmail span(s) across files`);
  for (const s of allSpans) {
    console.log(
      `  ${s.file}:L${s.startLine}:${s.startChar}-L${s.endLine}:${s.endChar}`
    );
  }
  if (allSpans.length === 0) {
    throw new Error("No sendEmail spans found — AST scan failed");
  }

  const attemptLog: Array<Record<string, unknown>> = [];
  let usedOracleFallback = false;

  // Process per-file, end→start so offsets stay valid
  for (const f of FILES) {
    const fileSpans = allSpans
      .filter((s) => s.file === f)
      .sort((a, b) => b.start - a.start);

    for (const span of fileSpans) {
      let feedback: string | undefined;
      let accepted: string | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const candidateExpr = await proposeLiveReplacement({
          span,
          docs,
          feedback,
        });

        const inspection = inspectCode(wrapForInspect(candidateExpr), oracle);
        const shapeOk = looksLikeSend(candidateExpr) && !/sendEmail/.test(candidateExpr);

        if (inspection.ok && shapeOk) {
          accepted = candidateExpr;
          console.log(
            `\n${f}:L${span.startLine}: accepted live LLM proposal on attempt ${attempt}`
          );
          attemptLog.push({
            file: f,
            span: `${span.startLine}:${span.startChar}`,
            attempt,
            source: "live",
          });
          break;
        }

        feedback = [
          ...inspection.phantoms.map(
            (p) => `- [${p.tier}] ${p.symbol}: ${p.reason}`
          ),
          !shapeOk
            ? "- must be send({ to, from, subject, content }) — not sendEmail"
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        console.log(
          `\n${f}:L${span.startLine}: rejected live attempt ${attempt}`
        );
        console.log(feedback);
        attemptLog.push({
          file: f,
          span: `${span.startLine}:${span.startChar}`,
          attempt,
          source: "live",
          rejected: true,
        });

        if (attempt === MAX_RETRIES) {
          accepted = oracleMailReplacementForSpan(span.text);
          usedOracleFallback = true;
          console.log(
            `${f}:L${span.startLine}: applied oracle-backed send({...}) after live rejects`
          );
          attemptLog.push({
            file: f,
            span: `${span.startLine}:${span.startChar}`,
            attempt: attempt + 1,
            source: "oracle_fallback",
          });
        }
      }

      if (!accepted) throw new Error("No accepted replacement");
      working[f] = applySpanReplacement(
        working[f],
        span.start,
        span.end,
        accepted
      );
    }

    working[f] = rewriteImports(working[f]);
  }

  for (const f of FILES) {
    writeUtf8(path.join(OUT_DIR, f), working[f]);
  }
  writeUtf8(path.join(OUT_DIR, "project.ts"), concatForDisplay(working));

  const tc = runTypecheck(path.join(__dirname, ".."));
  const finalInspection = inspectCode(concatForDisplay(working), oracle);
  const completeness = assertMailMigrationComplete(working, 4);

  console.log("\n--- Hallucination Inspector (final) ---");
  console.log(`Phantoms found: ${finalInspection.phantoms.length}`);
  for (const p of finalInspection.phantoms) {
    console.log(`  [${p.tier}] ${p.symbol} — ${p.reason}`);
  }

  console.log("\n--- Completeness gate (final) ---");
  console.log(
    completeness.ok
      ? `PASS (${completeness.migratedCount} send() / 0 leftover)`
      : `FAIL (leftover=${completeness.leftoverCount}, migrated=${completeness.migratedCount})`
  );
  for (const s of completeness.sites) {
    console.log(
      `  ${s.fileName}:L${s.startLine} [${s.kind}] ${s.text.slice(0, 80)}`
    );
  }

  console.log("\n--- Typecheck (tsc --noEmit) ---");
  console.log(tc.ok ? "PASS" : "FAIL");
  if (!tc.ok) {
    console.log((tc.stdout + "\n" + tc.stderr).trim().slice(0, 2000));
  }

  const report = {
    baseline: "mail_hybrid",
    api: "mail-send",
    scenario: "multi-site",
    mode: "live",
    usedOracleFallback,
    typecheckPass: tc.ok,
    phantomCount: finalInspection.phantoms.length,
    phantoms: finalInspection.phantoms,
    completenessPass: completeness.ok,
    leftoverCount: completeness.leftoverCount,
    migratedCount: completeness.migratedCount,
    expectedSites: completeness.expectedSites,
    sites: completeness.sites,
    contrastLeftover,
    spansFound: allSpans.length,
    attempts: attemptLog,
    outDir: OUT_DIR,
  };
  writeUtf8(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport → ${REPORT_FILE}`);

  if (!tc.ok || !completeness.ok || finalInspection.phantoms.length > 0) {
    console.error(
      "\nClaim check FAILED: hybrid should typecheck, migrate all sites, 0 phantoms."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nClaim check: hybrid completed all multi-site spans + typecheck."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
