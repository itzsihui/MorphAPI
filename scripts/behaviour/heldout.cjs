// Held-out judge properties (see PROPERTIES.md, "Held-out judge inputs", written 2026-11-24 BEFORE any agent run).
// These inputs are NOT among the cross-version gate's driver inputs (scripts/crossver/specs.cjs), so an agent that only
// satisfies the gate's own inputs cannot pass them by coincidence. usage: node heldout.cjs <scenario> <projectDir(js)>
const path = require("path"); const crypto = require("crypto");
const [scenario, dir] = process.argv.slice(2);
const R = (rel) => require(path.join(dir, rel));
const out = {}; const prop = (k, ok, detail) => { out[k] = { ok: !!ok, detail }; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tryRun = async (k, f) => { try { await f(); } catch (e) { if (!(k in out)) prop(k, false, "threw: " + String(e && e.message).slice(0, 120)); } };
Object.assign(process.env, { MORPHPAY_KEY: "sk", STRIPE_CHARGE_KEY: "sk", STRIPE_KEY: "sk", USERS_API_KEY: "k", GATEWAY_TOKEN: "g", JWT_SECRET: "SECRET_V1",
  JWKS_URI: "https://jwks", OPENAI_API_KEY: "sk", PLAID_CLIENT_ID: "c", PLAID_SECRET: "s", WEBHOOK_TOKEN: "legacy-token", WEBHOOK_SIGNING_SECRET: "whsec" });
(async () => {
  if (scenario === "morphpay") {
    const m = require("morphpay-v2"); const confirms = []; const orig = m.createMorphPay;
    const wrap = (k) => { const c = orig(k); const o = c.intents.confirm.bind(c.intents); c.intents.confirm = async (i) => { confirms.push(i); return o(i); }; return c; };
    m.default = wrap; m.createMorphPay = wrap; const f = R("checkout.js");
    await tryRun("H1", async () => { const r = await f.checkout("tok_mastercard", 1234); const c = confirms.at(-1);
      prop("H1", r.status === "succeeded" && r.captured === true && c && c.amount === 1234 && c.paymentMethod === "tok_mastercard" && c.captureMode === "automatic" && r.chargeId === c.id, JSON.stringify({ r, c })); });
    await tryRun("H2", async () => { const n = confirms.length; await f.refundableHold("tok_amex"); const c = confirms[n];
      prop("H2", c && c.captureMode === "manual" && c.paymentMethod === "tok_amex" && c.amount === 5000, JSON.stringify(c)); });
  } else if (scenario === "plaid") {
    const m = require("plaid-link-v2"); const reqs = []; const orig = m.createPlaidClient;
    const wrap = (cfg) => { const c = orig(cfg); const o = c.linkTokenCreate; c.linkTokenCreate = async (r) => { reqs.push(r); return o(r); }; return c; };
    m.default = wrap; m.createPlaidClient = wrap; const f = R("link.js");
    await tryRun("H1", async () => { const t = await f.createUserLinkToken("zz9"); const r = reqs.at(-1);
      prop("H1", t === "link-sandbox-zz9" && r.user.client_user_id === "zz9" && eq(r.products, ["transactions"]) && eq(r.country_codes, ["US"]), JSON.stringify({ t, r })); });
  } else if (scenario === "openai") {
    const m = require("openai-chat-v1"); const calls = []; const Orig = m.OpenAI;
    class Spy extends Orig { constructor(o) { super(o); const c = this.chat.completions.create; this.chat.completions.create = async (p) => { calls.push(p); return c(p); }; } }
    m.default = Spy; m.OpenAI = Spy; const f = R("chat.js");
    await tryRun("H1", async () => { const r = await f.askWithSystem("be brief", "why?"); const p = calls.at(-1);
      prop("H1", r === "echo:why?" && p.model === "gpt-4" && p.temperature === 0.2 && eq(p.messages, [{ role: "system", content: "be brief" }, { role: "user", content: "why?" }]), JSON.stringify({ r, p })); });
  } else if (scenario === "stripe") {
    const m = require("stripe-charge-v2"); const amts = []; const orig = m.createStripeCharge;
    const wrap = (k) => { const c = orig(k); const o = c.charges.create; c.charges.create = async (p) => { amts.push(p.amount); return o(p); }; return c; };
    m.default = wrap; m.createStripeCharge = wrap; const f = R("charge.js");
    // 0.29*100 = 28.999999999999996 and 1.15*100 = 114.99999999999999 in floating point
    await tryRun("H1", async () => { await f.pay("tok", 0.29); prop("H1", amts.at(-1) === 29, amts.at(-1)); });
    await tryRun("H2", async () => { await f.pay("tok", 1.15); prop("H2", amts.at(-1) === 115, amts.at(-1)); });
    await tryRun("H3", async () => { await f.pay("tok", 250); prop("H3", amts.at(-1) === 25000, amts.at(-1)); });
  } else if (scenario === "stripe-errors") {
    const f = R("charge.js");
    await tryRun("H1", async () => { const r = await f.chargeOrHandle("tok_mastercard", 777); prop("H1", eq(r, { ok: true, id: "pi_777" }), JSON.stringify(r)); });
  } else if (scenario === "auth") {
    const m = require("auth-jwt-v2"); const keys = [];
    const ov = m.jwt.verify; m.jwt.verify = (t, k) => { keys.push(k); return ov(t, k); };
    const tok = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k9" })).toString("base64url") + ".e30.sig";
    const f = R("verify.js");
    await tryRun("H1", async () => { const a = await f.verifyAccessToken(tok);
      prop("H1", a && a.sub === "user_demo" && keys.length >= 1 && keys.every((k) => String(k).includes("DEMO_k9")), JSON.stringify({ a, keys })); });
  } else if (scenario === "async") {
    const f = R("io.js");
    await tryRun("H1", async () => { const r = await f.fetchObjectBody("b2", "x/y.json"); const j = JSON.parse(r); prop("H1", j.region === "b2" && j.key === "x/y.json", r); });
  } else if (scenario === "mail") {
    const m = require("mail-send-v2"); const sent = []; const o = m.send;
    const spy = (p) => { sent.push(p); return o(p); }; m.send = spy; m.default = spy;
    const n = R("notify.js");
    await tryRun("H1", async () => { await n.notifyPasswordReset("z@y", "TOKEN-42"); const p = sent.at(-1);
      prop("H1", p && p.to === "z@y" && p.from === "security@morphapi.demo" && p.subject === "Reset your password" && p.content === "Use this token: TOKEN-42", JSON.stringify(p)); });
  } else if (scenario === "hmac") {
    const f = R("webhook.js"); const body = '{"order":42}'; const ts = "1800000000";
    const sign = (secret) => "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`, "utf8").digest("hex");
    const good = { query: {}, headers: { "x-webhook-signature": sign("whsec"), "x-webhook-timestamp": ts }, rawBody: body };
    const wrongSecret = { query: {}, headers: { "x-webhook-signature": sign("other"), "x-webhook-timestamp": ts }, rawBody: body };
    const tokenPlusBadSig = { query: { token: "legacy-token" }, headers: { "x-webhook-signature": sign("other"), "x-webhook-timestamp": ts }, rawBody: body };
    const both = (r) => [f.authorizeIngress(r), f.authorizeLegacyCompat(r)];
    await tryRun("H1", async () => { prop("H1", eq(both(good), [true, true]), JSON.stringify(both(good))); });
    await tryRun("H2", async () => { prop("H2", eq(both(wrongSecret), [false, false]), JSON.stringify(both(wrongSecret))); });
    await tryRun("H3", async () => { prop("H3", eq(both(tokenPlusBadSig), [false, false]), JSON.stringify(both(tokenPlusBadSig))); });
  } else if (scenario === "discriminator") {
    const r = R("router.js");
    await tryRun("H1", async () => { const got = r.handleEvent({ event_type: "reaction.added", payload: { emoji: "+1" } });
      prop("H1", got === "reaction_add", JSON.stringify(got)); });
  }
  // envelope: its entry points take no inputs, so no held-out input exists.
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { process.stdout.write(JSON.stringify({ fatal: { ok: false, detail: String(e && e.message).slice(0, 200) } })); });
