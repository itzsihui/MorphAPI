import verifyWebhookRequest, {
  type WebhookRequest,
} from "webhook-auth-v1";

/**
 * Webhook ingress using legacy static query token auth.
 * Migrate to webhook-auth-v2 HMAC request signing.
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

/** Alternate site — inline token compare (also must migrate). */
export function authorizeLegacyCompat(req: WebhookRequest): boolean {
  const token = req.query.token;
  return token === process.env.WEBHOOK_TOKEN;
}
