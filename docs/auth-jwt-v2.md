# Auth JWT v2 Migration Guide

Legacy integrations verify tokens with a shared symmetric secret
(`jwt.verify(token, process.env.JWT_SECRET)`). Modern identity providers
(Auth0-style) expect JWKS-based verification instead.

## Overview

Decode the JWT header to obtain the key id, fetch the matching signing key
from your JWKS URI, then verify using the public key material from that key.

## Typical pattern

```ts
import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";

const jwksClient = createJwksClient({
  jwksUri: process.env.JWKS_URI!,
});

// 1) Read kid from the token header
// 2) Await the signing key for that kid
// 3) Pass the key's public material into jwt.verify
```

## Notes

- Symmetric `JWT_SECRET` verify is removed in auth-jwt-v2.
- Prefer the typed JWKS helpers exported by the TypeScript client.
- Verification becomes asynchronous once you fetch signing keys.
- Keep existing smoke tests in `verify.test.ts` intact.
