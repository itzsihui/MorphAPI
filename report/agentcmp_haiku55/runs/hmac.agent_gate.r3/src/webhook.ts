import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v2";

/**
 * Webhook ingress authorized via HMAC request signing (webhook-auth-v2).
 * Requires x-webhook-signature and x-webhook-timestamp headers, and the
 * WEBHOOK_SIGNING_SECRET env var.
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

/** Alternate site — uses the same HMAC verifier as ingress. */
export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}
