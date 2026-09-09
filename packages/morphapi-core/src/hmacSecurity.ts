import { findStaticTokenCompareSpans } from "./astScan";

export interface HmacSecurityFinding {
  kind:
    | "static_token"
    | "unsafe_compare"
    | "missing_hmac"
    | "missing_timing_safe"
    | "phantom_helper"
    | "ok_marker";
  detail: string;
  ok: boolean;
}

export interface HmacSecurityResult {
  ok: boolean;
  findings: HmacSecurityFinding[];
  staticTokenCount: number;
  unsafeCompareCount: number;
}

const PHANTOM_HELPERS = [
  "verifySlackRequest",
  "slack.verify",
  "slack.verifyWebhook",
  "verifyShopifyWebhook",
  "createHmacSync",
  "timingSafeCompare",
  "safeEqual",
];

/**
 * Security gate for Scenario 10:
 * - no static query.token / WEBHOOK_TOKEN compares
 * - no timing-unsafe signature === compares
 * - must use package verifyWebhookRequest and/or createHmac + timingSafeEqual
 * - ban known phantom helpers
 */
export function assertHmacSecurity(code: string): HmacSecurityResult {
  const findings: HmacSecurityFinding[] = [];

  const tokenSpans = findStaticTokenCompareSpans("webhook.ts", code);
  for (const span of tokenSpans) {
    findings.push({
      kind: "static_token",
      detail: `L${span.startLine}: ${span.text.replace(/\s+/g, " ").slice(0, 80)}`,
      ok: false,
    });
  }

  // Unsafe signature compares (not timingSafeEqual)
  const unsafeRe =
    /(?:signature|sig|expected|digest|hmac)\s*===?\s*(?:signature|sig|expected|digest|hmac|["'`])/gi;
  const unsafeAlt =
    /(?:["'`]v0=|Buffer\.from\([^)]+\))\s*===?\s*(?:["'`]v0=|Buffer\.from|signature|sig|expected)/gi;
  if (unsafeRe.test(code) || unsafeAlt.test(code)) {
    findings.push({
      kind: "unsafe_compare",
      detail: "signature compared with === / == instead of timingSafeEqual",
      ok: false,
    });
  }

  for (const phantom of PHANTOM_HELPERS) {
    const escaped = phantom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
    if (re.test(code)) {
      findings.push({
        kind: "phantom_helper",
        detail: phantom,
        ok: false,
      });
    }
  }

  const usesPackageVerify = /verifyWebhookRequest\s*\(/.test(code);
  const usesCreateHmac = /createHmac\s*\(/.test(code);
  const usesTimingSafe = /timingSafeEqual\s*\(/.test(code);
  const stillOnV1 = /from\s+["']webhook-auth-v1["']/.test(code);

  if (stillOnV1) {
    findings.push({
      kind: "static_token",
      detail: "still imports webhook-auth-v1",
      ok: false,
    });
  }

  if (!usesPackageVerify && !usesCreateHmac) {
    findings.push({
      kind: "missing_hmac",
      detail: "no verifyWebhookRequest(...) and no createHmac(...)",
      ok: false,
    });
  }

  if (usesCreateHmac && !usesTimingSafe) {
    findings.push({
      kind: "missing_timing_safe",
      detail: "custom HMAC without timingSafeEqual",
      ok: false,
    });
  }

  if (usesPackageVerify || (usesCreateHmac && usesTimingSafe)) {
    findings.push({
      kind: "ok_marker",
      detail: usesPackageVerify
        ? "uses verifyWebhookRequest"
        : "uses createHmac + timingSafeEqual",
      ok: true,
    });
  }

  const bad = findings.filter((f) => !f.ok);
  return {
    ok: bad.length === 0 && findings.some((f) => f.ok),
    findings,
    staticTokenCount: findings.filter((f) => f.kind === "static_token").length,
    unsafeCompareCount: findings.filter((f) => f.kind === "unsafe_compare")
      .length,
  };
}

/** Oracle-backed authorizeLegacyCompat that delegates to v2 helper. */
export function oracleAuthorizeLegacyCompatReplacement(): string {
  return `export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}`;
}
