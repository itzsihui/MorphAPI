import createStripeCharge from "stripe-charge-v1";

/**
 * Checkout helpers using legacy dollar amounts.
 * Migrate to stripe-charge-v2 (amount = integer cents).
 */
export async function pay(cardToken: string, amountDollars: number) {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 1 — variable still in dollars
  const charge = await stripe.charges.create({
    amount: amountDollars,
    currency: "usd",
    source: cardToken,
  });

  return charge.id;
}

export async function payFixed() {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 2 — literal dollars ($10.50)
  const charge = await stripe.charges.create({
    amount: 10.5,
    currency: "usd",
    source: "tok_visa",
  });

  return charge.id;
}
