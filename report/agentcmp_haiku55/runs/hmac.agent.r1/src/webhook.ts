import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v2";

/**
 * Webhook ingress authorized via HMAC request signing
 * (x-webhook-signature / x-webhook-timestamp, secret WEBHOOK_SIGNING_SECRET).
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

/** Alternate site — delegates to the package verifier (same HMAC scheme). */
export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}
