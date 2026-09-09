import express from "express";
import { createServer as createViteServer } from "vite";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

function normalizeScenario(raw) {
  if (raw === "plaid") return "plaid";
  if (raw === "openai") return "openai";
  if (raw === "stripe") return "stripe";
  if (raw === "stripe-errors") return "stripe-errors";
  if (raw === "auth") return "auth";
  if (raw === "envelope") return "envelope";
  if (raw === "async") return "async";
  if (raw === "mail") return "mail";
  if (raw === "hmac") return "hmac";
  if (raw === "discriminator") return "discriminator";
  return "morphpay";
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
    const beforeParts = ["notify.ts", "cron.ts", "seed.ts"].map((f) => {
      const body = readMaybe(
        path.join(ROOT, "fixtures/mail-client-v1/src", f)
      );
      return body ? `// ===== ${f} =====\n${body}` : null;
    });
    return {
      scenario: "mail",
      before: beforeParts.every(Boolean) ? beforeParts.join("\n") : null,
      without: {
        label: "Without MorphAPI (LLM-only)",
        code: readMaybe(
          path.join(ROOT, "baselines/mail_llm_only/out/project.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/mail_llm_only/out/report.json")
        ),
      },
      with: {
        label: "With MorphAPI (AI + AST completeness checklist)",
        code: readMaybe(
          path.join(ROOT, "baselines/mail_hybrid/out/project.ts")
        ),
        report: readJsonMaybe(
          path.join(ROOT, "baselines/mail_hybrid/out/report.json")
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

  let running = false;
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
      const scripts =
        scenario === "plaid"
          ? ["demo:plaid-llm-only", "demo:plaid-hybrid"]
          : scenario === "openai"
            ? ["demo:openai-llm-only", "demo:openai-hybrid"]
            : scenario === "stripe"
              ? ["demo:stripe-llm-only", "demo:stripe-hybrid"]
              : scenario === "auth"
                ? ["demo:auth-llm-only", "demo:auth-hybrid"]
                : scenario === "envelope"
                  ? ["demo:envelope-llm-only", "demo:envelope-hybrid"]
                  : scenario === "async"
                    ? ["demo:async-llm-only", "demo:async-hybrid"]
                    : scenario === "mail"
                      ? ["demo:mail-llm-only", "demo:mail-hybrid"]
                      : scenario === "hmac"
                        ? ["demo:hmac-llm-only", "demo:hmac-hybrid"]
                        : scenario === "discriminator"
                          ? [
                              "demo:discriminator-llm-only",
                              "demo:discriminator-hybrid",
                            ]
                      : scenario === "stripe-errors"
                        ? [
                            "demo:stripe-errors-llm-only",
                            "demo:stripe-errors-hybrid",
                          ]
                        : ["demo:llm-only", "demo:hybrid"];
      const a = await runNpmScript(scripts[0]);
      const b = await runNpmScript(scripts[1]);
      res.json({
        ok: true,
        scenario,
        logs: {
          llmOnly: (a.stdout + a.stderr).slice(-3000),
          hybrid: (b.stdout + b.stderr).slice(-3000),
        },
        results: getResults(scenario),
      });
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
