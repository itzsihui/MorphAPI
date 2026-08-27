/**
 * MorphPay v1 — deprecated synchronous Charges API.
 * Clients must migrate to morphpay-v2 PaymentIntent Builder.
 */

export interface ChargeCreateParams {
  amount: number;
  currency: string;
  source: string;
  capture?: boolean;
}

export interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: "succeeded" | "pending" | "failed";
  captured: boolean;
}

export interface ChargesApi {
  create(params: ChargeCreateParams): Promise<Charge>;
}

export interface MorphPayClient {
  charges: ChargesApi;
}

export function createMorphPay(apiKey: string): MorphPayClient {
  if (!apiKey) {
    throw new Error("MorphPay v1 requires an apiKey");
  }
  return {
    charges: {
      async create(params: ChargeCreateParams): Promise<Charge> {
        return {
          id: `ch_${params.amount}_${params.currency}`,
          amount: params.amount,
          currency: params.currency,
          status: "succeeded",
          captured: params.capture !== false,
        };
      },
    },
  };
}

export default createMorphPay;
