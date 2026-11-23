// Cross-version behaviour driver for probot (task: octokit-webhooks-probot). usage: node probot_driver.js <projectDir>
// Written 2026-11-24 BEFORE any agent run on this task. Plays the role of a Probot app author using only probot's
// public, non-deprecated API of the start version (Probot, createNodeMiddleware, ProbotOctokit, Context helpers,
// probot.receive). Every step's observable effect is recorded:
//   out  = HTTP status of the webhook delivery (body text excluded: it is the library's error wording) + what the
//          app's handlers saw (event, action, id, Context helper results)
//   wire = outgoing GitHub API requests (method, path, body), intercepted with nock
// Output is a trace in scripts/crossver format, compared with the ORIGINAL probot (@octokit/webhooks 7) by compare.mjs.
"use strict";
const fs = require("fs"); const path = require("path"); const http = require("http"); const crypto = require("crypto");
const proj = path.resolve(process.argv[2]);
const req = (m) => require(require.resolve(m, { paths: [proj] }));
const ts = req("typescript"); const nock = req("nock");
// transpile the project's src/ to lib/ (type errors do not stop it: this checks behaviour, tsc checks types)
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(path.join(proj, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) {
  const out = path.join(proj, "lib", path.relative(path.join(proj, "src"), f)).replace(/\.ts$/, ".js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, esModuleInterop: true, resolveJsonModule: true } }).outputText);
}
for (const f of walk(path.join(proj, "src")).filter((f) => f.endsWith(".json"))) { const out = path.join(proj, "lib", path.relative(path.join(proj, "src"), f)); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(f, out); }

const SECRET = "secret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const repo = { id: 1, name: "testing-things", full_name: "hiimbex/testing-things", owner: { login: "hiimbex", type: "User" } };
const P = {
  issueOpened: { action: "opened", issue: { number: 7, title: "t", body: "b", html_url: "https://github.com/hiimbex/testing-things/issues/7" }, repository: repo, sender: { login: "alice", type: "User" }, installation: { id: 2 } },
  issueOpenedByBot: { action: "opened", issue: { number: 8, title: "t", body: "b" }, repository: repo, sender: { login: "bot[bot]", type: "Bot" }, installation: { id: 2 } },
  prOpened: { action: "opened", number: 3, pull_request: { number: 3, title: "p", body: "x" }, repository: repo, sender: { login: "alice", type: "User" }, installation: { id: 2 } },
  issueClosed: { action: "closed", issue: { number: 9, title: "t", body: "b" }, repository: repo, sender: { login: "alice", type: "User" }, installation: { id: 2 } },
};
const sign = (body) => ({ "x-hub-signature": "sha1=" + crypto.createHmac("sha1", SECRET).update(body).digest("hex"),
  "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex") });

(async () => {
  const trace = { scenario: "probot", ver: "?", preds: [], calls: [] }; let cur = null; const seen = [];
  nock.disableNetConnect(); nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  const reply = function (uri, body) { const e = { op: "github", req: { method: this.req.method, path: uri.split("?")[0], body: body || null } };
    let res = { id: 1 }; if (/access_tokens$/.test(uri)) res = { token: "v1.inst", expires_at: "2099-01-01T00:00:00Z", permissions: {}, repository_selection: "all" };
    e.res = res; if (cur) cur.wire.push(e); return [/access_tokens$/.test(uri) ? 201 : 200, res]; };
  for (const m of ["get", "post", "patch", "put", "delete"]) nock("https://api.github.com").persist()[m](/.*/).reply(reply);

  let probotLib; try { probotLib = require(path.join(proj, "lib", "index.js")); }
  catch (e) { process.stdout.write(JSON.stringify({ fatal: "cannot load probot: " + String(e.message).slice(0, 200) })); return; }
  const { Probot, ProbotOctokit, createNodeMiddleware } = probotLib;
  const safe = (f) => { try { const v = f(); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch (e) { return { threw: String(e.message).slice(0, 80) }; } };
  const see = (ctx, extra) => seen.push({ name: ctx.name, action: ctx.payload && ctx.payload.action, id: ctx.id, repo: safe(() => ctx.repo({ extra: 1 })),
    issue: safe(() => ctx.issue()), pullRequest: safe(() => ctx.pullRequest()), isBot: safe(() => ctx.isBot), ...extra });
  const appFn = (app) => {
    app.on("issues.opened", async (ctx) => { see(ctx); await ctx.octokit.issues.createComment(ctx.issue({ body: "Thanks for opening this issue!" })); });
    app.on(["pull_request.opened", "pull_request.reopened"], async (ctx) => { see(ctx); });
    app.on("issues.closed", async (ctx) => { see(ctx); throw new Error("handler failed"); });
  };
  let probot, server, port;
  try {
    probot = new Probot({ appId: 1, privateKey, secret: SECRET, logLevel: "fatal",
      Octokit: ProbotOctokit.defaults({ retry: { enabled: false }, throttle: { enabled: false } }) });
    server = http.createServer(createNodeMiddleware(appFn, { probot }));
    await new Promise((r) => server.listen(0, "127.0.0.1", r)); port = server.address().port;
  } catch (e) { process.stdout.write(JSON.stringify({ fatal: "setup failed: " + String(e.message).slice(0, 200) })); return; }

  const post = (p, headers, body, method = "POST") => new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { "content-type": "application/json", ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    r.setTimeout(8000, () => { r.destroy(); resolve("timeout"); }); r.on("error", (e) => resolve("error:" + e.code)); if (body) r.write(body); r.end(); });
  const delivery = (event, payload, id, opts = {}) => { const body = JSON.stringify(payload);
    const h = { "x-github-event": event, "x-github-delivery": id, ...(opts.sig === "none" ? {} : opts.sig === "bad" ? { "x-hub-signature": "sha1=00", "x-hub-signature-256": "sha256=00" } : sign(body)) };
    return post(opts.path || "/", h, body); };
  const step = async (fn, label, f) => { cur = { file: "driver", fn, label, args: [], wire: [], preds: {} }; seen.length = 0;
    try { const status = await Promise.race([f(), new Promise((r) => setTimeout(() => r("timeout"), 10000))]); await new Promise((r) => setTimeout(r, 50)); cur.out = { status, handlers: seen.slice() }; cur.threw = false; }
    catch (e) { cur.threw = true; cur.err = String(e && e.message).slice(0, 160); }
    trace.calls.push(cur); cur = null; };

  await step("deliver", "issues.opened, signed, path /", () => delivery("issues", P.issueOpened, "d1"));
  await step("deliver", "pull_request.opened, signed", () => delivery("pull_request", P.prOpened, "d2"));
  await step("deliver", "issues.opened by a Bot sender", () => delivery("issues", P.issueOpenedByBot, "d3"));
  await step("deliver", "issues.opened, wrong signatures", () => delivery("issues", P.issueOpened, "d4", { sig: "bad" }));
  await step("deliver", "issues.opened, no signature headers", () => delivery("issues", P.issueOpened, "d5", { sig: "none" }));
  await step("deliver", "issues.opened, signed, path /api/github/webhooks", () => delivery("issues", P.issueOpened, "d6", { path: "/api/github/webhooks" }));
  await step("deliver", "GET /", () => post("/", {}, null, "GET"));
  await step("deliver", "issues.closed whose handler throws", () => delivery("issues", P.issueClosed, "d7"));
  await step("receive", "probot.receive(issues.opened)", async () => { await probot.receive({ id: "r1", name: "issues", payload: P.issueOpened }); return "resolved"; });
  await step("receive", "probot.receive(issues.closed), handler throws", async () => { try { await probot.receive({ id: "r2", name: "issues", payload: P.issueClosed }); return "resolved"; } catch (e) { return "rejected"; } });
  server.close();
  // probot's own Server (Express): default webhookPath, a custom webhookPath, /ping, and an app route via getRouter
  const { Server } = probotLib; const pino = req("pino");
  const freePort = () => new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  for (const webhookPath of [undefined, "/hooks"]) {
    let srv;
    await step("server", `Server start, webhookPath=${webhookPath || "default"}`, async () => {
      port = await freePort();
      srv = new Server({ Probot: Probot.defaults({ appId: 1, privateKey, secret: SECRET, logLevel: "fatal", Octokit: ProbotOctokit.defaults({ retry: { enabled: false }, throttle: { enabled: false } }) }),
        port, host: "127.0.0.1", log: pino({ level: "silent" }), ...(webhookPath ? { webhookPath } : {}) });
      await srv.load((app, opts) => { appFn(app); const r = opts && opts.getRouter && opts.getRouter("/my-app"); if (r) r.get("/hello", (q, res) => res.end("hi")); });
      await srv.start(); return "started"; });
    if (!srv || !srv.state || !srv.state.httpServer) continue;
    await step("server", `Server(${webhookPath || "default"}): signed issues.opened to ${webhookPath || "/"}`, () => delivery("issues", P.issueOpened, "s1", { path: webhookPath || "/" }));
    await step("server", `Server(${webhookPath || "default"}): signed issues.opened to /api/github/webhooks`, () => delivery("issues", P.issueOpened, "s2", { path: "/api/github/webhooks" }));
    if (webhookPath) await step("server", `Server(${webhookPath}): signed issues.opened to /`, () => delivery("issues", P.issueOpened, "s3", { path: "/" }));
    await step("server", `Server(${webhookPath || "default"}): GET /ping`, () => post("/ping", {}, null, "GET"));
    await step("server", `Server(${webhookPath || "default"}): GET /my-app/hello (getRouter)`, () => post("/my-app/hello", {}, null, "GET"));
    await srv.stop();
  }
  nock.cleanAll(); nock.restore();
  process.stdout.write(JSON.stringify(trace)); process.exit(0);
})().catch((e) => process.stdout.write(JSON.stringify({ fatal: String(e && e.stack).slice(0, 300) })));
