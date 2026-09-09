/**
 * Stripe-style charge API v2 — SAME shape as v1, but amount is integer cents.
 *
 * TypeScript still types amount as number, so forgetting ×100 typechecks
 * and silently under-charges (10.5 dollars → 10.5 cents ≈ $0.11).
 */

export interface ChargeCreateParams {
  /**
   * Amount in the smallest currency unit (cents for USD).
   * Example: $10.50 → 1050
   */
  amount: number;
  currency: string;
  source: string;
}

export interface Charge {
  id: string;
  /** Stored as cents */
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
    throw new Error("stripe-charge-v2 requires an apiKey");
  }
  return {
    charges: {
      async create(params: ChargeCreateParams): Promise<Charge> {
        return {
          id: `ch_v2_${params.amount}_${params.currency}`,
          amount: params.amount,
          currency: params.currency,
          status: "succeeded",
        };
      },
    },
  };
}

export default createStripeCharge;
