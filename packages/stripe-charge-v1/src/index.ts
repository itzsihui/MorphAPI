/**
 * Stripe-style charge API v1 — amount is in dollars (float OK).
 * Migrating to v2 keeps the same property name but flips the unit to cents.
 */

export interface ChargeCreateParams {
  /** Amount in dollars, e.g. 10.5 = $10.50 */
  amount: number;
  currency: string;
  source: string;
}

export interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: "succeeded" | "pending" | "failed";
}

export interface ChargesApi {
  create(params: ChargeCreateParams): Promise<Charge>;
}

export interface StripeChargeClient {
  charges: ChargesApi;
}

export function createStripeCharge(apiKey: string): StripeChargeClient {
  if (!apiKey) {
    throw new Error("stripe-charge-v1 requires an apiKey");
  }
  return {
    charges: {
      async create(params: ChargeCreateParams): Promise<Charge> {
        return {
          id: `ch_v1_${params.amount}_${params.currency}`,
          amount: params.amount,
          currency: params.currency,
          status: "succeeded",
        };
      },
    },
  };
}

export default createStripeCharge;
