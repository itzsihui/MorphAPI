import Stripe from "stripe-errors-v2";

const stripe = new Stripe(process.env.STRIPE_KEY!);

/**
 * Charge helper with card decline handling.
 * Uses stripe-errors-v2 PaymentIntents (confirmed immediately) and Stripe.errors.StripeCardError.
 */
export async function chargeOrHandle(
  source: string,
  amountCents: number
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    // Usage site — happy path + card decline handling
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method: source,
      confirm: true,
    });
    return { ok: true, id: intent.id };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeCardError) {
      return { ok: false, reason: "card_declined" };
    }
    throw e;
  }
}

export async function holdOrHandle(
  source: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 5000,
      currency: "usd",
      payment_method: source,
      confirm: true,
    });
    return { ok: true, id: intent.id };
  } catch (e) {
    if (e instanceof Stripe.errors.StripeCardError) {
      return { ok: false, reason: "card_declined" };
    }
    throw e;
  }
}
