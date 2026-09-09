# Events Gateway Migration Guide (v1 → v2)

Gateway event payloads are still polymorphic, but the discriminator changed.

## Overview

- Package: `events-gateway-v1` → `events-gateway-v2`
- Prefer the new intent names when **registering** listeners

## Typical subscription pattern

```ts
import createGateway from "events-gateway-v2";

const client = createGateway(process.env.GATEWAY_TOKEN!);

client.subscribe(
  ["message.created", "message.updated", "reaction.added"],
  (event) => {
    // handle event
  }
);
```

## Notes

- Keep using `subscribe(types, handler)` — no rename.
- New UI surfaces use the dotted lowercase intent catalog above.
- See Discord / Slack event catalogs for the full list.
