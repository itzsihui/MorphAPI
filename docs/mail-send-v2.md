# Mail Send Migration Guide (v1 → v2)

Legacy clients call flat `sendEmail(to, from, subject, body)`.
Modern clients use a structured `send({ ... })` payload.

## Overview

Replace positional arguments with a single object. The body field is
renamed to `content`.

## Typical pattern (notification service)

```ts
import send from "mail-send-v2";

await send({
  to: userEmail,
  from: "noreply@example.com",
  subject: "Welcome",
  content: "Thanks for signing up.",
});
```

## Notes

- `sendEmail` is removed in v2 — do not keep the old import.
- Prefer `content` (not `body`) for the message text.
- Update call sites that still use the flat signature.
