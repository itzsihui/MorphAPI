/**
 * MorphPay v2 — PaymentIntent Builder API.
 *
 * ONLY these symbols are real. Deliberate traps that do NOT exist:
 * - CaptureMode.IMMEDIATE
 * - IntentFactory
 * - Builder.setCapture(boolean)
 * - Builder.confirm()
 * - CONTENT_TYPE_* constants
 */

export enum CaptureMode {
  AUTOMATIC = "automatic",
  MANUAL = "manual",
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  captureMode: CaptureMode;
  status: "requires_confirmation" | "succeeded" | "canceled";
}

export class PaymentIntentBuilder {
  private amount?: number;
  private currency?: string;
  private paymentMethod?: string;
  private captureMode: CaptureMode = CaptureMode.AUTOMATIC;

  setAmount(amount: number): this {
    this.amount = amount;
    return this;
  }

  setCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  setPaymentMethod(paymentMethod: string): this {
    this.paymentMethod = paymentMethod;
    return this;
  }

  setCaptureMode(mode: CaptureMode): this {
    this.captureMode = mode;
    return this;
  }

  build(): PaymentIntent {
    if (this.amount === undefined || !this.currency || !this.paymentMethod) {
      throw new Error(
        "PaymentIntent.Builder requires amount, currency, and paymentMethod"
      );
    }
    return {
      id: `pi_${this.amount}_${this.currency}`,
      amount: this.amount,
      currency: this.currency,
      paymentMethod: this.paymentMethod,
      captureMode: this.captureMode,
      status: "requires_confirmation",
    };
  }
}

export const PaymentIntent = {
  Builder: PaymentIntentBuilder,
};

export interface IntentsApi {
  confirm(intent: PaymentIntent): Promise<PaymentIntent>;
}

export interface MorphPayClient {
  intents: IntentsApi;
}

export function createMorphPay(apiKey: string): MorphPayClient {
  if (!apiKey) {
    throw new Error("MorphPay v2 requires an apiKey");
  }
  return {
    intents: {
      async confirm(intent: PaymentIntent): Promise<PaymentIntent> {
        return { ...intent, status: "succeeded" };
      },
    },
  };
}

export default createMorphPay;
