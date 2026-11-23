// Cross-version behaviour check: per-LIBRARY specs (never per consumer, never containing expected outputs).
//
// tap(mod, ver, log): wraps the library's REMOTE operations and records, for each, the canonical "wire" effect, i.e.
//   the request the real SDK would put on the network, written in one vocabulary shared by both versions, plus the
//   response the consumer received. With real HTTP SDKs this layer would be an HTTP interceptor (nock/msw); the fixture
//   SDKs are in-process mocks, so each spec emulates that request from the SDK's documented semantics (.d.ts/JSDoc).
// encode(ver, canonical): turns a canonical library-typed INPUT (e.g. an incoming event) into that version's shape.
// drivers: entry calls with inputs only (same inputs as PROPERTIES.md, pre-registered 2026-11-04). No expected values:
//   the expected behaviour is whatever the ORIGINAL v1 code does on the v1 library.
"use strict";
const crypto = require("crypto");
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const wrapAsync = (fn, onCall) => async (...a) => { const res = await fn(...a); onCall(a, res); return res; };

// Events vocabulary (events-gateway v1 SCREAMING_CASE -> v2 dotted past tense; from the two .d.ts EventType unions).
const EV = { v1: { MESSAGE_CREATE: "message.create", MESSAGE_UPDATE: "message.update", REACTION_ADD: "reaction.add" },
             v2: { "message.created": "message.create", "message.updated": "message.update", "reaction.added": "reaction.add" } };
const evCanon = (ver, t) => EV[ver][t] ?? `?${t}`;
const evEncode = (ver, c) => { const raw = Object.entries(EV[ver]).find(([, v]) => v === c)?.[0] ?? c;
  return ver === "v1" ? { type: raw, payload: null } : { event_type: raw, payload: null }; };

// hmac inputs: raw incoming HTTP requests (identical bytes for both versions).
const body = '{"e":1}', ts = "1700000000";
const sig = "v0=" + crypto.createHmac("sha256", "whsec").update(`v0:${ts}:${body}`, "utf8").digest("hex");
const REQ = {
  legacyToken: { query: { token: "legacy-token" }, headers: {}, rawBody: body },
  signed: { query: {}, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts }, rawBody: body },
  wrongToken: { query: { token: "nope" }, headers: {}, rawBody: body },
  badSignature: { query: {}, headers: { "x-webhook-signature": "v0=00", "x-webhook-timestamp": ts }, rawBody: body },
  empty: { query: {}, headers: {}, rawBody: body },
};
const jwtTok = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url") + ".e30.sig";

