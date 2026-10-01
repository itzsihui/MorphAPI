import express from "express";
import { createServer as createViteServer } from "vite";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  getMeta,
  normalizeScenario,
  LIVE_SCENARIOS,
} from "./scenarioMeta.mjs";
import { collectSpans } from "./spansService.mjs";
import { buildScenarioGraph } from "./graphService.mjs";
import { runScenarioPipeline as runMigrationPipeline, PIPELINE_ARMS } from "./pipelineService.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 5173);

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readMaybe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJsonMaybe(filePath) {
  const text = readMaybe(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function attachRepair(report, repairPath) {
  if (!report) return report;
  const repair = readJsonMaybe(repairPath);
  if (!repair) return report;
  return { ...report, repairReport: report.repairReport ?? repair };
}

function mailProjectCode(outDir) {
  const parts = ["notify.ts", "cron.ts", "seed.ts", "onboarding.ts"].map((f) => {
    const body = readMaybe(path.join(outDir, f));
    return body ? `// ===== ${f} =====\n${body}` : null;
  });
  const joined = parts.filter(Boolean).length >= 3 ? parts.filter(Boolean).join("\n") : null;
  return joined ?? readMaybe(path.join(outDir, "project.ts"));
}

function getResults(scenarioInput = "morphpay") {
  const scenario = normalizeScenario(scenarioInput);
  const hasApiKey = Boolean(
    process.env.OPENAI_API_KEY || process.env.MORPHAPI_LLM_API_KEY
  );

  if (scenario === "plaid") {
    return {
      scenario: "plaid",
      before: readMaybe(
        path.join(ROOT, "fixtures/plaid-client-v1/src/link.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/plaid_llm_only/out/link.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/plaid_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST)",
        code: readMaybe(path.join(ROOT, "baselines/plaid_hybrid/out/link.ts")),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/plaid_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/plaid-link-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/plaid-link-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "openai") {
    return {
      scenario: "openai",
      before: readMaybe(
        path.join(ROOT, "fixtures/openai-client-v0/src/chat.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/openai_llm_only/out/chat.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/openai_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST)",
        code: readMaybe(
          path.join(ROOT, "baselines/openai_hybrid/out/chat.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/openai_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/openai-chat-v1.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/openai-chat-v1.md")),
      hasApiKey,
    };
  }

  if (scenario === "stripe") {
    return {
      scenario: "stripe",
      before: readMaybe(
        path.join(ROOT, "fixtures/stripe-client-v1/src/charge.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/stripe_llm_only/out/charge.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/stripe_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST + amount transform)",
        code: readMaybe(
          path.join(ROOT, "baselines/stripe_hybrid/out/charge.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/stripe_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/stripe-charge-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/stripe-charge-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "auth") {
    return {
      scenario: "auth",
      before: readMaybe(
        path.join(ROOT, "fixtures/auth-client-v1/src/verify.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only + repair loop)",
        code: readMaybe(
          path.join(ROOT, "baselines/auth_llm_only/out/verify.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/auth_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST + anti-cheat)",
        code: readMaybe(
          path.join(ROOT, "baselines/auth_hybrid/out/verify.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/auth_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/auth-jwt-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/auth-jwt-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "envelope") {
    return {
      scenario: "envelope",
      before: [
        readMaybe(path.join(ROOT, "fixtures/users-client-v1/src/api.ts")),
        readMaybe(path.join(ROOT, "fixtures/users-client-v1/src/users.ts")),
      ]
        .filter(Boolean)
        .join("\n\n// --- consumers (users.ts) ---\n\n"),
      without: {
        label: "Without MorphAPI (LLM-only · edge file only)",
        code: [
          readMaybe(
            path.join(ROOT, "baselines/envelope_llm_only/out/api.ts")
          ),
          readMaybe(
            path.join(ROOT, "baselines/envelope_llm_only/out/users.ts")
          ),
        ]
          .filter(Boolean)
          .join("\n\n// --- consumers left untouched ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/envelope_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST + DFG .data adapter)",
        code: [
          readMaybe(path.join(ROOT, "baselines/envelope_hybrid/out/api.ts")),
          readMaybe(
            path.join(ROOT, "baselines/envelope_hybrid/out/users.ts")
          ),
        ]
          .filter(Boolean)
          .join("\n\n// --- consumers unchanged (edge adapter) ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/envelope_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/users-list-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/users-list-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "async") {
    return {
      scenario: "async",
      before: [
        readMaybe(path.join(ROOT, "fixtures/aws-s3-client-v1/src/io.ts")),
        readMaybe(path.join(ROOT, "fixtures/aws-s3-client-v1/src/app.ts")),
      ]
        .filter(Boolean)
        .join("\n\n// --- consumers (app.ts) ---\n\n"),
      without: {
        label: "Without MorphAPI (LLM-only · leaf only)",
        code: [
          readMaybe(path.join(ROOT, "baselines/async_llm_only/out/io.ts")),
          readMaybe(path.join(ROOT, "baselines/async_llm_only/out/app.ts")),
        ]
          .filter(Boolean)
          .join("\n\n// --- consumers left untouched ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/async_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST + call-graph async fix)",
        code: [
          readMaybe(path.join(ROOT, "baselines/async_hybrid/out/io.ts")),
          readMaybe(path.join(ROOT, "baselines/async_hybrid/out/app.ts")),
        ]
          .filter(Boolean)
          .join("\n\n// --- consumers with async coloring ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/async_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/aws-s3-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/aws-s3-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "mail") {
    const beforeParts = ["notify.ts", "cron.ts", "seed.ts", "onboarding.ts"].map(
      (f) => {
        const body = readMaybe(
          path.join(ROOT, "fixtures/mail-client-v1/src", f)
        );
        return body ? `// ===== ${f} =====\n${body}` : null;
      }
    );
    const llmDir = path.join(ROOT, "baselines/mail_llm_only/out");
    const astDir = path.join(ROOT, "baselines/mail_ast/out");
    const hyDir = path.join(ROOT, "baselines/mail_hybrid/out");
    return {
      scenario: "mail",
      before: beforeParts.filter(Boolean).length >= 3
        ? beforeParts.filter(Boolean).join("\n")
        : null,
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: mailProjectCode(llmDir),
        report: attachRepair(
          readJsonMaybe(path.join(llmDir, "report.json")),
          path.join(llmDir, "repair-report.json")
        ),
      },
      ast: {
        label: "Pure AST (notify-only recipe)",
        code: mailProjectCode(astDir),
        report: attachRepair(
          readJsonMaybe(path.join(astDir, "report.json")),
          path.join(astDir, "repair-report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST completeness checklist)",
        code: mailProjectCode(hyDir),
        report: attachRepair(
          readJsonMaybe(path.join(hyDir, "report.json")),
          path.join(hyDir, "repair-report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/mail-send-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/mail-send-v2.md")),
      hasApiKey,
    };
  }


  if (scenario === "hmac") {
    return {
      scenario: "hmac",
      before: readMaybe(
        path.join(ROOT, "fixtures/webhook-client-v1/src/webhook.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/hmac_llm_only/out/webhook.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/hmac_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST + HMAC security gate)",
        code: readMaybe(
          path.join(ROOT, "baselines/hmac_hybrid/out/webhook.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/hmac_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/webhook-auth-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/webhook-auth-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "discriminator") {
    return {
      scenario: "discriminator",
      before: [
        readMaybe(
          path.join(ROOT, "fixtures/events-client-v1/src/subscribe.ts")
        ),
        readMaybe(path.join(ROOT, "fixtures/events-client-v1/src/router.ts")),
      ]
        .filter(Boolean)
        .join("\n\n// --- router.ts ---\n\n"),
      without: {
        label: "Without MorphAPI (LLM-only · subscribe only)",
        code: [
          readMaybe(
            path.join(ROOT, "baselines/discriminator_llm_only/out/subscribe.ts")
          ),
          readMaybe(
            path.join(ROOT, "baselines/discriminator_llm_only/out/router.ts")
          ),
        ]
          .filter(Boolean)
          .join("\n\n// --- router left on legacy discriminator ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/discriminator_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST switch + oracle map)",
        code: [
          readMaybe(
            path.join(ROOT, "baselines/discriminator_hybrid/out/subscribe.ts")
          ),
          readMaybe(
            path.join(ROOT, "baselines/discriminator_hybrid/out/router.ts")
          ),
        ]
          .filter(Boolean)
          .join("\n\n// --- router switch migrated ---\n\n"),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/discriminator_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/events-gateway-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/events-gateway-v2.md")),
      hasApiKey,
    };
  }

  if (scenario === "stripe-errors") {
    return {
      scenario: "stripe-errors",
      before: readMaybe(
        path.join(ROOT, "fixtures/stripe-errors-client-v1/src/charge.ts")
      ),
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/stripe_errors_llm_only/out/charge.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/stripe_errors_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST try/catch + oracle)",
        code: readMaybe(
          path.join(ROOT, "baselines/stripe_errors_hybrid/out/charge.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/stripe_errors_hybrid/out/report.json")
        ),
      },
      docs: readMaybe(path.join(ROOT, "docs/stripe-errors-v2.md")),
      docsV1: null,
      docsV2: readMaybe(path.join(ROOT, "docs/stripe-errors-v2.md")),
      hasApiKey,
    };
  }

  return {
    scenario: "morphpay",
    before: readMaybe(path.join(ROOT, "fixtures/client-v1/src/checkout.ts")),
    without: {
      label: "Without MorphAPI (LLM-only)",
      code: readMaybe(path.join(ROOT, "baselines/llm_only/out/checkout.ts")),
      report: readJsonMaybe(
        path.join(ROOT, "baselines/llm_only/out/report.json")
      ),
    },
    with: {
      label: "With MorphAPI (AI + AST)",
      code: readMaybe(path.join(ROOT, "baselines/hybrid/out/checkout.ts")),
      report: readJsonMaybe(
        path.join(ROOT, "baselines/hybrid/out/report.json")
      ),
    },
    docs: readMaybe(path.join(ROOT, "docs/morphpay-v2.md")),
    docsV1: readMaybe(path.join(ROOT, "docs/morphpay-v1.md")),
    docsV2: readMaybe(path.join(ROOT, "docs/morphpay-v2.md")),
    hasApiKey,
  };
}

function runNpmScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", scriptName], {
      cwd: ROOT,
      env: process.env,
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0 || code === 2) {
        resolve({ code, stdout, stderr });
      } else {
        reject(
          new Error(
            `${scriptName} failed (exit ${code})\n${stderr || stdout}`.slice(
              0,
              4000
            )
          )
        );
      }
    });
  });
}

async function start() {
  loadEnvFile();
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/results", (req, res) => {
    res.json(getResults(req.query.scenario));
  });

  app.get("/api/meta", (_req, res) => {
    res.json({
      scenarios: LIVE_SCENARIOS.map((id) => ({ id, ...getMeta(id) })),
    });
  });

  app.get("/api/oracle", (req, res) => {
    const meta = getMeta(req.query.scenario);
    const oracle = readJsonMaybe(path.join(ROOT, meta.oraclePath));
    if (!oracle) {
      res.status(404).json({ error: `Oracle not found: ${meta.oraclePath}` });
      return;
    }
    res.json({
      scenario: meta.id,
      path: meta.oraclePath,
      schemaDelta: meta.schemaDelta,
      astAloneReason: meta.astAloneReason,
      gateFields: meta.gateFields,
      oracle,
    });
  });

  app.get("/api/spans", async (req, res) => {
    try {
      const payload = await collectSpans(ROOT, req.query.scenario);
      res.json(payload);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/eval", async (_req, res) => {
    try {
      const modPath = pathToFileURL(
        path.join(ROOT, "scripts/eval-matrix.mjs")
      ).href;
      // Bust ESM cache so Evaluation picks up scorer edits without full redeploy
      const { buildEvalMatrix } = await import(`${modPath}?t=${Date.now()}`);
      const matrix = buildEvalMatrix(ROOT);
      res.json(matrix);
    } catch (err) {
      const cached = readJsonMaybe(path.join(ROOT, "out/eval-matrix.json"));
      if (cached) {
        res.json(cached);
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  let running = false;

  function sseWrite(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  app.get("/api/graph", async (req, res) => {
    try {
      const start = Number(req.query.start);
      const graph = await buildScenarioGraph(ROOT, normalizeScenario(req.query.scenario), {
        file: typeof req.query.file === "string" ? req.query.file : undefined,
        start: Number.isFinite(start) ? start : undefined,
      });
      res.json(graph);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const pipelineOut = (id, arm, model) => path.join(ROOT, "out", "pipeline", `${id}.${arm}.${model}.json`);
  const pipelineQuery = (q) => ({
    scenario: normalizeScenario(q.scenario),
    arm: PIPELINE_ARMS.includes(q.arm) ? q.arm : "arm1_morphapi",
    model: q.model === "frontier" ? "frontier" : "mini",
  });

  app.get("/api/pipeline/last", (req, res) => {
    const { scenario, arm, model } = pipelineQuery(req.query);
    const raw = readMaybe(pipelineOut(scenario, arm, model));
    if (raw == null) {
      res.status(404).json({ error: `No saved run for ${scenario} · ${arm} · ${model}.` });
      return;
    }
    res.type("json").send(raw);
  });

  app.get("/api/pipeline/stream", async (req, res) => {
    const { scenario, arm, model } = pipelineQuery(req.query);
    if (running) {
      res.status(409).json({ error: "A run is already in progress." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    running = true;
    try {
      const run = await runMigrationPipeline(ROOT, scenario, {
        arm,
        model,
        onEvent: (evt) => sseWrite(res, "step", evt),
      });
      fs.mkdirSync(path.dirname(pipelineOut(scenario, arm, model)), { recursive: true });
      fs.writeFileSync(pipelineOut(scenario, arm, model), JSON.stringify(run, null, 2));
      sseWrite(res, "run", run);
    } catch (err) {
      sseWrite(res, "error", { message: (err instanceof Error ? err.message : String(err)).slice(0, 1500) });
    } finally {
      running = false;
      res.end();
    }
  });

  async function runScenarioPipeline(scenario, onEvent) {
    const meta = getMeta(scenario);
    const emit = (type, payload = {}) => {
      const evt = {
        t: new Date().toISOString(),
        type,
        scenario: meta.id,
        ...payload,
      };
      onEvent(evt);
      return evt;
    };

    emit("start", { label: meta.label, message: `Workbench run · ${meta.label}` });

    try {
      const spanPayload = await collectSpans(ROOT, meta.id);
      emit("ast_scan", {
        message: `TypeScript AST: parsed ${spanPayload.spanCount} call site(s) across ${spanPayload.files.length} file(s)`,
        spanCount: spanPayload.spanCount,
        files: spanPayload.files.map((f) => ({
          name: f.name,
          spans: f.spans.length,
        })),
        engine: spanPayload.engine,
      });
    } catch (err) {
      emit("ast_scan_error", {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const scripts = meta.scripts ?? [];
    const logs = {};
    let lastHybridReport = null;

    for (const script of scripts) {
      const isAst = /[-:]ast\b|_ast\b|demo:.*-ast/.test(script) || script.includes("-ast");
      const isHybrid = script.includes("hybrid");
      const phase = isHybrid ? "hybrid" : isAst ? "ast" : "llm_only";

      emit(`${phase}_start`, {
        message: `${phase} baseline: ${script}`,
        script,
      });
      const run = await runNpmScript(script);
      logs[phase] = (run.stdout + run.stderr).slice(-3000);
      const resultsNow = getResults(meta.id);
      const report =
        phase === "hybrid"
          ? resultsNow.with?.report
          : phase === "ast"
            ? resultsNow.ast?.report
            : resultsNow.without?.report;

      if (phase === "ast") {
        const repair = report?.repairReport;
        emit("ast_alone_done", {
          message: `Pure AST done · typecheck=${report?.typecheckPass ? "PASS" : "FAIL"} · after primary discovered ${repair?.summary?.fixesDiscoveredAfterPrimary ?? "?"} · remaining ${repair?.summary?.fixesRemainingAfterPrimary ?? "?"}`,
          exitCode: run.code,
          typecheckPass: report?.typecheckPass,
          completenessPass: report?.completenessPass,
          fixesDiscoveredAfterPrimary:
            repair?.summary?.fixesDiscoveredAfterPrimary,
          fixesRemainingAfterPrimary:
            repair?.summary?.fixesRemainingAfterPrimary,
        });
      } else if (phase === "llm_only") {
        emit("llm_only_done", {
          message: `AI-alone done · typecheck=${report?.typecheckPass ? "PASS" : "FAIL"} · phantoms=${report?.phantomCount ?? "?"}`,
          exitCode: run.code,
          phantoms: report?.phantoms ?? [],
          typecheckPass: report?.typecheckPass,
        });
      } else {
        lastHybridReport = report;
        const attempts = report?.attempts ?? [];
        for (const attempt of attempts) {
          const rejected = (attempt.phantomCount ?? 0) > 0;
          emit(rejected ? "inspect_reject" : "inspect_accept", {
            message: rejected
              ? `Inspector REJECTED span ${attempt.span} (attempt ${attempt.attempt}, source=${attempt.source}) · phantoms=${attempt.phantomCount}`
              : `Inspector ACCEPTED span ${attempt.span} (attempt ${attempt.attempt}, source=${attempt.source})`,
            attempt,
          });
        }
        const repair = report?.repairReport;
        emit("typecheck", {
          message: `Hybrid gate · typecheck=${report?.typecheckPass ? "PASS" : "FAIL"} · phantoms=${report?.phantomCount ?? 0} · spansFound=${report?.spansFound ?? "?"} · cascade discovered ${repair?.summary?.fixesDiscoveredAfterPrimary ?? "?"} completed ${repair?.summary?.fixesCompletedAfterPrimary ?? "?"}`,
          typecheckPass: report?.typecheckPass,
          phantomCount: report?.phantomCount,
          spansFound: report?.spansFound,
          usedOracleFallback: report?.usedOracleFallback,
          fixesDiscoveredAfterPrimary:
            repair?.summary?.fixesDiscoveredAfterPrimary,
          fixesCompletedAfterPrimary:
            repair?.summary?.fixesCompletedAfterPrimary,
        });
      }
    }

    emit("done", {
      message: "Pipeline complete",
      ok: true,
    });

    return {
      ok: true,
      scenario: meta.id,
      logs: {
        llmOnly: logs.llm_only ?? "",
        ast: logs.ast ?? "",
        hybrid: logs.hybrid ?? "",
      },
      results: getResults(meta.id),
      hybridReport: lastHybridReport,
    };
  }

  app.get("/api/run/stream", async (req, res) => {
    const scenario = normalizeScenario(req.query.scenario);
    if (running) {
      res.status(409).json({ error: "A demo run is already in progress." });
      return;
    }
    if (!process.env.OPENAI_API_KEY && !process.env.MORPHAPI_LLM_API_KEY) {
      res.status(400).json({
        error: "OPENAI_API_KEY missing in .env — required for live LLM runs.",
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    running = true;
    try {
      const result = await runScenarioPipeline(scenario, (evt) => {
        sseWrite(res, evt.type, evt);
      });
      sseWrite(res, "results", {
        t: new Date().toISOString(),
        type: "results",
        results: result.results,
        logs: result.logs,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = /ENOTFOUND|Cannot reach|DNS\/network/i.test(raw)
        ? "Network blocked: cannot reach api.openai.com. Run `npm run demo:ui` in your Mac terminal and try again."
        : raw.slice(0, 1500);
      sseWrite(res, "error", {
        t: new Date().toISOString(),
        type: "error",
        message: friendly,
        results: getResults(scenario),
      });
    } finally {
      running = false;
      res.end();
    }
  });

  app.post("/api/run", async (req, res) => {
    const scenario = normalizeScenario(req.body?.scenario);
    if (running) {
      res.status(409).json({ error: "A demo run is already in progress." });
      return;
    }
    if (!process.env.OPENAI_API_KEY && !process.env.MORPHAPI_LLM_API_KEY) {
      res.status(400).json({
        error: "OPENAI_API_KEY missing in .env — required for live LLM runs.",
      });
      return;
    }
    running = true;
    try {
      const result = await runScenarioPipeline(scenario, () => {});
      res.json(result);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = /ENOTFOUND|Cannot reach|DNS\/network/i.test(raw)
        ? "Network blocked: cannot reach api.openai.com. Run `npm run demo:ui` in your Mac terminal and try again."
        : raw.slice(0, 1500);
      res.status(500).json({
        error: friendly,
        results: getResults(scenario),
      });
    } finally {
      running = false;
    }
  });

  // Never let unknown /api/* fall through to Vite SPA HTML
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` });
  });

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    console.log(`MorphAPI demo UI → http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
