# Stripe Payment Migration (v2)

Legacy integrations used `charges.create`. Prefer PaymentIntents on the modern client.

## Overview

Create payments with `paymentIntents.create`. Map `source` → `payment_method` and pass
`confirm: true` when you previously expected an immediate charge result.

## Typical create pattern

```ts
import Stripe from "stripe-errors-v2";

const stripe = new Stripe(process.env.STRIPE_KEY!);

const intent = await stripe.paymentIntents.create({
  amount: 2000,
  currency: "usd",
  payment_method: source,
  confirm: true,
});
```

## Notes

- Instantiate the client: `const stripe = new Stripe(apiKey)` — then call instance methods.
- Do not call `Stripe.paymentIntents` as a static.
- Keep existing try/catch and `instanceof` error handling as-is unless the compiler forces a change.
