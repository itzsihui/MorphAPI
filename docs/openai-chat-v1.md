# OpenAI Chat Migration Guide (v0 → v1 style)

Legacy integrations used a module-style `ChatCompletion.create` helper with an
`engine` field. Modern OpenAI TypeScript clients use an instantiated client and
the nested `chat.completions.create` method.

## Overview

Prefer the v1 client pattern when creating chat completions.

## Typical pattern

```ts
import OpenAI from "openai-chat-v1";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const response = await client.chat.completions.create({
  model: /* the chat model id, e.g. for GPT-4 */,
  messages: [
    { role: "user", content: prompt },
  ],
});
```

## Notes

- Map the old engine / model identifier field to the appropriate v1 request field.
- Replace `ChatCompletion.create` with the nested completions API on the client.
- Do not keep deprecated request fields after upgrading.
- Response choices are on the completion object (use attribute access, not legacy wrappers).
