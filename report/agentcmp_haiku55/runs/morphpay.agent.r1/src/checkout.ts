import createMorphPay, { CaptureMode, PaymentIntent } from "morphpay-v2";

/**
 * Checkout flow using MorphPay v2 PaymentIntent flow (migrated from the
 * deprecated v1 charges API).
 */
export async function checkout(cardToken: string, amountCents: number) {
  const morphpay = createMorphPay(process.env.MORPHPAY_KEY ?? "sk_test_demo");

  // Usage site 1 — standard charge with capture (v1: capture: true)
  const intent = new PaymentIntent.Builder()
    .setAmount(amountCents)
    .setCurrency("usd")
    .setPaymentMethod(cardToken)
    .setCaptureMode(CaptureMode.AUTOMATIC)
    .build();
  const confirmed = await morphpay.intents.confirm(intent);

  return {
    chargeId: confirmed.id,
    status: confirmed.status,
    captured: confirmed.captureMode === CaptureMode.AUTOMATIC,
  };
}

export async function refundableHold(cardToken: string) {
  const morphpay = createMorphPay(process.env.MORPHPAY_KEY ?? "sk_test_demo");

  // Usage site 2 — auth-only (v1: capture: false)
  const intent = new PaymentIntent.Builder()
    .setAmount(5000)
    .setCurrency("usd")
    .setPaymentMethod(cardToken)
    .setCaptureMode(CaptureMode.MANUAL)
    .build();
  const hold = await morphpay.intents.confirm(intent);

  return hold.id;
}

async function main() {
  const result = await checkout("tok_visa", 2000);
  console.log("checkout ok", result);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
