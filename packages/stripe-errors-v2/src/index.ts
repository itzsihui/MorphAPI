/**
 * Target Stripe-style client (modern error module).
 * Real stripe-node: Stripe.errors.StripeCardError — NOT stripe.error.CardError.
 */
export class StripeCardError extends Error {
  readonly type = "card_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "StripeCardError";
  }
}

export class StripeAPIError extends Error {
  readonly type = "api_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "StripeAPIError";
  }
}

export interface PaymentIntent {
  id: string;
  amount: number;
  status: "succeeded" | "requires_payment_method" | "failed";
}

export default class Stripe {
  static errors = {
    StripeCardError,
    StripeAPIError,
  };

  constructor(_apiKey: string) {}

  paymentIntents = {
    create: async (params: {
      amount: number;
      currency: string;
      payment_method: string;
      confirm?: boolean;
    }): Promise<PaymentIntent> => {
      if (params.payment_method === "tok_chargeDeclined") {
        throw new StripeCardError("Your card was declined.");
      }
      return {
        id: `pi_${params.amount}`,
        amount: params.amount,
        status: "succeeded",
      };
    },
  };
}
