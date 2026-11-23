import createStripeCharge from "stripe-charge-v2";

/**
 * Checkout helpers. Amounts are accepted in dollars and converted to
 * integer cents (the smallest USD unit) expected by stripe-charge-v2.
 */
function toCents(amountDollars: number): number {
  return Math.round(amountDollars * 100);
}

export async function pay(cardToken: string, amountDollars: number) {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 1 — variable in dollars, converted to cents
  const charge = await stripe.charges.create({
    amount: toCents(amountDollars),
    currency: "usd",
    source: cardToken,
  });

  return charge.id;
}

export async function payFixed() {
  const stripe = createStripeCharge(
    process.env.STRIPE_CHARGE_KEY ?? "sk_test_demo"
  );

  // Usage site 2 — literal $10.50, expressed in cents
  const charge = await stripe.charges.create({
    amount: 1050,
    currency: "usd",
    source: "tok_visa",
  });

  return charge.id;
}
