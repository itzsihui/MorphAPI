import stripe from "stripe-errors-v1";

/**
 * Charge helper with legacy stripe.error.CardError handling.
 * Migrate to stripe-errors-v2 PaymentIntents + Stripe.errors.StripeCardError.
 */
export async function chargeOrHandle(
  source: string,
  amountCents: number
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    // Usage site — happy path + card decline handling
    const charge = await stripe.charges.create({
      amount: amountCents,
      currency: "usd",
      source,
    });
    return { ok: true, id: charge.id };
  } catch (e) {
    if (e instanceof stripe.error.CardError) {
      return { ok: false, reason: "card_declined" };
    }
    throw e;
  }
}

export async function holdOrHandle(
  source: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const charge = await stripe.charges.create({
      amount: 5000,
      currency: "usd",
      source,
    });
    return { ok: true, id: charge.id };
  } catch (e) {
    if (e instanceof stripe.error.CardError) {
      return { ok: false, reason: "card_declined" };
    }
    throw e;
  }
}
