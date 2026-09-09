# MorphPay v1 API Reference

MorphPay v1 exposes a simple **Charges** API. Clients create a charge in one call.

## Client

```ts
import createMorphPay from "morphpay-v1";

const morphpay = createMorphPay(process.env.MORPHPAY_KEY!);
```

## `morphpay.charges.create(params)`

Creates and (optionally) captures a payment in a single request.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | `number` | yes | Amount in smallest currency unit (e.g. cents) |
| `currency` | `string` | yes | ISO currency code (e.g. `"usd"`) |
| `source` | `string` | yes | Payment source token (e.g. card token) |
| `capture` | `boolean` | no | `true` (default) = capture immediately; `false` = auth-only hold |

### Returns `Charge`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Charge id |
| `amount` | `number` | Charged amount |
| `currency` | `string` | Currency |
| `status` | `"succeeded" \| "pending" \| "failed"` | Charge status |
| `captured` | `boolean` | Whether funds were captured |

### Example

```ts
const charge = await morphpay.charges.create({
  amount: 2000,
  currency: "usd",
  source: cardToken,
  capture: true,
});
```

## Status

**Deprecated.** Prefer MorphPay v2 PaymentIntent Builder + `intents.confirm`.