const S = {
  morphpay: { lib: { v1: "morphpay-v1", v2: "morphpay-v2" }, files: { "checkout.js": 1 },
    tap(m, ver, log) { const f = m.createMorphPay; const w = (k) => { const c = f(k);
      if (ver === "v1") c.charges.create = wrapAsync(c.charges.create, ([p], r) => log("payment", { amount: p.amount, currency: p.currency, method: p.source, capture: p.capture !== false }, r));
      else { const o = c.intents.confirm.bind(c.intents); c.intents.confirm = wrapAsync(o, ([i], r) => log("payment", { amount: i.amount, currency: i.currency, method: i.paymentMethod, capture: (i.captureMode ?? "automatic") === "automatic" }, r)); }
      return c; }; m.createMorphPay = w; m.default = w; },
    drivers: [["checkout.js", "checkout", ["tok_visa", 2000]], ["checkout.js", "refundableHold", ["tok_visa"]]] },

  plaid: { lib: { v1: "plaid-link-v1", v2: "plaid-link-v2" },
    tap(m, ver, log) { const f = m.createPlaidClient; const w = (c0) => { const c = f(c0);
      c.linkTokenCreate = wrapAsync(c.linkTokenCreate, ([r], res) => log("link_token.create", clone(r), res)); return c; };
      m.createPlaidClient = w; m.default = w; },
    drivers: [["link.js", "createUserLinkToken", ["u1"]], ["link.js", "createUkAuthLinkToken", ["u2"]]] },

  openai: { lib: { v1: "openai-chat-v0", v2: "openai-chat-v1" },
    tap(m, ver, log) { const Orig = m.default; const canon = (p) => { const q = clone(p); if ("engine" in q) { q.model = q.engine; delete q.engine; } return q; };
      class Spy extends Orig { constructor(o) { super(o);
        if (ver === "v1") this.ChatCompletion.create = wrapAsync(this.ChatCompletion.create, ([p], r) => log("chat.completions", canon(p), r));
        else this.chat.completions.create = wrapAsync(this.chat.completions.create, ([p], r) => log("chat.completions", canon(p), r)); } }
      m.default = Spy; if (m.OpenAI) m.OpenAI = Spy; },
    drivers: [["chat.js", "askOnce", ["hi"]], ["chat.js", "askWithSystem", ["sys", "q"]]] },

  stripe: { lib: { v1: "stripe-charge-v1", v2: "stripe-charge-v2" },
    // v1 documents `amount` in dollars, v2 in integer cents: the wire carries cents (v1 SDK converted).
    tap(m, ver, log) { const f = m.createStripeCharge; const w = (k) => { const c = f(k);
      c.charges.create = wrapAsync(c.charges.create, ([p], r) => log("charge", { amount_cents: ver === "v1" ? Math.round(p.amount * 100) : p.amount, currency: p.currency, source: p.source }, r));
      return c; }; m.createStripeCharge = w; m.default = w; },
    drivers: [["charge.js", "payFixed", []], ["charge.js", "pay", ["tok", 10.5]], ["charge.js", "pay", ["tok", 19.99]]] },

  "stripe-errors": { lib: { v1: "stripe-errors-v1", v2: "stripe-errors-v2" },
    // v1 charges.create charges immediately; a v2 PaymentIntent only charges when confirm:true.
    tap(m, ver, log) {
      if (ver === "v1") { const s = m.default; const o = s.charges.create; s.charges.create = async (p) => { log("payment", { amount: p.amount, currency: p.currency, method: p.source, confirm: true }, undefined, true);
          const r = await o(p); log.res(r); return r; }; }
      else { const Orig = m.default; class Spy extends Orig { constructor(k) { super(k); const o = this.paymentIntents.create;
          this.paymentIntents.create = async (p) => { log("payment", { amount: p.amount, currency: p.currency, method: p.payment_method, confirm: p.confirm === true }, undefined, true);
            const r = await o(p); log.res(r); return r; }; } }
        Object.assign(Spy, { errors: Orig.errors }); m.default = Spy; } },
    drivers: [["charge.js", "chargeOrHandle", ["tok_visa", 500]], ["charge.js", "chargeOrHandle", ["tok_chargeDeclined", 500]],
              ["charge.js", "holdOrHandle", ["tok_visa"]], ["charge.js", "holdOrHandle", ["tok_chargeDeclined"]]] },

  auth: { lib: { v1: "auth-jwt-v1", v2: "auth-jwt-v2" },
    // Verification key provenance: v1 = the shared secret (JWT_SECRET); v2 = the issuer's JWKS key for the token's kid.
    tap(m, ver, log) { const issued = new Map();
      if (ver === "v2") { const oc = m.createJwksClient; m.createJwksClient = (o) => { const c = oc(o); const g = c.getSigningKey;
        c.getSigningKey = async (kid) => { const k = await g(kid); const gp = k.getPublicKey; return { ...k, getPublicKey() { const pem = gp.call(k); issued.set(pem, kid); return pem; } }; }; return c; }; }
      const ov = m.jwt.verify; m.jwt.verify = (t, key) => { let src = "other";
        if (ver === "v1") src = key === process.env.JWT_SECRET ? "issuer-key" : "other";
        else { const kid = m.decodeHeader(t).kid; src = issued.get(key) === kid ? "issuer-key" : "other"; }
        const r = ov(t, key); log("token.verify", { token: t, key: src }, r); return r; }; },
    drivers: [["verify.js", "verifyAccessToken", [jwtTok]], ["verify.js", "verifyIdToken", [jwtTok]]] },

  envelope: { lib: { v1: "users-list-v1", v2: "users-list-v2" },
    tap(m, ver, log) { const f = m.createUsersApi; const w = (k) => { const c = f(k); c.listUsers = wrapAsync(c.listUsers, (a, r) => log("users.list", {}, r)); return c; };
      m.createUsersApi = w; m.default = w; },
    drivers: [["users.js", "listLogins", []], ["users.js", "listActiveLogins", []]] },

  async: { lib: { v1: "aws-s3-v1", v2: "aws-s3-v2" },
    tap(m, ver, log) { const f = m.createS3Client; const w = (...a) => { const c = f(...a);
      if (ver === "v1") { const g = c.getObject; c.getObject = (p) => { const req = g(p); const pr = req.promise; return { ...req, async promise() { const r = await pr.call(req); log("object.get", { Bucket: p.Bucket, Key: p.Key }, r); return r; } }; }; }
      else c.send = wrapAsync(c.send, ([cmd], r) => log("object.get", { Bucket: cmd.input.Bucket, Key: cmd.input.Key }, r));
      return c; }; m.createS3Client = w; m.default = w; },
    drivers: [["io.js", "fetchObjectBody", ["b", "k"]], ["io.js", "loadBanner", ["b"]]] },

  mail: { lib: { v1: "mail-send-v1", v2: "mail-send-v2" },
    tap(m, ver, log) {
      if (ver === "v1") { const o = m.sendEmail; const s = async (to, from, subject, b) => { const r = await o(to, from, subject, b); log("mail.send", { to, from, subject, content: b }, r); return r; }; m.sendEmail = s; m.default = s; }
      else { const o = m.send; const s = async (p) => { const r = await o(p); log("mail.send", { to: p.to, from: p.from, subject: p.subject, content: p.content }, r); return r; }; m.send = s; m.default = s; } },
    drivers: [["notify.js", "notifyUser", ["a@x", "Ann"]], ["notify.js", "notifyPasswordReset", ["a@x", "T1"]], ["cron.js", "runNightlyDigest", ["ops@x", "sum"]],
              ["seed.js", "seedWelcomeEmails", [["t1"]]], ["onboarding.js", "onboardNewUser", ["b@x", "Bo"]]] },

  hmac: { lib: { v1: "webhook-auth-v1", v2: "webhook-auth-v2" },
    tap() {}, // no remote operation: verification is local, so the relation check (run.mjs) does the work
    drivers: ["authorizeIngress", "authorizeLegacyCompat", "handleIngress"].flatMap((fn) => Object.keys(REQ).map((k) => ["webhook.js", fn, [REQ[k]], k])) },

  discriminator: { lib: { v1: "events-gateway-v1", v2: "events-gateway-v2" },
    tap(m, ver, log) { const f = m.createGateway; const w = (t) => { const c = f(t); const s = c.subscribe;
      c.subscribe = (types, h) => { log("events.subscribe", { types: types.map((x) => evCanon(ver, x)) }); return s.call(c, types, h); }; return c; };
      m.createGateway = w; m.default = w; },
    encode: (ver, c) => (c && c.$event ? evEncode(ver, c.$event) : c),
    drivers: [["subscribe.js", "startBot", []], ...["message.create", "message.update", "reaction.add", "other"].map((e) => ["router.js", "handleEvent", [{ $event: e }]])] },
};
module.exports = { S };
