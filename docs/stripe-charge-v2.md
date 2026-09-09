# Stripe Charge Migration Guide (v1 → v2)

Legacy clients pass `amount` in dollars. Modern charge APIs expect the
smallest currency unit (cents for USD).

## Overview

The call shape is unchanged: `stripe.charges.create({ amount, currency, source })`.
Only the **meaning** of `amount` changes.

## Typical pattern

```ts
import createStripeCharge from "stripe-charge-v2";

const stripe = createStripeCharge(process.env.STRIPE_CHARGE_KEY!);

const charge = await stripe.charges.create({
  amount: 1050, // $10.50 in USD
  currency: "usd",
  source: cardToken,
});
```

## Notes

- Keep the `amount` property name.
- Prefer integers for USD amounts.
- Example above uses a literal already expressed in cents.
- See provider docs for zero-decimal currencies.
