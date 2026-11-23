import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v2";

/**
 * Webhook ingress using HMAC request signing (webhook-auth-v2).
 * Requires x-webhook-signature and x-webhook-timestamp headers and the
 * WEBHOOK_SIGNING_SECRET environment variable.
 */
export function authorizeIngress(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}

export function handleIngress(req: WebhookRequest): { ok: true } {
  if (!authorizeIngress(req)) {
    throw new Error("unauthorized webhook");
  }
  return { ok: true };
}

/**
 * Alternate site — previously an inline static token compare. Now uses the
 * same HMAC verification as the primary ingress path.
 */
export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}
