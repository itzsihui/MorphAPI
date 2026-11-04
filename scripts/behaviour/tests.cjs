// Behavioural tests (see PROPERTIES.md). usage: node tests.cjs <scenario> <projectDir(js)>
const path = require("path"); const crypto = require("crypto");
const [scenario, dir] = process.argv.slice(2);
const R = (rel) => require(path.join(dir, rel));
const out = {}; const prop = (k, ok, detail) => { out[k] = { ok: !!ok, detail }; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tryRun = async (k, f) => { try { await f(); } catch (e) { if (!(k in out)) prop(k, false, "threw: " + String(e && e.message).slice(0, 120)); } };
process.env.MORPHPAY_KEY = "sk"; process.env.STRIPE_CHARGE_KEY = "sk"; process.env.STRIPE_KEY = "sk"; process.env.USERS_API_KEY = "k";
process.env.GATEWAY_TOKEN = "g"; process.env.JWT_SECRET = "SECRET_V1"; process.env.JWKS_URI = "https://jwks"; process.env.OPENAI_API_KEY = "sk";
process.env.PLAID_CLIENT_ID = "c"; process.env.PLAID_SECRET = "s"; process.env.WEBHOOK_TOKEN = "legacy-token"; process.env.WEBHOOK_SIGNING_SECRET = "whsec";
(async () => {
  if (scenario === "morphpay") {
    const m = require("morphpay-v2"); const confirms = []; const orig = m.createMorphPay;
    const wrap = (k) => { const c = orig(k); const o = c.intents.confirm.bind(c.intents); c.intents.confirm = async (i) => { confirms.push(i); return o(i); }; return c; };
    m.default = wrap; m.createMorphPay = wrap;
    const f = R("checkout.js");
    await tryRun("P1", async () => { const r = await f.checkout("tok_visa", 2000); const c = confirms[confirms.length - 1];
      prop("P1", r.status === "succeeded" && c && r.chargeId === c.id, JSON.stringify(r));
      prop("P2", c && c.captureMode === "automatic" && c.amount === 2000 && c.paymentMethod === "tok_visa", JSON.stringify(c));
      prop("P4", r.captured === true, JSON.stringify(r.captured)); });
    await tryRun("P3", async () => { const n = confirms.length; const id = await f.refundableHold("tok_visa"); const c = confirms[n];
      prop("P3", c && c.captureMode === "manual" && c.amount === 5000 && typeof id === "string", JSON.stringify({ c, id })); });
  } else if (scenario === "plaid") {
    const m = require("plaid-link-v2"); const reqs = []; const orig = m.createPlaidClient;
    const wrap = (cfg) => { const c = orig(cfg); const o = c.linkTokenCreate; c.linkTokenCreate = async (r) => { reqs.push(r); return o(r); }; return c; };
    m.default = wrap; m.createPlaidClient = wrap; const f = R("link.js");
    await tryRun("P1", async () => { const t = await f.createUserLinkToken("u1"); const r = reqs.at(-1);
      prop("P1", eq(r.products, ["transactions"]) && eq(r.country_codes, ["US"]), JSON.stringify(r)); prop("P3a", t === "link-sandbox-u1", t); });
    await tryRun("P2", async () => { const t = await f.createUkAuthLinkToken("u2"); const r = reqs.at(-1);
      prop("P2", eq(r.products, ["auth"]) && eq(r.country_codes, ["GB"]), JSON.stringify(r)); prop("P3b", t === "link-sandbox-u2", t); });
    out.P3 = { ok: (out.P3a || {}).ok && (out.P3b || {}).ok }; delete out.P3a; delete out.P3b;
  } else if (scenario === "openai") {
    const m = require("openai-chat-v1"); const calls = []; const Orig = m.OpenAI;
    class Spy extends Orig { constructor(o) { super(o); const c = this.chat.completions.create; this.chat.completions.create = async (p) => { calls.push(p); return c(p); }; } }
    m.default = Spy; m.OpenAI = Spy; const f = R("chat.js");
    await tryRun("P1", async () => { const r = await f.askOnce("hi"); const p = calls.at(-1); prop("P1", r === "echo:hi" && p.model === "gpt-4", JSON.stringify({ r, p })); });
    await tryRun("P2", async () => { const r = await f.askWithSystem("sys", "q"); const p = calls.at(-1);
      prop("P2", r === "echo:q" && p.model === "gpt-4" && p.temperature === 0.2 && eq(p.messages, [{ role: "system", content: "sys" }, { role: "user", content: "q" }]), JSON.stringify({ r, p })); });
  } else if (scenario === "stripe") {
    const m = require("stripe-charge-v2"); const amts = []; const orig = m.createStripeCharge;
    const wrap = (k) => { const c = orig(k); const o = c.charges.create; c.charges.create = async (p) => { amts.push(p.amount); return o(p); }; return c; };
    m.default = wrap; m.createStripeCharge = wrap; const f = R("charge.js");
    await tryRun("P1", async () => { await f.payFixed(); prop("P1", amts.at(-1) === 1050, amts.at(-1)); });
    await tryRun("P2", async () => { await f.pay("tok", 10.5); prop("P2", amts.at(-1) === 1050, amts.at(-1)); });
    await tryRun("P3", async () => { await f.pay("tok", 19.99); prop("P3", amts.at(-1) === 1999, amts.at(-1)); });
  } else if (scenario === "stripe-errors") {
    const f = R("charge.js");
    await tryRun("P1", async () => { const r = await f.chargeOrHandle("tok_visa", 500); prop("P1", eq(r, { ok: true, id: "pi_500" }), JSON.stringify(r)); });
    await tryRun("P2", async () => { const r = await f.chargeOrHandle("tok_chargeDeclined", 500); prop("P2", eq(r, { ok: false, reason: "card_declined" }), JSON.stringify(r)); });
    await tryRun("P3", async () => { const r = await f.holdOrHandle("tok_visa"); prop("P3", eq(r, { ok: true, id: "pi_5000" }), JSON.stringify(r)); });
    await tryRun("P4", async () => { const r = await f.holdOrHandle("tok_chargeDeclined"); prop("P4", eq(r, { ok: false, reason: "card_declined" }), JSON.stringify(r)); });
  } else if (scenario === "auth") {
    const m = require("auth-jwt-v2"); const keys = []; const kids = [];
    const ov = m.jwt.verify; m.jwt.verify = (t, k) => { keys.push(k); return ov(t, k); };
    const oc = m.createJwksClient; m.createJwksClient = (o) => { const c = oc(o); const g = c.getSigningKey; c.getSigningKey = async (kid) => { kids.push(kid); return g(kid); }; return c; };
    const tok = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url") + ".e30.sig";
    const f = R("verify.js");
    await tryRun("P1", async () => { const a = await f.verifyAccessToken(tok); const b = await f.verifyIdToken(tok);
      prop("P1", a && b && a.sub === "user_demo" && b.sub === "user_demo", JSON.stringify({ a, b }));
      prop("P2", keys.length >= 2 && keys.every((k) => String(k).includes("DEMO_k1") && k !== "SECRET_V1") && kids.every((k) => k === "k1"), JSON.stringify({ keys, kids })); });
  } else if (scenario === "envelope") {
    const f = R("users.js");
    await tryRun("P1", async () => { const r = await f.listLogins(); prop("P1", eq(r, ["alice", "bob"]), JSON.stringify(r)); });
    await tryRun("P2", async () => { const r = await f.listActiveLogins(); prop("P2", eq(r, ["alice"]), JSON.stringify(r)); });
  } else if (scenario === "async") {
    const f = R("io.js");
    await tryRun("P1", async () => { const r = await f.fetchObjectBody("b", "k"); const j = JSON.parse(r); prop("P1", j.region === "b" && j.key === "k", r); });
    await tryRun("P2", async () => { const r = await f.loadBanner("b"); const j = JSON.parse(r); prop("P2", j.region === "b" && j.key === "banner.txt", r); });
  } else if (scenario === "mail") {
    const m = require("mail-send-v2"); const sent = []; const o = m.send;
    const spy = (p) => { sent.push(p); return o(p); }; m.send = spy; m.default = spy;
    const n = R("notify.js"), c = R("cron.js"), s = R("seed.js"), ob = R("onboarding.js");
    const exp = [
      ["a@x", "noreply@morphapi.demo", "Welcome", "Hi Ann, thanks for signing up."],
      ["a@x", "security@morphapi.demo", "Reset your password", "Use this token: T1"],
      ["ops@x", "cron@morphapi.demo", "Nightly digest", "sum"],
      ["admin@t1", "seed@morphapi.demo", "Demo tenant ready", "Tenant t1 was seeded."],
    ];
    await tryRun("P1", async () => {
      await n.notifyUser("a@x", "Ann"); await n.notifyPasswordReset("a@x", "T1"); await c.runNightlyDigest("ops@x", "sum"); await s.seedWelcomeEmails(["t1"]);
      const got = sent.map((p) => [p.to, p.from, p.subject, p.content]);
      prop("P1", eq(got, exp), JSON.stringify(got)); });
    await tryRun("P2", async () => { const k = sent.length; const r = await ob.onboardNewUser("b@x", "Bo"); const p = sent[k];
      const mid = `msg_v2_${p.to}_${p.subject.length}_${p.content.length}`; prop("P2", r === `queued:${mid}`, r); });
  } else if (scenario === "hmac") {
    const f = R("webhook.js"); const body = '{"e":1}'; const ts = "1700000000";
    const sig = "v0=" + crypto.createHmac("sha256", "whsec").update(`v0:${ts}:${body}`, "utf8").digest("hex");
    const good = { query: {}, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts }, rawBody: body };
    const legacy = { query: { token: "legacy-token" }, headers: {}, rawBody: body };
    await tryRun("P1", async () => { prop("P1", f.authorizeIngress(good) === true && f.authorizeLegacyCompat(good) === true, JSON.stringify([f.authorizeIngress(good), f.authorizeLegacyCompat(good)])); });
    await tryRun("P2", async () => { prop("P2", f.authorizeIngress(legacy) === false && f.authorizeLegacyCompat(legacy) === false, JSON.stringify([f.authorizeIngress(legacy), f.authorizeLegacyCompat(legacy)])); });
  } else if (scenario === "discriminator") {
    const m = require("events-gateway-v2"); const subs = []; const o = m.createGateway;
    const wrap = (t) => { const c = o(t); c.subscribe = (types, h) => { subs.push(types); }; return c; }; m.createGateway = wrap; m.default = wrap;
    const s = R("subscribe.js"), r = R("router.js");
    await tryRun("P1", async () => { s.startBot(); prop("P1", eq(subs.at(-1), ["message.created", "message.updated", "reaction.added"]), JSON.stringify(subs)); });
    await tryRun("P2", async () => { const g = (t) => r.handleEvent({ event_type: t, payload: null });
      const got = [g("message.created"), g("message.updated"), g("reaction.added"), g("other")];
      prop("P2", eq(got, ["message_create", "message_update", "reaction_add", "ignored"]), JSON.stringify(got)); });
  }
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { process.stdout.write(JSON.stringify({ fatal: { ok: false, detail: String(e && e.message).slice(0, 200) } })); });
