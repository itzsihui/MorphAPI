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

function getResults() {
  const before = readMaybe(
    path.join(ROOT, "fixtures/client-v1/src/checkout.ts")
  );
  const withoutCode = readMaybe(
    path.join(ROOT, "baselines/llm_only/out/checkout.ts")
  );
  const withCode = readMaybe(
    path.join(ROOT, "baselines/hybrid/out/checkout.ts")
  );
  const withoutReport = readJsonMaybe(
    path.join(ROOT, "baselines/llm_only/out/report.json")
  );
  const withReport = readJsonMaybe(
    path.join(ROOT, "baselines/hybrid/out/report.json")
  );
  const docs = readMaybe(path.join(ROOT, "docs/morphpay-v2.md"));

  return {
    before,
    without: {
      label: "Without MorphAPI (LLM-only)",
      code: withoutCode,
      report: withoutReport,
    },
    with: {
      label: "With MorphAPI (AI + AST)",
      code: withCode,
      report: withReport,
    },
    docs,
    hasApiKey: Boolean(
      process.env.OPENAI_API_KEY || process.env.MORPHAPI_LLM_API_KEY
    ),
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
        // exit 2 = llm-only unexpectedly passed (still produced output)
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

  app.get("/api/results", (_req, res) => {
    res.json(getResults());
  });

  let running = false;
  app.post("/api/run", async (_req, res) => {
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
      const a = await runNpmScript("demo:llm-only");
      const b = await runNpmScript("demo:hybrid");
      res.json({
        ok: true,
        logs: {
          llmOnly: (a.stdout + a.stderr).slice(-3000),
          hybrid: (b.stdout + b.stderr).slice(-3000),
        },
        results: getResults(),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = /ENOTFOUND|Cannot reach|DNS\/network/i.test(raw)
        ? "Network blocked: cannot reach api.openai.com. Stop any agent-started UI, then run `npm run demo:ui` in your Mac terminal and try again."
        : raw.slice(0, 1500);
      res.status(500).json({
        error: friendly,
        results: getResults(),
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
