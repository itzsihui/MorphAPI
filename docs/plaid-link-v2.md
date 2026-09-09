# Plaid Link Token Migration Guide

Legacy integrations pass `products` and `country_codes` as plain strings.
Modern Plaid TypeScript clients should use the typed enums from the SDK.

## Overview

When creating a Link token, prefer enum members for products and country codes
instead of raw string literals.

## Typical pattern

```ts
import createPlaidClient, { CountryCode, Products } from "plaid-link-v2";

const client = createPlaidClient({
  clientId: process.env.PLAID_CLIENT_ID!,
  secret: process.env.PLAID_SECRET!,
});

const response = await client.linkTokenCreate({
  user: { client_user_id: userId },
  client_name: "My App",
  products: [/* products enum member for transactions */],
  country_codes: [/* country code enum for the United States */],
  language: "en",
});
```

## Notes

- Map string `"transactions"` → the appropriate `Products` enum member.
- Map string `"US"` → the appropriate `CountryCode` enum member.
- Do not leave bare string literals in `products` / `country_codes` after upgrading.
- Enum member names follow the Plaid TypeScript SDK conventions (not always
  identical to the ISO / product string values).
