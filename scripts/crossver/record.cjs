// usage: node record.cjs <scenario> <projectDir(js)> <v1|v2>  -> JSON trace on stdout
// Runs every driver call against the given library version, recording per call: output (or throw), wire effects,
// and the values of every boolean predicate the library declares (for the relation check).
"use strict";
const path = require("path"); const fs = require("fs");
const { S } = require("./specs.cjs");
const [scenario, dir, ver] = process.argv.slice(2);
const spec = S[scenario];
Object.assign(process.env, { MORPHPAY_KEY: "sk", STRIPE_CHARGE_KEY: "sk", STRIPE_KEY: "sk", USERS_API_KEY: "k", GATEWAY_TOKEN: "g",
  JWT_SECRET: "SECRET_V1", JWKS_URI: "https://jwks", OPENAI_API_KEY: "sk", PLAID_CLIENT_ID: "c", PLAID_SECRET: "s",
  WEBHOOK_TOKEN: "legacy-token", WEBHOOK_SIGNING_SECRET: "whsec" });
const libName = spec.lib[ver]; const lib = require(libName);
let cur = null;
const log = (op, req, res, pending) => { const e = { op, req: JSON.parse(JSON.stringify(req ?? {})) }; if (!pending) e.res = res; cur.wire.push(e); };
log.res = (r) => { cur.wire[cur.wire.length - 1].res = r; };
spec.tap(lib, ver, log);

// Boolean predicates the library declares in its .d.ts (single parameter): safe to evaluate on the consumer's inputs.
const dts = fs.readFileSync(require.resolve(libName).replace(/index\.js$/, "index.d.ts"), "utf8");
const preds = [...dts.matchAll(/export declare function (\w+)\(\w+: [\w<>, ]+\): boolean;/g)].map((x) => x[1]);

const safe = (v) => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); } };
(async () => {
  const calls = [];
  for (const [file, fn, rawArgs, label] of spec.drivers) {
    const args = rawArgs.map((a) => (spec.encode ? spec.encode(ver, a) : a));
    cur = { file, fn, label: label ?? JSON.stringify(rawArgs), args: rawArgs, wire: [], preds: {} };
    for (const p of preds) { try { cur.preds[p] = lib[p](args[0]); } catch { cur.preds[p] = "throws"; } }
    try { const f = require(path.join(dir, file))[fn]; if (typeof f !== "function") throw new Error(`no export ${fn}`);
      cur.out = safe(await f(...args)); cur.threw = false; }
    catch (e) { cur.threw = true; cur.err = String(e && e.message).slice(0, 160); }
    cur.wire = cur.wire.map((w) => ({ ...w, res: safe(w.res) }));
    calls.push(cur);
  }
  process.stdout.write(JSON.stringify({ scenario, ver, preds, calls }));
})().catch((e) => { process.stdout.write(JSON.stringify({ fatal: String(e && e.message) })); });
