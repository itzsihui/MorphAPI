# Mail Send Migration Guide (v1 → v2)

Legacy clients call flat `sendEmail(to, from, subject, body)`.
Modern clients use a structured `send({ ... })` payload.

## Overview

Replace positional arguments with a single object. The body field is
renamed to `content`.

**SendResult contract change:** v1 used `{ id: string }`. v2 returns
`{ messageId: string; accepted: boolean }`. Helpers that used to return a bare
id string should return the full `SendResult` — update direct callers one hop away.

## Typical pattern (notification service)

```ts
import send, { type SendResult } from "mail-send-v2";

export async function notifyUser(email: string, name: string): Promise<SendResult> {
  return await send({
    to: email,
    from: "noreply@example.com",
    subject: "Welcome",
    content: `Hi ${name}`,
  });
}
```

## Caller adaptation (1° impact)

```ts
// before (expects string id)
const messageId = await notifyUser(email, name);

// after (SendResult)
const result = await notifyUser(email, name);
const messageId = result.messageId;
```

## Notes

- `sendEmail` is removed in v2 — do not keep the old import.
- Prefer `content` (not `body`) for the message text.
- Update call sites that still use the flat signature.
- After changing a helper’s return type, re-scan **direct callers** (1° impact).
