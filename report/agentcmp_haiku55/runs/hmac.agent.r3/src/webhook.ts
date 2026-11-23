import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v2";

/**
 * Webhook ingress using HMAC request signing (x-webhook-signature /
 * x-webhook-timestamp, secret in WEBHOOK_SIGNING_SECRET).
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
