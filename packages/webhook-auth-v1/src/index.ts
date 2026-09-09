/**
 * Legacy webhook auth — static query token comparison.
 * Migrate to webhook-auth-v2 HMAC request signing.
 */

export interface WebhookRequest {
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  rawBody: string;
}

/** @deprecated Prefer HMAC signing in webhook-auth-v2 */
export function verifyWebhookRequest(req: WebhookRequest): boolean {
  const token = req.query.token;
  const expected = process.env.WEBHOOK_TOKEN;
  if (!token || !expected) return false;
  return token === expected;
}

export default verifyWebhookRequest;
