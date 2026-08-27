import createMorphPay from "morphpay-v1";

/**
 * Checkout flow using MorphPay v1 Charges API (deprecated).
 * Baseline migration target: morphpay-v2 PaymentIntent Builder.
 */
export async function checkout(cardToken: string, amountCents: number) {
  const morphpay = createMorphPay(process.env.MORPHPAY_KEY ?? "sk_test_demo");

  // Usage site 1 — standard charge with capture
  const charge = await morphpay.charges.create({
    amount: amountCents,
    currency: "usd",
    source: cardToken,
    capture: true,
  });

  return {
    chargeId: charge.id,
    status: charge.status,
    captured: charge.captured,
  };
}

export async function refundableHold(cardToken: string) {
  const morphpay = createMorphPay(process.env.MORPHPAY_KEY ?? "sk_test_demo");

  // Usage site 2 — auth-only (capture: false)
  const hold = await morphpay.charges.create({
    amount: 5000,
    currency: "usd",
    source: cardToken,
    capture: false,
  });

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
