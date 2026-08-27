# MorphPay v2 Migration Guide

MorphPay v1 `charges.create` is deprecated. Migrate to the PaymentIntent flow.

## Overview

Charges are now represented as payment intents. Build an intent, then confirm it.

## Capture behavior

In v1 you passed `capture: true|false`. In v2, capture is configured via a capture mode enum on the builder.

Common capture modes used by payment providers include automatic capture after confirmation.

## Typical migration pattern

```ts
import createMorphPay, { PaymentIntent, CaptureMode } from "morphpay-v2";

const morphpay = createMorphPay(process.env.MORPHPAY_KEY!);

const intent = new PaymentIntent.Builder()
  .setAmount(2000)
  .setCurrency("usd")
  .setPaymentMethod(cardToken)
  .setCaptureMode(/* capture mode */)
  .build();

await morphpay.intents.confirm(intent);
```

## Notes

- Prefer the Builder pattern over the old charges object.
- Map `source` → `setPaymentMethod`.
- Map boolean `capture` to the appropriate CaptureMode.
- Do not call `charges.create` after upgrading the package.
