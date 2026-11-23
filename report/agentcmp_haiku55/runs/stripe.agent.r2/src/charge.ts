import createStripeCharge from "stripe-charge-v2";

/**
 * Checkout helpers. stripe-charge-v2 expects `amount` as integer cents,
 * so dollar inputs are converted to cents before the call to keep the
 * charged amounts identical to the previous v1 behaviour.
 */
export async function pay(cardToken: string, amountDollars: number) {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 1 — variable provided in dollars, converted to integer cents
  const charge = await stripe.charges.create({
    amount: Math.round(amountDollars * 100),
    currency: "usd",
    source: cardToken,
  });

  return charge.id;
}

export async function payFixed() {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 2 — literal $10.50 expressed in cents
  const charge = await stripe.charges.create({
    amount: 1050,
    currency: "usd",
    source: "tok_visa",
  });

  return charge.id;
}
