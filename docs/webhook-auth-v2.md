# Webhook Auth Migration Guide (v1 → v2)

Legacy integrations authorize webhooks with a static query token
(`?token=...`). Modern providers require **HMAC request signing**
(Slack / Shopify style).

## Overview

Verify each request using a signature header derived from a shared secret,
a timestamp, and the raw request body.

## Signing sketch

```ts
const base = `v0:${timestamp}:${rawBody}`;
const digest = /* HMAC-SHA256(secret, base) as hex */;
const expected = `v0=${digest}`;
// compare signature header to expected with a timing-safe helper
```

Headers:

- `x-webhook-signature`
- `x-webhook-timestamp`

Secret env: `WEBHOOK_SIGNING_SECRET` (replaces `WEBHOOK_TOKEN`).

## Notes

- Replace `webhook-auth-v1` with `webhook-auth-v2`.
- Remove static `query.token === WEBHOOK_TOKEN` checks.
- Do not invent provider SDK helpers that are not in this package.
- Inline compat paths must use the same HMAC scheme (or call the package
  verifier).
