import * as fs from "fs";
import * as path from "path";
import { extractSymbolsFromCode } from "./symbols";

export interface ApiOracle {
  api: string;
  version: string;
  description?: string;
  classes: string[];
  enums: string[];
  enumMembers: Record<string, string[]>;
  methods: Record<string, string[]>;
  staticMembers: Record<string, string[]>;
  functions: string[];
  allowedImports: string[];
  allowedSymbols: string[];
  knownPhantoms?: string[];
}

export type PhantomTier = "atomic" | "scope-bound";

export interface PhantomFinding {
  symbol: string;
  tier: PhantomTier;
  reason: string;
}

export interface InspectResult {
  ok: boolean;
  phantoms: PhantomFinding[];
  extractedSymbols: string[];
}

export function loadOracle(oraclePath?: string): ApiOracle {
  const resolved =
    oraclePath ??
    path.resolve(__dirname, "../../../oracle/morphpay-v2.json");
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw) as ApiOracle;
}

function buildAllowedSet(oracle: ApiOracle): Set<string> {
  const allowed = new Set<string>(oracle.allowedSymbols);
  for (const c of oracle.classes) allowed.add(c);
  for (const e of oracle.enums) allowed.add(e);
  for (const [enumName, members] of Object.entries(oracle.enumMembers)) {
    for (const m of members) {
      allowed.add(`${enumName}.${m}`);
      allowed.add(m);
    }
  }
  for (const methods of Object.values(oracle.methods)) {
    for (const m of methods) allowed.add(m);
  }
  for (const statics of Object.values(oracle.staticMembers)) {
    for (const s of statics) allowed.add(s);
  }
  for (const f of oracle.functions) allowed.add(f);
  // Benign identifiers that appear in migrated client code
  for (const benign of [
    "createMorphPay",
    "morphpay",
    "process",
    "env",
    "MORPHPAY_KEY",
    "console",
    "require",
    "module",
    "exports",
    "Promise",
    "Error",
    "string",
    "number",
    "boolean",
    "true",
    "false",
    "async",
    "await",
    "return",
    "checkout",
    "refundableHold",
    "cardToken",
    "amountCents",
    "charge",
    "hold",
    "result",
    "main",
    "err",
    "intent",
    "holdIntent",
    "chargeId",
    "status",
    "captured",
    "id",
  ]) {
    allowed.add(benign);
  }
  return allowed;
}

/**
 * Classify a phantom relative to MorphPay scaffolding failure modes.
 */
export function classifyPhantom(
  symbol: string,
  oracle: ApiOracle
): PhantomTier {
  // Scope-bound: real method name used on wrong receiver / invalid chain
  const allMethods = new Set<string>();
  for (const methods of Object.values(oracle.methods)) {
    for (const m of methods) allMethods.add(m);
  }
  const base = symbol.includes(".") ? symbol.split(".").pop()! : symbol;
  if (
    base === "setCapture" ||
    (base === "confirm" && symbol.includes("Builder")) ||
    (allMethods.has(base) === false &&
      (symbol.includes("Builder.") || symbol.startsWith("charges.")))
  ) {
    if (base === "setCapture" || symbol.includes("charges.")) {
      return "scope-bound";
    }
  }
  if (base === "setCapture") return "scope-bound";
  if (symbol === "charges" || symbol.startsWith("charges.")) return "scope-bound";
  return "atomic";
}

export function inspectCode(
  code: string,
  oracle: ApiOracle,
  options?: { focusMorphPayOnly?: boolean }
): InspectResult {
  const allowed = buildAllowedSet(oracle);
  const knownPhantoms = new Set(oracle.knownPhantoms ?? []);
  const extracted = extractSymbolsFromCode(code);
  const phantoms: PhantomFinding[] = [];
  const seen = new Set<string>();

  for (const symbol of extracted) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    // Always flag known trap phantoms
    if (knownPhantoms.has(symbol) || knownPhantoms.has(symbol.split(".").pop()!)) {
      phantoms.push({
        symbol,
        tier: classifyPhantom(symbol, oracle),
        reason: "Known MorphPay scaffolding trap / phantom symbol",
      });
      continue;
    }

    // Member expressions like CaptureMode.IMMEDIATE
    if (symbol.includes(".")) {
      const [root, member] = symbol.split(".", 2);
      if (oracle.enums.includes(root)) {
        const members = oracle.enumMembers[root] ?? [];
        if (!members.includes(member)) {
          phantoms.push({
            symbol,
            tier: "atomic",
            reason: `${member} is not a member of enum ${root}`,
          });
          continue;
        }
      }
      if (root === "IntentFactory" || symbol.startsWith("IntentFactory")) {
        phantoms.push({
          symbol,
          tier: "atomic",
          reason: "IntentFactory does not exist in MorphPay v2",
        });
        continue;
      }
    }

    if (options?.focusMorphPayOnly) {
      const morphPayish =
        symbol.startsWith("CaptureMode") ||
        symbol.startsWith("PaymentIntent") ||
        symbol.startsWith("IntentFactory") ||
        symbol.startsWith("CONTENT_") ||
        symbol === "setCapture" ||
        symbol === "charges" ||
        knownPhantoms.has(symbol);
      if (!morphPayish) continue;
    }

    if (!allowed.has(symbol) && !allowed.has(symbol.split(".").pop()!)) {
      // Only report MorphPay-domain looking unknowns to reduce noise
      if (
        /^(CaptureMode|PaymentIntent|IntentFactory|CONTENT_|setCapture)/.test(
          symbol
        ) ||
        symbol.includes("CaptureMode.") ||
        symbol.includes("IntentFactory")
      ) {
        phantoms.push({
          symbol,
          tier: classifyPhantom(symbol, oracle),
          reason: "Symbol not present in MorphPay v2 API oracle",
        });
      }
    }
  }

  // Extra string scans for common phantoms (avoid substring false positives,
  // e.g. "setCapture" must not match inside "setCaptureMode")
  for (const trap of knownPhantoms) {
    if (phantoms.some((p) => p.symbol === trap)) continue;
    const escaped = trap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
    if (re.test(code)) {
      phantoms.push({
        symbol: trap,
        tier: classifyPhantom(trap, oracle),
        reason: "Phantom scaffolding pattern found in source text",
      });
    }
  }

  // Detect .setCapture( calls that are not .setCaptureMode(
  {
    const setCaptureCalls = code.match(/\.setCapture\w*\s*\(/g) ?? [];
    const hasPhantomSetCapture = setCaptureCalls.some(
      (m) => !m.startsWith(".setCaptureMode")
    );
    if (hasPhantomSetCapture && !phantoms.some((p) => p.symbol === "setCapture")) {
      phantoms.push({
        symbol: "setCapture",
        tier: "scope-bound",
        reason: "Builder.setCapture(boolean) is not in MorphPay v2 (use setCaptureMode)",
      });
    }
  }

  if (
    /new\s+PaymentIntent\.Builder\s*\([^)]*\)\s*(?:\.\w+\([^)]*\)\s*)*\.confirm\s*\(/.test(
      code
    ) ||
    /\.build\s*\(\s*\)\s*\.confirm\s*\(/.test(code)
  ) {
    if (!phantoms.some((p) => p.symbol.includes("confirm"))) {
      phantoms.push({
        symbol: "PaymentIntentBuilder.confirm",
        tier: "scope-bound",
        reason: "confirm() belongs on morphpay.intents, not on the Builder",
      });
    }
  }

  return {
    ok: phantoms.length === 0,
    phantoms,
    extractedSymbols: extracted,
  };
}
