/**
 * Legacy Stripe-style client: charges.create + stripe.error.CardError.
 */
export class CardError extends Error {
  readonly type = "card_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "CardError";
  }
}

export class APIError extends Error {
  readonly type = "api_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "APIError";
  }
}

export interface Charge {
  id: string;
  amount: number;
  status: "succeeded" | "failed";
}

const stripe = {
  charges: {
    async create(params: {
      amount: number;
      currency: string;
      source: string;
    }): Promise<Charge> {
      if (params.source === "tok_chargeDeclined") {
        throw new CardError("Your card was declined.");
      }
      return {
        id: `ch_${params.amount}`,
        amount: params.amount,
        status: "succeeded",
      };
    },
  },
  error: {
    CardError,
    APIError,
  },
};

export default stripe;
