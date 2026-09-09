/**
 * Webhook auth v2 — Slack-style HMAC-SHA256 request signing.
 *
 * Required:
 *   headers["x-webhook-signature"]  e.g. "v0=<hex>"
 *   headers["x-webhook-timestamp"]
 *   rawBody
 *   process.env.WEBHOOK_SIGNING_SECRET
 *
 * Compare with crypto.timingSafeEqual — never === on signatures.
 */

import * as crypto from "crypto";

export interface WebhookRequest {
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export function verifyWebhookRequest(req: WebhookRequest): boolean {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!signature || !timestamp || !secret) return false;

  const base = `v0:${timestamp}:${req.rawBody}`;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(base, "utf8")
    .digest("hex");
  const expected = `v0=${digest}`;

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default verifyWebhookRequest;
