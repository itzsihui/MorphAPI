import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v2";

/**
 * Webhook ingress authorized by HMAC request signing.
 * Requires the `x-webhook-signature` and `x-webhook-timestamp` headers and
 * the WEBHOOK_SIGNING_SECRET env variable.
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

/** Alternate site — delegates to the same HMAC verifier as authorizeIngress. */
export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  return verifyWebhookRequest(req);
}
